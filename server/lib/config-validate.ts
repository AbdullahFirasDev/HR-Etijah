/**
 * Server configuration validation. Messages name the setting but never include its value.
 *
 *   development — local http://localhost allowed, insecure cookies allowed (with warnings)
 *   test        — like development, and Supabase key formats are not checked (fake keys)
 *   production  — https origins, Secure cookies, real key formats; errors abort startup
 */
import { isLoopbackIp, isValidCidr, normalizeIp } from './ip'
import { normalizeOrigin } from './origin'

export type AppEnv = 'development' | 'test' | 'production'

export interface RawServerConfig {
  /** Running on Vercel (VERCEL=1). */
  onVercel: boolean
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey: string
  sessionSecret: string
  sessionAbsoluteSeconds: number
  sessionIdleSeconds: number
  cookieSecure: boolean
  webauthnRpId: string
  webauthnOrigins: string[]
  trustProxyMode: string
  trustedProxyCidrs: string[]
  clientIpHeader: string
  devLoopbackClientIp: string
  rateLimitStore: string
  cronSecret: string
  vapidPublicKey: string
  vapidPrivateKey: string
}

export interface ConfigIssue {
  setting: string
  message: string
}

export interface ConfigReport {
  env: AppEnv
  errors: ConfigIssue[]
  warnings: ConfigIssue[]
}

export function resolveAppEnv(explicit: string | undefined, dev: boolean): AppEnv {
  const v = (explicit ?? '').trim().toLowerCase()
  if (v === 'development' || v === 'test' || v === 'production') {
    return v
  }
  return dev ? 'development' : 'production'
}

/** Role claim of a legacy Supabase JWT key, or the kind of a new-style key. */
export function supabaseKeyKind(key: string): 'anon' | 'service_role' | 'publishable' | 'secret' | 'other' {
  if (key.startsWith('sb_publishable_')) return 'publishable'
  if (key.startsWith('sb_secret_')) return 'secret'
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const role = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))?.role
      if (role === 'anon' || role === 'service_role') return role
    }
    catch {
      // not a JWT
    }
  }
  return 'other'
}

/**
 * Public suffixes of hosting platforms: browsers refuse them as a WebAuthn RP ID (the RP ID must
 * be the full app host there, e.g. etijah-hr.vercel.app, or the company's own domain).
 */
const PLATFORM_SUFFIXES = new Set(['vercel.app', 'now.sh', 'netlify.app', 'pages.dev', 'github.io', 'herokuapp.com', 'onrender.com', 'fly.dev', 'web.app', 'firebaseapp.com'])

export function isPublicSuffixRpId(rpId: string): boolean {
  const id = rpId.trim().toLowerCase()
  return PLATFORM_SUFFIXES.has(id) || (!id.includes('.') && id !== 'localhost')
}

/** WebAuthn requires the RP ID to equal, or be a registrable suffix of, the origin's host. */
export function rpIdMatchesOrigin(rpId: string, origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    const id = rpId.toLowerCase()
    return host === id || host.endsWith(`.${id}`)
  }
  catch {
    return false
  }
}

const routableIp = (ip: string | null) => !!ip && !isLoopbackIp(ip) && ip !== '0.0.0.0' && ip !== '::'

/**
 * The address that stands in for loopback requests (NUXT_DEV_LOOPBACK_CLIENT_IP), or null.
 * Never active in production, whatever the setting says.
 */
export function effectiveLoopbackClientIp(env: AppEnv, value: string): string | null {
  const ip = env === 'production' ? null : normalizeIp(value)
  return routableIp(ip) ? ip : null
}

export function validateServerConfig(c: RawServerConfig, env: AppEnv): ConfigReport {
  const errors: ConfigIssue[] = []
  const warnings: ConfigIssue[] = []
  const err = (setting: string, message: string) => errors.push({ setting, message })
  const warn = (setting: string, message: string) => warnings.push({ setting, message })
  const prod = env === 'production'

  // --- Supabase ---------------------------------------------------------------------------
  if (!c.supabaseUrl) {
    err('NUXT_SUPABASE_URL', 'is not set')
  }
  else {
    try {
      const u = new URL(c.supabaseUrl)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') err('NUXT_SUPABASE_URL', 'must be an http(s) URL')
      else if (prod && u.protocol !== 'https:') err('NUXT_SUPABASE_URL', 'must use https in production')
    }
    catch {
      err('NUXT_SUPABASE_URL', 'is not a valid URL')
    }
  }
  if (!c.supabaseAnonKey) err('NUXT_SUPABASE_ANON_KEY', 'is not set')
  if (!c.supabaseServiceRoleKey) err('NUXT_SUPABASE_SERVICE_ROLE_KEY', 'is not set')
  if (c.supabaseAnonKey && c.supabaseAnonKey === c.supabaseServiceRoleKey) {
    err('NUXT_SUPABASE_SERVICE_ROLE_KEY', 'must differ from NUXT_SUPABASE_ANON_KEY')
  }
  if (env !== 'test') {
    const anon = c.supabaseAnonKey ? supabaseKeyKind(c.supabaseAnonKey) : null
    const svc = c.supabaseServiceRoleKey ? supabaseKeyKind(c.supabaseServiceRoleKey) : null
    if (anon && anon !== 'anon' && anon !== 'publishable') err('NUXT_SUPABASE_ANON_KEY', 'is not an anon / publishable key')
    if (svc && svc !== 'service_role' && svc !== 'secret') err('NUXT_SUPABASE_SERVICE_ROLE_KEY', 'is not a service_role / secret key')
  }

  // --- Session ----------------------------------------------------------------------------
  if (!c.sessionSecret) err('NUXT_SESSION_SECRET', 'is not set')
  else if (c.sessionSecret.length < 32) err('NUXT_SESSION_SECRET', 'must be at least 32 characters')
  else if (new Set(c.sessionSecret).size < 12) err('NUXT_SESSION_SECRET', 'is too predictable (use a random value)')
  for (const [name, v] of [['NUXT_SESSION_ABSOLUTE_SECONDS', c.sessionAbsoluteSeconds], ['NUXT_SESSION_IDLE_SECONDS', c.sessionIdleSeconds]] as const) {
    if (!Number.isFinite(v) || v < 60 || v > 86_400) err(name, 'must be between 60 and 86400 seconds')
  }

  // --- Origins / WebAuthn / cookies ---------------------------------------------------------
  if (c.webauthnOrigins.length === 0) err('NUXT_WEBAUTHN_ORIGINS', 'is not set (comma-separated app origins, e.g. http://localhost:3000)')
  const origins: string[] = []
  for (const o of c.webauthnOrigins) {
    const n = normalizeOrigin(o)
    if (!n) err('NUXT_WEBAUTHN_ORIGINS', 'contains an entry that is not a scheme://host[:port] origin')
    else origins.push(n)
  }
  if (!c.webauthnRpId) {
    err('NUXT_WEBAUTHN_RP_ID', 'is not set')
  }
  else if (isPublicSuffixRpId(c.webauthnRpId)) {
    err('NUXT_WEBAUTHN_RP_ID', 'is a public suffix that browsers refuse; use the full app host (e.g. etijah-hr.vercel.app) or your own domain')
  }
  else {
    for (const o of origins) {
      if (!rpIdMatchesOrigin(c.webauthnRpId, o)) {
        err('NUXT_WEBAUTHN_RP_ID', `does not match origin ${o} (RP ID must be that host or a parent domain)`)
      }
    }
  }
  const httpOrigins = origins.filter(o => o.startsWith('http://'))
  if (prod) {
    if (httpOrigins.length) err('NUXT_WEBAUTHN_ORIGINS', 'must use https in production')
    if (!c.cookieSecure) err('NUXT_COOKIE_SECURE', 'must be true in production')
  }
  else if (c.cookieSecure && httpOrigins.length) {
    warn('NUXT_COOKIE_SECURE', 'is true while an origin uses http: Chrome/Firefox accept Secure cookies on localhost, Safari does not — set false for local http development')
  }

  // --- Client IP / proxies ------------------------------------------------------------------
  if (!['none', 'xff', 'header', 'vercel'].includes(c.trustProxyMode)) err('NUXT_TRUST_PROXY_MODE', 'must be none, xff, header or vercel')
  // On Vercel the TCP peer is Vercel's proxy, and only Vercel's edge overwrites its IP headers.
  const report = prod ? err : warn
  if (c.onVercel && c.trustProxyMode !== 'vercel') report('NUXT_TRUST_PROXY_MODE', 'must be vercel when running on Vercel (otherwise the client IP would be the platform proxy and every attendance attempt is rejected)')
  if (!c.onVercel && c.trustProxyMode === 'vercel') report('NUXT_TRUST_PROXY_MODE', 'is vercel but the server is not running on Vercel (VERCEL=1 missing): the client IP is unknown and attendance is rejected')
  if (c.trustedProxyCidrs.some(x => !isValidCidr(x))) err('NUXT_TRUSTED_PROXY_CIDRS', 'contains an invalid IP/CIDR')
  if (c.trustProxyMode === 'xff' && c.trustedProxyCidrs.length === 0) err('NUXT_TRUSTED_PROXY_CIDRS', 'is required when NUXT_TRUST_PROXY_MODE=xff')
  if (c.trustProxyMode === 'header' && !c.clientIpHeader) err('NUXT_CLIENT_IP_HEADER', 'is required when NUXT_TRUST_PROXY_MODE=header')
  if (c.trustProxyMode === 'none' && c.trustedProxyCidrs.length > 0) warn('NUXT_TRUSTED_PROXY_CIDRS', 'is ignored while NUXT_TRUST_PROXY_MODE=none')
  if (c.devLoopbackClientIp) {
    const ip = normalizeIp(c.devLoopbackClientIp)
    if (prod) err('NUXT_DEV_LOOPBACK_CLIENT_IP', 'must not be set in production: the real client address is always verified there')
    else if (!ip) err('NUXT_DEV_LOOPBACK_CLIENT_IP', 'must be a single IP address (no CIDR), e.g. the office public IPv4')
    else if (!routableIp(ip)) err('NUXT_DEV_LOOPBACK_CLIENT_IP', 'must be a routable address, not loopback/unspecified')
    else warn('NUXT_DEV_LOOPBACK_CLIENT_IP', 'is set: requests from this machine (loopback) are network-checked as that address, which must still be in the company IP allowlist. Local testing only')
  }

  // --- Rate limiting ------------------------------------------------------------------------
  if (!['memory', 'database'].includes(c.rateLimitStore)) err('NUXT_RATE_LIMIT_STORE', 'must be memory or database')
  if (c.onVercel && c.rateLimitStore !== 'database') report('NUXT_RATE_LIMIT_STORE', 'must be database on Vercel: per-instance memory counters do not hold login and attendance limits across serverless instances')

  // --- Optional features ---------------------------------------------------------------------
  if (c.cronSecret && c.cronSecret.length < 24) err('NUXT_CRON_SECRET', 'must be at least 24 characters when set')
  if (!!c.vapidPublicKey !== !!c.vapidPrivateKey) err('NUXT_VAPID_PRIVATE_KEY', 'and NUXT_PUBLIC_VAPID_PUBLIC_KEY must be set together')
  if (c.onVercel && !c.cronSecret) report('CRON_SECRET', 'is required on Vercel: the housekeeping job (missing check-outs, absences, purges) runs only through Vercel Cron')
  else if (prod && !c.cronSecret) warn('NUXT_CRON_SECRET', 'is empty: /api/cron/daily is disabled (fine if the Node server runs the scheduled task itself)')

  return { env, errors, warnings }
}
