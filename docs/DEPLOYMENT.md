# Deployment

## Requirements

- Node.js 24 (`package.json` engines `24.x`, `.nvmrc`) — the build output is a standalone Node server
  (`.output/`), or Vercel functions (see [Vercel](#vercel)).
- **HTTPS on a real domain.** WebAuthn and the Geolocation API only work in secure contexts, and the
  WebAuthn RP ID is bound to the domain: changing the domain later invalidates every registered device.
- A Supabase project configured per [SUPABASE.md](SUPABASE.md).

## Build and run

```bash
npm ci
npm run build
node .output/server/index.mjs          # listens on PORT (default 3000)
```

Production environment (see `.env.example` for all variables):

```env
NUXT_SUPABASE_URL=https://<ref>.supabase.co
NUXT_SUPABASE_ANON_KEY=…
NUXT_SUPABASE_SERVICE_ROLE_KEY=…          # secret
NUXT_SESSION_SECRET=…                     # 48+ random chars, secret
NUXT_COOKIE_SECURE=true
NUXT_WEBAUTHN_RP_ID=hr.etijah.com
NUXT_WEBAUTHN_ORIGINS=https://hr.etijah.com
NUXT_TRUST_PROXY_MODE=xff                 # see "Reverse proxy" below
NUXT_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
NUXT_CRON_SECRET=…                        # if using an external scheduler
NUXT_PUBLIC_VAPID_PUBLIC_KEY=…            # optional, web push
NUXT_VAPID_PRIVATE_KEY=…
NUXT_VAPID_SUBJECT=mailto:hr@etijah.com
```

The configuration is validated when the server starts (`NUXT_APP_ENV`, default `production` for a
build). In production an invalid configuration **aborts start-up** with a log naming each setting (values
are never printed): https origins, `NUXT_COOKIE_SECURE=true`, a strong session secret, an RP ID that
matches the origins, correctly typed Supabase keys and consistent proxy settings are required.

## Reverse proxy (recommended: nginx / Caddy on the same host)

```nginx
server {
  listen 443 ssl http2;
  server_name hr.etijah.com;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, do not append client-supplied values
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

With this config use `NUXT_TRUST_PROXY_MODE=xff` and `NUXT_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128`, and
make sure port 3000 is not reachable from outside. Then open **Admin → Allowed networks** from the office
and confirm the "IP seen by the server" is the office's public IP. See [SECURITY.md](SECURITY.md) for
Cloudflare / Vercel settings.

## Scheduled job

`attendance:close-days` (missing check-out flagging, absence detection, summary recalculation, expired
session/challenge cleanup) runs every 30 minutes **inside the Node server** via Nitro scheduled tasks.

If the platform does not keep a long-running process (serverless), call the cron endpoint instead:

```bash
curl -X POST -H "Authorization: Bearer $NUXT_CRON_SECRET" https://hr.etijah.com/api/cron/daily
```

## Multiple instances

Rate-limit counters are in memory by default (per instance). With several instances set
`NUXT_RATE_LIMIT_STORE=database` after applying `supabase/migrations/20261101000100_rate_limits.sql`:
login, password-reset and attendance limits are then counted in Postgres (the coarse per-IP API flood guard
stays per instance). Everything else (sessions, challenges, idempotency, locks) is in Postgres and is already
multi-instance safe.

## Platform notes

- **Docker / VM / any Node host:** recommended — scheduled tasks run in-process.
- **Vercel:** supported — see the next section.
- **Cloudflare in front of any origin:** `header` mode with `cf-connecting-ip`, and restrict the origin to
  Cloudflare IP ranges. Do not put Cloudflare (or any proxy) in front of Vercel: Vercel would then see the
  proxy's address, not the office's.

## Vercel

Vercel detects Nuxt and builds with Nitro's `vercel` preset (`.vercel/output`, Build Output API v3):
static assets on the CDN, every page and API route in one Node.js 24 function. No `vercel.json` is needed.

**Plan.** Vercel's Hobby plan is for non-commercial personal use only; a company HR system needs **Pro**.
Hobby also limits cron jobs to once a day (the default schedule below is Hobby-compatible).

What is different from the Node server, and how it is handled:

| Concern | On Vercel |
|---|---|
| Client IP | `NUXT_TRUST_PROXY_MODE=vercel`: the address Vercel's edge writes into `x-vercel-forwarded-for` (cross-checked with `x-real-ip` / `x-forwarded-for`, which the edge also overwrites). Refused when not running on Vercel. See [SECURITY.md](SECURITY.md#vercel). |
| Housekeeping job | Nitro scheduled tasks do not run. Vercel Cron calls `GET /api/cron/daily` with `Authorization: Bearer $CRON_SECRET`; schedule from `VERCEL_CRON_SCHEDULE` at build time (default `0 21 * * *`, ~00:00 Baghdad; Pro: `*/30 * * * *`). |
| Background recalculation | `event.waitUntil` is handed to Vercel's `waitUntil` (`server/plugins/vercel.ts`), so it finishes after the response. |
| Rate limits | `NUXT_RATE_LIMIT_STORE=database` (migration `20261101000100_rate_limits.sql`). |
| Sessions, WebAuthn challenges | Already in Postgres — shared by all instances. |
| Security headers / CSP | Route rules become edge headers. HTML pages get only the hash-based policy from the function; assets and API get the strict resource policy (`npm run verify:vercel` checks this). |
| Node.js | `engines` `24.x` → Vercel builds on Node 24; Nitro emits a `nodejs24.x` function. |

On Vercel the production server **refuses to start** unless `NUXT_TRUST_PROXY_MODE=vercel`,
`NUXT_RATE_LIMIT_STORE=database` and `CRON_SECRET` are set (plus the usual https origins, Secure
cookies and a valid RP ID — `vercel.app` itself is refused).

### Check a build locally (nothing is deployed)

```bash
npm run build:vercel                                   # NITRO_PRESET=vercel → .vercel/output
node --env-file=.env scripts/verify-vercel-output.mjs  # or: npm run verify:vercel
```

The verifier checks the function runtime, the cron entry, the edge headers per path (no second CSP on
pages), that no HTML is prerendered, and that no server secret from the environment appears in the client
or server bundle.

### Set up the project (dashboard)

1. **Database first** (with approval, on the intended project): apply the migrations including
   `20261101000100_rate_limits.sql` (`supabase db push`). Never run `seed.sql` against production.
2. **Import** the Git repository in Vercel. Framework preset *Nuxt.js* (auto-detected), build command
   `npm run build`, output directory automatic, root directory = repository root.
3. **Settings → Functions → Region:** the region closest to the Supabase project's region (e.g. Supabase
   `eu-central-1` → `fra1`). Fluid compute: on (default).
4. **Environment variables** (scope *Production*): every entry of `.env.vercel.example`, with fresh secrets.
   **Do not import the local `.env`** (it holds development values — `http://localhost` origins,
   `NUXT_COOKIE_SECURE=false`, `NUXT_TRUST_PROXY_MODE=none` — and development secrets).
   Leave *Preview* without variables (preview deployments then answer `server_misconfigured` instead of
   touching production data), or give it a separate staging Supabase project and its own origins.
5. **Domains:** add the final domain (e.g. `hr.etijah.com`) before anyone registers a device, and use it in
   `NUXT_WEBAUTHN_ORIGINS` / `NUXT_WEBAUTHN_RP_ID`.
6. **Supabase → Authentication → URL Configuration:** Site URL = the production origin; add
   `https://<domain>/auth/reset` to the redirect URLs (password-reset links).
7. **Supabase → Authentication → Rate Limits:** the server signs users in, so Supabase counts every login
   against Vercel's addresses (password sign-in: bursts of 30 per IP). Raise that limit to cover a shift
   start, and configure custom SMTP (the built-in sender allows only a few emails per hour).
8. **Deploy a preview first**, then verify the client IP from the office (below) before promoting.

### Troubleshooting: `500 FUNCTION_INVOCATION_FAILED` on every page

The function exited while starting. Almost always this is the configuration check refusing an invalid
production configuration (by design — it never starts with insecure settings). Read the reason in
**Vercel → Project → Logs** (filter *Errors*, or search `[config]`), or with the CLI:

```bash
vercel logs --project <project> --scope <team> --json   # Hobby keeps only the last ~30 minutes
```

The `[config] Server configuration is invalid (production)` entry names every setting to fix (never its
value). Fix them under *Settings → Environment Variables* (scope Production) and **redeploy** — variables
are read by new deployments only. A different error with a stack trace is a code/runtime problem instead.

### Verify the client IP (must be done on a deployment)

Unit tests and `scripts/verify-vercel-output.mjs` prove what the server does *with* Vercel's headers; only
a deployment proves that Vercel's edge sets them as documented. From the office network:

1. Open **Admin → Allowed networks → Test from this browser** on the deployment. Expected: *IP seen by the
   server* = `169.224.96.169`, source `vercel`, and identical `x-vercel-forwarded-for` / `x-real-ip` /
   `x-forwarded-for` values.
2. From the same browser, check the public IP on an independent site (e.g. ifconfig.me): it must match.
3. From a phone on mobile data (Wi-Fi off): the test must show a different IP and *not allowed*.
4. Spoof attempt from outside the office, with an admin session cookie:
   `curl -H "X-Forwarded-For: 169.224.96.169" -H "X-Real-IP: 169.224.96.169" https://<domain>/api/admin/networks/test`
   — the IP shown must be the caller's real address.
5. Function logs (`[net] precheck … source=vercel`) show the same for real check-in attempts.

If any of these fail, do not go live: the network check is then unreliable on this platform, and the
fallback is a Node server (Docker/VM) where the TCP peer is the client.

Vercel's domains currently publish no IPv6 (AAAA) records, so office devices reach the app over IPv4. If
that changes and the office has IPv6, add the office IPv6 prefix to the allowlist.

## PWA assets

Icons and iOS splash screens are generated from `public/icons/icon.svg`:
`npm run pwa:assets` (then commit `public/icons/*` and `pwa-splash-links.ts`). The service worker is
built automatically; users get an in-app "Update available" prompt after each deployment.

## Release checklist

- [ ] `npm run typecheck && npm test && npm run build && npm run test:e2e` (Vercel: also `npm run build:vercel && npm run verify:vercel`)
- [ ] Migrations applied (`supabase db push`) before deploying the app
- [ ] HTTPS + HSTS, correct RP ID / origins, `NUXT_COOKIE_SECURE=true`
- [ ] Allowed-network test from the office shows the expected public IP (Vercel: source `vercel`, see above)
- [ ] No private / loopback entries active in the allowlist (e.g. old `::1/128`, `192.168.x` rows)
- [ ] Geofence verified on site with a phone (accuracy indoors is often 20–40 m)
- [ ] Scheduled job running (check Admin → Attendance for missing check-out flags the next morning)
