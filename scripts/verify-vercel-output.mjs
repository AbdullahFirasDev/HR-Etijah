#!/usr/bin/env node
/**
 * Checks a Vercel build (`npm run build:vercel` → .vercel/output) before anything is deployed:
 *  - Node.js function runtime, Vercel Cron entry for the housekeeping job
 *  - edge headers per path, by evaluating config.json routes the way Vercel's first routing phase
 *    does: HTML pages must NOT receive an edge Content-Security-Policy (their hash-based policy
 *    comes from the function), assets/API must get the strict resource policy, /sw.js its own
 *  - no prerendered HTML that would bypass the per-response CSP
 *  - no server secret from the environment in the client or server bundle (names only are printed;
 *    run with `node --env-file=.env scripts/verify-vercel-output.mjs` to include local secrets)
 * Exit code 1 on any failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(root, '.vercel', 'output')
const failures = []
const ok = msg => console.log(`  ok   ${msg}`)
const fail = (msg) => {
  failures.push(msg)
  console.log(`  FAIL ${msg}`)
}

if (!existsSync(join(out, 'config.json'))) {
  console.error('No .vercel/output/config.json — run `npm run build:vercel` first.')
  process.exit(1)
}
const config = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8'))

console.log('Function')
const vc = JSON.parse(readFileSync(join(out, 'functions', '__fallback.func', '.vc-config.json'), 'utf8'))
if (vc.runtime === 'nodejs24.x') ok(`runtime ${vc.runtime}`)
else fail(`runtime is ${vc.runtime}, expected nodejs24.x (package.json engines 24.x)`)

console.log('Cron')
const cron = (config.crons ?? []).find(c => c.path === '/api/cron/daily')
if (cron) ok(`/api/cron/daily at "${cron.schedule}"${/^\d+ \d+ \* \* \*$/.test(cron.schedule) ? ' (daily: Hobby-compatible)' : ' (more than daily: requires Vercel Pro)'}`)
else fail('no Vercel Cron entry for /api/cron/daily')

console.log('Edge headers')
/** Headers Vercel's first routing phase attaches to a path (routes before `handle`). */
function edgeHeaders(path) {
  const headers = {}
  for (const route of config.routes ?? []) {
    if (route.handle) break
    if (!route.headers || !new RegExp(`^${route.src}$`).test(path)) continue
    for (const [k, v] of Object.entries(route.headers)) headers[k.toLowerCase()] = v
    if (!route.continue) break
  }
  return headers
}
const RESOURCE = "default-src 'none'"
for (const page of ['/', '/login', '/admin', '/admin/settings/network', '/history', '/auth/reset', '/no-such-page']) {
  const h = edgeHeaders(page)
  if (h['content-security-policy']) fail(`${page}: edge CSP "${h['content-security-policy']}" would also apply to the HTML document`)
  else if (h['x-frame-options'] !== 'DENY' || !h['permissions-policy']) fail(`${page}: security headers missing`)
  else ok(`${page}: security headers, no edge CSP (document policy comes from the function)`)
}
for (const asset of ['/_nuxt/entry.js', '/_fonts/a.woff2', '/_i18n/x/ar/messages.json', '/icons/pwa-192x192.png', '/manifest.webmanifest', '/favicon.ico', '/api/auth/session']) {
  const csp = edgeHeaders(asset)['content-security-policy'] ?? ''
  if (csp.startsWith(RESOURCE)) ok(`${asset}: strict resource CSP`)
  else fail(`${asset}: expected the strict resource CSP, got "${csp}"`)
}
const sw = edgeHeaders('/sw.js')
if (sw['content-security-policy']?.includes("script-src 'self'") && sw['cache-control'] === 'no-cache') ok('/sw.js: worker CSP, no-cache')
else fail('/sw.js: worker CSP / no-cache missing')
if (edgeHeaders('/api/attendance/precheck')['cache-control'] === 'no-store') ok('/api/**: Cache-Control no-store')
else fail('/api/**: Cache-Control no-store missing')

console.log('Static output')
for (const f of ['sw.js', 'manifest.webmanifest']) {
  if (existsSync(join(out, 'static', f))) ok(`${f} present`)
  else fail(`${f} missing from static output`)
}
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name)
  return e.isDirectory() ? files(p) : statSync(p).isFile() ? [p] : []
})
const staticFiles = files(join(out, 'static'))
const html = staticFiles.filter(f => f.endsWith('.html'))
if (html.length === 0) ok('no prerendered HTML (every document gets its CSP from the function)')
else fail(`prerendered HTML bypasses the CSP plugin: ${html.map(f => f.slice(out.length)).join(', ')}`)

console.log('Secrets')
const SECRET_SETTINGS = ['NUXT_SUPABASE_SERVICE_ROLE_KEY', 'NUXT_SESSION_SECRET', 'CRON_SECRET', 'NUXT_CRON_SECRET', 'NUXT_VAPID_PRIVATE_KEY']
const secrets = SECRET_SETTINGS.map(name => [name, (process.env[name] ?? '').trim()]).filter(([, v]) => v.length >= 16)
const serverFiles = files(join(out, 'functions', '__fallback.func')).filter(f => /\.(m?js|json)$/.test(f))
const scan = (list, label) => {
  for (const f of list) {
    const text = readFileSync(f, 'latin1')
    if (/sb_secret_[A-Za-z0-9]/.test(text)) fail(`${label}: Supabase secret key pattern in ${f.slice(out.length)}`)
    for (const [name, value] of secrets) {
      if (text.includes(value)) fail(`${label}: value of ${name} found in ${f.slice(out.length)}`)
    }
  }
}
scan(staticFiles, 'client bundle')
scan(serverFiles, 'server bundle')
if (!failures.some(f => f.includes('bundle'))) ok(`no secret values in client or server bundles (${secrets.length ? `checked ${secrets.map(([n]) => n).join(', ')}` : 'no secrets in this environment; pattern check only'})`)

console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.')
process.exit(failures.length ? 1 : 0)
