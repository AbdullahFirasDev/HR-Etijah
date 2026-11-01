# Deployment

## Requirements

- Node.js ≥ 22.12 (24 LTS recommended) — the build output is a standalone Node server (`.output/`).
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

Rate-limit counters use Nitro storage, in-memory by default (per instance). With several instances, mount
a shared driver for the `ratelimit` storage key (e.g. Redis via a Nitro plugin / `nitro.storage`).
Everything else (sessions, challenges, idempotency, locks) is in Postgres and is already multi-instance safe.

## Platform notes

- **Docker / VM / any Node host:** recommended — scheduled tasks run in-process.
- **Vercel:** works with the Node runtime; set `NUXT_TRUST_PROXY_MODE=header`,
  `NUXT_CLIENT_IP_HEADER=x-real-ip`, add a Vercel Cron calling `/api/cron/daily` every 30 minutes, and use
  a shared rate-limit store.
- **Cloudflare in front of any origin:** `header` mode with `cf-connecting-ip`, and restrict the origin to
  Cloudflare IP ranges.

## PWA assets

Icons and iOS splash screens are generated from `public/icons/icon.svg`:
`npm run pwa:assets` (then commit `public/icons/*` and `pwa-splash-links.ts`). The service worker is
built automatically; users get an in-app "Update available" prompt after each deployment.

## Release checklist

- [ ] `npm run typecheck && npm test && npm run build && npm run test:e2e`
- [ ] Migrations applied (`supabase db push`) before deploying the app
- [ ] HTTPS + HSTS, correct RP ID / origins, `NUXT_COOKIE_SECURE=true`
- [ ] Allowed-network test from the office shows the expected public IP
- [ ] Geofence verified on site with a phone (accuracy indoors is often 20–40 m)
- [ ] Scheduled job running (check Admin → Attendance for missing check-out flags the next morning)
