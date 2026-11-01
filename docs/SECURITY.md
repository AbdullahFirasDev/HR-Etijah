# Security

## Threats addressed

| Threat | Mitigation |
|---|---|
| Buddy punching (colleague records for you) | WebAuthn on the employee's own approved device, user verification required, fresh challenge per action |
| Checking in from home | PostGIS geofence on the server + company network IP allowlist — both required |
| Fake GPS / mock-location apps | Accuracy and freshness limits; risk scoring (zero/sub-metre accuracy, rounded coordinates, future timestamps, implausible reported speed, impossible travel since the last fix, exact repeated coordinates, browser automation); block at `risk_block_threshold`, flag for review at `risk_review_threshold` |
| Replayed / stolen assertions | Server-stored challenges: 90 s TTL, single use (atomic consume), bound to user, login session and action; `challenge_id` unique per event; signature counter must increase |
| Forged IP headers | Client IP never comes from the request body; `X-Forwarded-For` honoured only when the TCP peer is a configured trusted proxy (right-most untrusted hop) |
| Double / concurrent submissions | Idempotency key (unique per employee), per-employee advisory lock, one open session/break (partial unique indexes), UI blocks concurrent runs |
| Tampering with history | `attendance_events`, `verification_attempts`, `audit_logs` are append-only via triggers (also for `service_role`); corrections are new audited records with a mandatory reason; no self-approval; payroll period locks |
| Privilege escalation | RLS on every table; scope (organisation / department / self) + permissions; privileged roles only grantable by the Owner; nobody can change their own role; last owner cannot be removed |
| Session theft / fixation | HttpOnly + SameSite=Strict + Secure (`__Host-` prefix) cookie holding only an opaque token; hash stored server-side; new token at every login; 10-minute absolute + idle expiry; server-side revocation; sessions revoked on password change / deactivation |
| CSRF | SameSite=Strict + Origin must be one of `NUXT_WEBAUTHN_ORIGINS` (or, when absent, `Sec-Fetch-Site` same-origin) + mandatory `X-Requested-With` header + JSON-only bodies. Forwarded/X-Forwarded-Host headers are only considered from trusted proxies and never widen the allow-list in production |
| XSS impact | No tokens readable by JavaScript; strict CSP (`connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), Vue escaping |
| Brute force / abuse | Rate limits: API per IP, login per IP and per email, attendance per user, exports, recalculation |
| Information leakage | Generic error codes (no SQL/stack details), allowed network list hidden from employees, minimal push payloads |

## A. Geofence

- Coordinates are configured on an interactive map (Admin → Company location); radius default
  **100 m**, maximum accepted GPS accuracy default **50 m**.
- The browser reading (lat, lng, accuracy, fix age) is sent with the request. The fix age is
  computed on the device as `now − position.timestamp`, so device clock skew does not matter; the
  server rejects fixes older than `max_location_age_seconds`.
- The **database** computes the geodesic distance (`ST_Distance` on `geography`) to the employee's
  office geofence and decides. The phone's own calculation is only used for display.
- Latitude, longitude, accuracy, distance and verdict are stored on every attempt.

**Limits:** a browser cannot prove a reading is genuine. A rooted phone with a sophisticated spoofer can
produce plausible coordinates — which is why network and biometric checks are mandatory too, and why
risky attempts are logged and surfaced for review.

## B. Company network

A web app **cannot read the Wi-Fi network name (SSID)**. Network verification therefore uses the
company's **static public IP** (or CIDR ranges), configured in Admin → Allowed networks, with a
built-in test that shows the IP the server sees for your browser.

### Configuring the client IP correctly (`NUXT_TRUST_PROXY_MODE`)

| Deployment | Setting |
|---|---|
| Node server directly on the internet | `none` (socket address) |
| Behind your own nginx / Caddy / load balancer | `xff` + `NUXT_TRUSTED_PROXY_CIDRS` = the proxy addresses. The server walks `X-Forwarded-For` right-to-left and returns the first address that is not a trusted proxy. |
| Behind Cloudflare | `header`, `NUXT_CLIENT_IP_HEADER=cf-connecting-ip`, and `NUXT_TRUSTED_PROXY_CIDRS` = Cloudflare's published ranges (or lock the origin so only Cloudflare can reach it) |
| Vercel | `vercel` (see [Vercel](#vercel) below) |

Never enable `xff`/`header` without making sure clients cannot reach the app except through that proxy.

**Production accepts only public client IPs.** Whatever the mode, in production a resolved client IP that
is not public unicast — loopback, private LAN (`10/8`, `172.16/12`, `192.168/16`), link-local, CGNAT,
IPv6 ULA, documentation ranges — is treated as *unknown* (`network_unknown`, attendance rejected). Such an
address can never be the office's public IP, so an allowlist entry for it can never let anyone in. The admin
API also refuses to activate non-public ranges in production (`non_public_network`).

### Vercel

A Vercel function's TCP peer is Vercel's own proxy, so the client address must come from a header — one
that only Vercel's edge can set. Vercel documents that it **overwrites `X-Forwarded-For` with the client's
public IP and does not forward client-supplied values ("to prevent IP spoofing")**, and that
`x-real-ip` and `x-vercel-forwarded-for` carry the same address (the latter even if a proxy sits in front;
a custom forwarded IP is an Enterprise "trusted proxy" feature). With `NUXT_TRUST_PROXY_MODE=vercel`:

- the client IP is the single address in `x-vercel-forwarded-for`; `x-real-ip` and `x-forwarded-for`, when
  present, must hold the same single address — any disagreement, list or malformed value makes the client IP
  unknown (fail closed), as does a missing header;
- the mode works only when the server runs on Vercel (`VERCEL=1`); anywhere else these headers are
  client-controlled, so the client IP is unknown and production refuses to start with this mode;
- on Vercel, production refuses to start with any other mode (the proxy's address would be used);
- the production public-IP rule above still applies.

**What has and has not been verified.** The decisions above are covered by unit tests and were exercised
on the built Vercel function with simulated edge headers. That Vercel's edge really overwrites the headers
for this project is Vercel's documented behaviour but can only be confirmed on a deployment — follow
[DEPLOYMENT.md → Verify the client IP](DEPLOYMENT.md#verify-the-client-ip-must-be-done-on-a-deployment)
before going live. Do not place another proxy/CDN in front of Vercel.

**IPv6.** Vercel's domains currently publish no AAAA records, so clients connect over IPv4 and the office
appears as its IPv4 address. IPv6 client addresses are handled (and matched against IPv6 allowlist entries)
should that change.

### Localhost vs the office network (local testing)

The office public IP (e.g. `169.224.96.169`) is the address the office router's NAT gives outgoing
traffic; only servers *on the internet* see it. A browser opening `http://localhost:3000` connects over the
loopback interface and never reaches that router, so the server correctly sees `127.0.0.1` / `::1`.
(A phone on the office Wi-Fi opening the developer machine's LAN address is seen as `192.168.x.x`.)
No server code can recover the public IP from a local connection, and forwarding headers are client
input, so neither is used to fake it.

- **Loopback is never allowed automatically.** The admin API refuses loopback ranges (`127.0.0.0/8`,
  `::1`) as allowed networks (`loopback_network`), and the seed does not allow-list them. If an older
  database still has such an entry (the previous seed added `127.0.0.1/32`, `::1/128` and
  `192.168.0.0/16`), deactivate it in Admin → Allowed networks.
- **Local testing is explicit:** set `NUXT_DEV_LOOPBACK_CLIENT_IP` to the office public IP. Only a request
  whose direct peer is loopback (and whose IP did not come from a trusted proxy header) is then checked as
  that address — which must still be in the allowlist, so an unlisted value is rejected. LAN, public and
  unknown peers are unaffected, and no request header can choose the address. The server logs a warning
  at startup while it is set. It is honoured in `development` and `test` only: with
  `NUXT_APP_ENV=production` the server refuses to start, and the value is ignored regardless.
- Every pre-check and submission logs one line with the direct peer, the resolved client IP and how it was
  obtained, e.g. `[net] precheck emp=E004 action=check_in peer=::1 ip=169.224.96.169
  source=dev-peer+loopback-override → ACCEPT`. Admin → Allowed networks → *Test from this browser* shows
  the same and flags a loopback (localhost) browser.
- To test the real network path, deploy (or tunnel) the app to a host outside the office and open it
  from the office Wi-Fi: the server then sees the office public IP.

### Network limitations (communicate these to staff)

- **VPNs, iCloud Private Relay, corporate proxies and mobile data** change the public IP — attendance from
  those connections is rejected. Employees must use the office Wi-Fi with VPN/Private Relay off.
- Everyone behind the same public IP matches (e.g. a shared building network, or a neighbour on the same
  ISP CGNAT range if you allow-list a broad range). Allow-list the narrowest range possible; the geofence
  and biometric checks remain required.
- If the ISP changes the office IP, attendance fails until the allowlist is updated.
- IPv6: if the office has IPv6, add its prefix too (devices may prefer IPv6).

## C. Biometric verification (WebAuthn)

- Employees register their device's **platform authenticator** (Face ID, Touch ID, Android biometrics /
  screen lock, Windows Hello). Registration requires user verification; new devices need HR approval
  (configurable) and are capped per employee. Devices can be revoked by the employee or HR.
- Stored per credential: credential ID, **public key**, signature counter, transports, AAGUID / authenticator
  name, device type and backup state. **No fingerprints, face templates or images are ever received or
  stored** — they never leave the device.
- Every attendance action performs a **new** authentication ceremony with `userVerification: "required"`;
  the server verifies signature, challenge, origin, RP ID, the User-Verified flag and the counter.

**Important:** WebAuthn tells the server that the authenticator verified the user locally. It does **not**
reveal whether the user used a fingerprint, their face or the device PIN/pattern — that is decided by the
device and its settings. Synced passkeys (iCloud Keychain, Google Password Manager) can exist on several
of the employee's devices; HR sees the "synced passkey" marker when approving.

## Sessions

- Absolute lifetime **10 minutes** and idle timeout **10 minutes** (`NUXT_SESSION_*`), whichever is first;
  never extended beyond the absolute limit; background polling is passive.
- Expired sessions are revoked server-side and the Supabase token signed out. The Supabase refresh token
  is never stored or sent to the browser.
- Supabase JWT expiry must be **≥ the absolute session lifetime** (the repo config sets 600 s).

## Authorisation (RBAC + RLS)

| Role | Scope | Default permissions |
|---|---|---|
| Owner / Super Admin | organisation | everything |
| HR Manager | organisation | employees, departments, schedules, attendance (read/adjust/lock), leave, holidays, reports, devices, security events |
| Department Manager | managed departments | read employees/attendance/leave, approve leave, request corrections, reports |
| Employee | self | own attendance, leave, devices, reports |

Permissions are editable by the Owner (Admin → Roles & permissions) and are enforced both by the API
(`requireAuth({ permission })`) and by RLS helpers (`app.has_permission`, `app.can_read_employee`,
`app.can_manage_employee`). Every user can always read their own data.

## Audit

- Row-change triggers on configuration and workflow tables record actor, IP, old/new values.
- The API logs sign-ins, failed sign-ins, logouts, session expiry, device registration/approval/revocation,
  every attendance action, rejected/suspicious attempts, corrections, leave decisions, exports and setting
  changes. Audit rows cannot be modified or deleted.

## Operational recommendations

- Serve only over HTTPS (WebAuthn and geolocation require a secure context). Enable HSTS at the proxy.
- Keep `NUXT_SUPABASE_SERVICE_ROLE_KEY` and `NUXT_SESSION_SECRET` in a secret manager; rotate the session
  secret to invalidate all sessions instantly.
- Disable public sign-up in Supabase Auth (done in `supabase/config.toml`; set the same in the dashboard).
- Review Admin → Security weekly (rejected and risky attempts) and lock payroll months after processing.
- CSP: every HTML document gets a policy whose `script-src` lists the SHA-256 hash of each inline
  script actually present (Nuxt's runtime-config bootstrap, Nuxt UI's colour-mode script, the import map —
  `server/plugins/csp.ts`). Scripts never get `'unsafe-inline'` or `'unsafe-eval'`, in any environment.
  `style-src` keeps `'unsafe-inline'` because Vite and UI libraries inject `<style>` elements at runtime;
  injected styles cannot execute script. Zod runs jitless in the browser so its eval probe never fires.
  In development only, the hash of Nuxt's static dev error-overlay script is added so the overlay can
  display errors; production policies contain only the hashes of the page's own inline scripts.
- In `nuxi dev` the app runs in a worker behind Nitro's dev proxy (IPC pipe), so it has no TCP peer of its
  own, and that proxy forwards a client-sent `X-Forwarded-For` unchanged. That header is therefore not
  used. `modules/dev-client-peer.ts` runs in the dev server's main process, ahead of the proxy: it drops
  any client copy of `x-etijah-dev-peer` and writes the real socket peer into it with a random
  per-process token that only the dev process and its workers share (`server/lib/dev-peer.ts`). The
  worker accepts the peer only with that token and removes the header (`server/middleware/00.dev-peer.ts`);
  without it the client IP is unknown and network checks fail. Production builds never read the header —
  they use the TCP peer address and the trusted-proxy rules above.
