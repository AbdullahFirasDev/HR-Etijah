# Testing

| Suite | Command | Runs against | Needs |
|---|---|---|---|
| Unit | `npm run test:unit` | pure TypeScript | nothing |
| Database | `npm run test:db` | the real migrations + seed in in-process Postgres 17 + PostGIS (PGlite), with a Supabase-compatible `auth.uid()` / roles shim; queries run as `authenticated` / `service_role` exactly like PostgREST | nothing |
| E2E smoke | `npm run build && npm run test:e2e` | the production build in Chromium (desktop + Pixel 7 emulation) | nothing (Supabase deliberately unreachable) |
| E2E full flow | see below | production build + real Supabase stack | Docker or a Supabase project |

## Coverage map

| Requirement | Where |
|---|---|
| Valid attendance (all three checks) | `tests/db/attendance.test.ts` › accepts a valid check-in; `tests/e2e/flows.spec.ts` |
| Outside-geofence rejection (PostGIS distance) | db: outside the geofence; e2e: check-out from outside |
| Insufficient / stale / missing GPS | db: accuracy, stale, unavailable; e2e: accuracy 400 m |
| Unauthorised IP | db: IP outside allowed networks; unit: forged `X-Forwarded-For`, trusted-proxy walking, IPv4-mapped IPv6 |
| Invalid WebAuthn assertions | unit `webauthn.test.ts` (real P-256 software authenticator): no UV flag, wrong challenge, phishing origin, foreign RP ID, tampered signature, wrong key, counter regression, wrong ceremony type |
| Expired / replayed challenges | db: expired cannot be consumed, consumed once only, other action, other user, replay of a used challenge |
| Expired sessions | unit `security-libs.test.ts` (absolute, idle, whichever first, revoked, cookie lifetime) |
| Duplicate check-ins, check-out without check-in, break rules, idempotency | db: state machine |
| Break calculations, late arrival, overtime (thresholds, caps, eligibility), shortage, early departure | unit `engine.test.ts` |
| Overnight shifts | unit: 22:00–06:00 window, late after midnight, post-midnight work-date |
| Leave and holiday calculations | unit: full/half leave, policy flags, holidays, day off work, chargeable leave days, recurring holidays |
| Missing check-out detection | db: flags stale open session, voids open break, employee can check in again |
| RLS / employee data isolation | db `rls.test.ts`: own data only, department scope, HR org scope, anon nothing, hidden network list, column privileges, config writes, role grants |
| Corrections & approvals | db: reason required, no self-approval, manager without permission refused, events appended not modified, period locks |
| Leave workflow | db: department scoping, balance enforcement, overlap prevention, two-step flow |
| Immutability | db: UPDATE/DELETE on events and attempts refused even for `service_role` |
| Exports | unit `export.test.ts`: Excel (RTL sheet, numeric hours, Baghdad times), PDF (both languages), bidi word ordering |
| PWA, i18n/RTL, security headers, CSRF | e2e `smoke.spec.ts` incl. reopening offline from the service-worker cache |
| Client IP for the allowlist: localhost (loopback) rejected, `NUXT_DEV_LOOPBACK_CLIENT_IP` maps loopback only and never in production, approved public IP accepted, unapproved IP rejected, spoofed `X-Forwarded-For` / `Forwarded` / `X-Real-IP` / `CF-Connecting-IP` / `True-Client-IP` ignored, authenticated `nuxi dev` peer hand-off, loopback ranges refused as allowed networks | unit `client-ip.test.ts`; db `attendance.test.ts` (loopback / unknown IP rejected by the database check) |
| CSRF origin rules, forwarded headers, hash-based CSP, startup config validation | unit `request-security.test.ts`; e2e: no CSP violation in the browser, inline-script hashes match the served HTML, allowed origin passes / foreign origin 403 |

A mutation check was done on the RLS suite during development: weakening the `attendance_events` select
policy to `using (true)` made the isolation tests fail, as expected.

## Running the full-flow E2E suite

```bash
npx supabase start && npx supabase db reset
npm run build
E2E_SUPABASE_URL=http://127.0.0.1:54321 \
E2E_SUPABASE_ANON_KEY=<anon key> \
E2E_SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
  npm run test:e2e
```

It registers a device with Chromium's virtual platform authenticator (user verification on), has HR approve
it, checks in inside the geofence, is rejected outside it, checks out, and verifies role isolation. Run
`supabase db reset` before each run (the flow registers a device for the seed user).

## Real-device checklist (cannot be automated in CI)

Test the installed PWA over HTTPS on the actual devices staff use:

| | Android Chrome | Samsung Internet | iOS Safari (≥ 16) | iOS home-screen app | Desktop Chrome/Edge |
|---|---|---|---|---|---|
| Install / splash / icon | | | | | |
| Location permission prompt & denial message | | | | | |
| GPS accuracy indoors at the office (note values) | | | | | |
| Register device (fingerprint / Face ID / PIN) | | | | | |
| Check-in / break / check-out | | | | | |
| Rejected with mobile data / VPN / Private Relay on | | | | | |
| Session expiry after 10 min → login screen | | | | | |
| Offline: banner, no submission possible | | | | | |
| Push notification (Android; iOS 16.4+ installed app only) | | | | | |

Known platform behaviour: iOS only allows web push for home-screen-installed apps; Safari's location
accuracy indoors is often 30–65 m (adjust the geofence's maximum accuracy if needed); Android passkeys may
be stored in Google Password Manager and sync across the employee's devices.
