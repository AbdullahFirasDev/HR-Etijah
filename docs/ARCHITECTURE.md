# Architecture

## Overview

```
 Browser / installed PWA (Nuxt SPA, Arabic RTL default)
   │  same-origin HTTPS only · HttpOnly session cookie · X-Requested-With: hr-app
   ▼
 Nitro server API  ── the trusted backend (server/)
   │   • sessions (10 min absolute + idle), CSRF/origin guard, rate limits, Zod validation
   │   • WebAuthn verification (SimpleWebAuthn), client-IP resolution, location risk scoring
   │   • attendance engine (shared/engine), reports, Excel/PDF exports, notifications
   │
   ├── user-scoped Supabase client (the user's JWT)  → every read is filtered by RLS
   └── service-role client (server only)              → backend-only operations
           ▼
 Supabase: Postgres 17 + PostGIS (extensions schema) + Auth + PostgREST
   • RLS on every table · SECURITY DEFINER functions for critical operations
   • immutable attendance_events / verification_attempts / audit_logs
```

The browser never receives a Supabase token. It only holds an opaque, random session token in an
`HttpOnly`, `SameSite=Strict` (and `Secure` + `__Host-` prefix in production) cookie. The server
stores the token's SHA-256 hash and the user's Supabase access token encrypted with AES-256-GCM.

### Why an SPA

The whole product sits behind authentication (no SEO), and an SPA shell makes the PWA's app-shell
caching and offline state predictable. Nitro still serves the API, so all trust decisions remain on the
server.

## Defence in depth: two clients

| Client | Used for | Enforcement |
|---|---|---|
| `ctx.db` — **user JWT** | All reads; configuration writes; workflow RPCs (leave/adjustment review, device status, role change, period lock) | RLS policies + checks inside SECURITY DEFINER functions (`auth.uid()` = caller) |
| `serviceDb()` — **service role** | Session store, WebAuthn challenges, `record_attendance_event`, account provisioning, computed summaries, notifications | Server-side permission checks first; `x-actor-id` header lets DB audit triggers attribute the change |

Even if someone signs in to Supabase directly with the public anon key, RLS limits them to their own
data and they cannot record attendance: `record_attendance_event()` is executable only by `service_role`.

## Attendance submission flow

```
UI step 1  GPS (watchPosition, high accuracy, until accuracy ≤ geofence max or 20 s)
UI         POST /api/attendance/precheck      → PostGIS distance + IP allowlist (informational)
UI step 3  POST /api/attendance/challenge     → single-use challenge (90 s) bound to user+session+action
           navigator.credentials.get()        → platform authenticator, user verification REQUIRED
           POST /api/attendance/submit
Server       1. consume_webauthn_challenge()      atomic UPDATE … WHERE unused AND unexpired RETURNING
             2. verify assertion                  signature · challenge · origin · RP ID · UV flag · counter
             3. location risk score               mock-location artefacts, impossible travel, automation
             4. work date                         overnight shifts: post-midnight check-in → previous day
             5. record_attendance_event()         ── in ONE transaction, under a per-employee advisory lock:
                  idempotency (employee, key) · challenge bound & unused by any event · active credential
                  PostGIS geofence + accuracy + fix freshness · IP ∈ allowed CIDR · risk threshold
                  state machine (check-in / break / check-out) · period lock
                  → immutable event + session/break update + verification_attempt (accepted)
                  → or verification_attempt (rejected, with every failure reason)
             6. recalculate the work date (background, event.waitUntil)
```

A CHECK constraint guarantees an employee-sourced event can only exist when geofence, network and
WebAuthn all passed. Partial unique indexes allow only one open session and one open break per
employee; the `challenge_id` column is unique, so a challenge can never back two events.

## Data model (supabase/migrations)

| Area | Tables |
|---|---|
| Identity & org | `roles` (scope + permissions), `profiles`, `employees`, `departments`, `department_managers`, `offices`, `geofences` (PostGIS geography generated from lat/lng), `allowed_networks` (`cidr`), `org_settings` |
| Auth & devices | `app_sessions`, `employee_devices`, `webauthn_credentials` (public keys only), `webauthn_challenges` |
| Schedules | `shifts`, `employee_schedules` (effective-dated; overlap prevented by exclusion constraint) |
| Attendance | `attendance_events` (immutable), `attendance_sessions`, `breaks`, `verification_attempts` (immutable), `attendance_adjustments`, `attendance_days`, `monthly_summaries`, `attendance_period_locks` |
| Leave | `holidays`, `leave_types`, `leave_balances`, `leave_requests` (overlap prevented by exclusion constraint) |
| Other | `notifications`, `push_subscriptions`, `audit_logs` (immutable) |

All timestamps are `timestamptz` (UTC). Calendar logic uses the organisation timezone
(`org_settings.timezone`, default `Asia/Baghdad`).

### Corrections never overwrite history

An approved `attendance_adjustment` **appends** new events (`source = 'adjustment'`) and re-points the
derived session/break rows; voids are recorded as status changes on derived rows with a reference to
the adjustment. `attendance_events` rejects UPDATE/DELETE/TRUNCATE for every role, including
`service_role`. Requests need a reason (≥ 5 characters); self-approval is refused in the database.

## Calculation engine (shared/engine)

Pure TypeScript, deterministic, unit-tested. Per employee-day:

1. Resolve the schedule effective that day (employee override → shift → organisation default).
2. Working day? (schedule weekday, not a holiday). Approved leave reduces the requirement (half days 50 %).
3. Clip each session to the permitted window: the shift window unless `count_before_shift` /
   `count_after_shift` permit more; flexible schedules use their flexible window.
4. **Net = Σ clipped intervals − unpaid breaks** (break time beyond the paid allowance is unpaid).
5. **Overtime = max(0, net − required)** for eligible employees, subject to the minimum and daily cap;
   work on days off / holidays counts entirely (policy).
6. **Shortage = max(0, required − net)**, only once the day is complete.
7. Late = first check-in after shift start + grace; early departure = last check-out before shift end.
8. Status: present / in progress / missing check-out / on leave / holiday / day off / absent / scheduled.

Every result stores its inputs, the policy values used and the formula (`attendance_days.details`).
Overnight shifts belong to the date they start. Weekly basis (optional) offsets surplus and deficit
across the week, with weekly targets scaled down proportionally for leave and holidays.

Results are persisted after every event, adjustment, leave decision and configuration change, and by the
30-minute job (missing check-out flagging, absence detection). Reports compute live from source data,
except for payroll-locked months, which use the frozen snapshot.

## Sessions

`server/lib/session-policy.ts`: a session ends at whichever comes first — **10 minutes after login
(absolute, never extended)** or **10 minutes without user-initiated requests (idle)**. Polling endpoints
(`?passive=1`, `/api/auth/session`) never count as activity. Expired sessions are revoked in the database
and their Supabase token signed out; the cookie's Max-Age always tracks the absolute expiry. The client
shows a countdown from the server clock and returns to the login screen at expiry.

The login session is unrelated to attendance verification: each attendance action still requires
all three checks and a brand-new WebAuthn challenge.

## Front end

- `app/composables/useAttendanceFlow.ts` — the three-step verification UI flow.
- `app/composables/useApi.ts` — single `$fetch` instance: CSRF header, expiry tracking, no retries.
- Nuxt UI dashboard layout for admins; mobile-first bottom-tab layout for employees.
- `@nuxtjs/i18n` with Arabic (RTL) default and English; choice stored in a cookie and the profile.
- Leaflet + OpenStreetMap for geofence display and editing; ECharts for analytics (axes mirror in RTL).

## PWA

Workbox `injectManifest` (`app/service-worker/sw.ts`): precached app shell, fonts and icons; icons are
bundled into JS (no runtime icon fetches); translations cached cache-first by content hash; OSM tiles
cached with expiry. `/api/**` is network-only for every method and there is no Background Sync — an
offline attendance action fails immediately with an explanation. Web Push is supported when VAPID keys
are configured; payloads carry no personal data beyond a title and a link.
