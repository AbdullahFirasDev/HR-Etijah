# Etijah HR — Attendance & Time Tracking PWA

Arabic-first (RTL) employee attendance platform for **Etijah Travel & Tourism**. Every check-in,
check-out and break must independently pass **three** checks, verified on the server in real time:

| Check | How | Never trusted from the client |
|---|---|---|
| **A. Geofence** | High-accuracy GPS → distance computed by **PostGIS** against the office geofence (default 100 m, max accuracy 50 m), plus spoofing / impossible-travel risk scoring | Distance, verdict |
| **B. Network** | Client IP observed by the server (trusted-proxy aware) matched against the company's static IP / CIDR allowlist | IP address, `X-Forwarded-For` from untrusted peers |
| **C. Biometrics** | Fresh **WebAuthn** ceremony per action (`userVerification: "required"`), single-use 90-second challenge bound to user + action | Assertion is verified server-side (signature, origin, RP ID, UV flag, counter) |

Attendance is **online only** — nothing is ever queued offline.

**Stack:** Nuxt 4 · Vue 3 · TypeScript · Nuxt UI 4 · Tailwind 4 · Supabase (Postgres 17, Auth, PostGIS, RLS) · Nitro server API · SimpleWebAuthn · Leaflet + OSM · ECharts · Zod · Workbox (vite-plugin-pwa) · Vitest · Playwright.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, request flows, data model, calculation engine
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, the three checks, sessions, RLS, network/VPN limitations
- [docs/SUPABASE.md](docs/SUPABASE.md) — Supabase project configuration
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production deployment, reverse proxies, scheduled jobs
- [docs/TESTING.md](docs/TESTING.md) — test suites, what they cover, device test checklist

## Quick start (local development)

Prerequisites: Node.js ≥ 22.12 (24 LTS recommended), Docker (for the local Supabase stack).

```bash
npm install
npx supabase start            # local Postgres + Auth + PostgREST (prints URL and keys)
npx supabase db reset         # applies supabase/migrations + supabase/seed.sql (dev data)
cp .env.example .env          # then fill in the values below
npm run dev                   # http://localhost:3000
```
wdG6d9owHA3u2oM0
Minimal `.env` for local development (keys come from `supabase start` / `supabase status`):

```env
NUXT_SUPABASE_URL=http://127.0.0.1:54321
NUXT_SUPABASE_ANON_KEY=<anon / publishable key>
NUXT_SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key>
NUXT_SESSION_SECRET=<48+ random characters>
NUXT_COOKIE_SECURE=false
NUXT_WEBAUTHN_RP_ID=localhost
NUXT_WEBAUTHN_ORIGINS=http://localhost:3000
NUXT_TRUST_PROXY_MODE=none
NUXT_TRUSTED_PROXY_CIDRS=
```

> Open the app at exactly `http://localhost:3000` — that origin must be listed in
> `NUXT_WEBAUTHN_ORIGINS` (it is the CSRF allow-list too) and WebAuthn needs the RP ID `localhost`.
> The server validates the configuration at startup and lists any missing/invalid setting by name.
> To test on a phone, serve over HTTPS (e.g. a tunnel) and set the RP ID / origins to that hostname.

**Using a hosted Supabase project instead of Docker:** set `NUXT_SUPABASE_*` to the project's
values, then apply the schema with `npx supabase link --project-ref <ref>` and
`npx supabase db push` (see [docs/SUPABASE.md](docs/SUPABASE.md)). The dev seed accounts below
only exist where `supabase/seed.sql` was loaded — use `scripts/create-owner.mjs` otherwise.

### Troubleshooting local runs

| Symptom | Cause | Fix |
|---|---|---|
| `500 server_misconfigured` | A required setting is missing or invalid | Read the `[config]` lines printed when the server starts — they name each setting |
| `403 csrf_origin_mismatch` on sign-in | The browser origin is not in `NUXT_WEBAUTHN_ORIGINS` | Set it to the exact URL you open (`http://localhost:3000`); the server logs the rejected and allowed origins |
| `worker entry not found in .nuxt/dev/index.mjs` / 503 "Dev server is unavailable" | Nitro deletes and rebuilds `.nuxt/dev` on every dev restart; a reload landing in that window (overlapping restarts from edits to `nuxt.config.ts`/`.env`, or tools regenerating `.nuxt` while `nuxi dev` runs) finds no worker entry | Wait for "Nitro built" (it recovers on the next successful build) or restart `npm run dev`. Use `npm run typecheck` (isolated `.nuxt-typecheck` dir), not `nuxi typecheck`, while the dev server runs; avoid `npm install` while it runs |
| CSP warning mentioning `eval` / `unsafe-eval` | Zod's eval probe under our strict CSP | Fixed: Zod runs jitless in the browser (`shared/schemas.ts`); the CSP never allows `unsafe-eval` |
| `<Suspense> is an experimental feature` (dev console) | Printed by Vue for Nuxt's own `NuxtRoot`/`NuxtLayout` | Informational, development only — no action |
| "GPS accuracy insufficient" although you are within the radius | Two independent checks: the **distance** must be ≤ the geofence radius **and** the reading's **accuracy** must be ≤ the maximum accuracy (default ±50 m). Computers without GPS and phones indoors often report ±100 m or worse | The message shows both numbers. Use a phone with GPS near a window. Each decision is logged by the server as one `[geo]` line (device and office coordinates, distance, radius, accuracy, verdict). Raising the accuracy limit is an explicit admin decision (Admin → Company location) |
| Network check fails / wrong IP in `nuxi dev` | The dev server forwards to its worker over an IPC pipe | Handled (dev-only, not tamper-proof); verify network rules on a production build: `npm run build && node .output/server/index.mjs` |

### Development accounts (seed only — password `Etijah@2026dev`)

| Email | Role | Notes |
|---|---|---|
| owner@etijah.local | Owner | no employee record |
| hr@etijah.local | HR Manager | |
| manager.ops@etijah.local | Department Manager | manages Operations |
| ali@etijah.local | Employee | Operations, day shift |
| sara@etijah.local | Employee | Sales, day shift |
| night@etijah.local | Employee | Operations, overnight shift 22:00–06:00 |

The seed office geofence is at 32.0259, 44.3462 (Najaf) — change it in **Admin → Company location**,
or use Chrome DevTools → Sensors to simulate a location. The seed allows one example office IP,
`203.0.113.10/32` — replace it with the company's static public IP in **Admin → Allowed networks**.
Loopback is never allowed: `http://localhost` is seen as `127.0.0.1`/`::1`, not the office IP. To test
attendance locally set `NUXT_DEV_LOOPBACK_CLIENT_IP` to an allowed office IP (development/test only — see
[docs/SECURITY.md](docs/SECURITY.md#localhost-vs-the-office-network-local-testing)).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `preview` | Develop / production build / run the build |
| `npm run typecheck` | Type-check app, server and shared code (isolated `.nuxt-typecheck` dir — safe while `npm run dev` runs) |
| `npm test` | Unit + database tests (Vitest) |
| `npm run test:unit` | Engine, IP/proxy, risk, session, WebAuthn, export tests |
| `npm run test:db` | Migrations, RLS, attendance functions on real Postgres + PostGIS (in-process PGlite) |
| `npm run test:e2e` | Playwright (build first). Full-flow suite needs `E2E_SUPABASE_*` — see docs/TESTING.md |
| `npm run db:reset` | Re-apply migrations + dev seed to the local Supabase |
| `npm run pwa:assets` | Regenerate icons / iOS splash screens from `public/icons/icon.svg` |
| `node scripts/create-owner.mjs` | Create the first Owner on a fresh production database |

## Project structure

```
app/                 Nuxt app (SPA): pages, layouts, components, composables, service worker
  pages/             employee screens (/, history, leave, devices, reports…) and /admin/*
  service-worker/    Workbox service worker (precache shell; API never cached)
server/
  api/               Nitro API (the trusted backend)
  lib/               pure, unit-tested security logic (client IP, risk scoring, sessions, WebAuthn)
  utils/             sessions, Supabase clients, attendance service, reports, exports, audit
  middleware/        CSRF / origin guard, API rate limit
  tasks/             scheduled job: missing check-out + absence detection, recalculation
shared/
  engine/            attendance calculation engine (pure TypeScript, timezone-aware)
  schemas.ts         Zod schemas shared by API and forms
supabase/
  migrations/        schema, RLS, SECURITY DEFINER functions, reference data
  seed.sql           development data only
i18n/locales/        ar.json (default, RTL) and en.json
tests/               unit/, db/ (PGlite + PostGIS), e2e/ (Playwright)
docs/                architecture, security, Supabase, deployment, testing
```
