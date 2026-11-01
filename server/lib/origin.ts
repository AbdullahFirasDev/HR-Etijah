/**
 * Same-origin (CSRF) decision for state-changing API requests.
 *
 * The allow-list is the configured application origins (NUXT_WEBAUTHN_ORIGINS — the same
 * origins WebAuthn is bound to). Nothing derived from request headers is ever added to it in
 * production. In development only, a loopback origin (localhost / 127.0.0.1 / [::1]) is also
 * accepted when it exactly equals the origin the request was addressed to, so opening the dev
 * server under another loopback name does not break sign-in.
 *
 * The "addressed-to" origin uses the Host header; Forwarded / X-Forwarded-Host /
 * X-Forwarded-Proto are only honoured when the TCP peer is a trusted proxy.
 */

export type CsrfReason = 'csrf_origin_mismatch' | 'csrf_cross_site' | 'csrf_header_missing' | 'csrf_origin_invalid'

export interface CsrfInput {
  method: string
  origin: string | undefined
  fetchSite: string | undefined
  requestedWith: string | undefined
  allowedOrigins: string[]
  /** Origin the request was addressed to (see requestOrigin). */
  targetOrigin: string | null
  dev: boolean
}

export type CsrfResult = { ok: true } | { ok: false, reason: CsrfReason }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Canonical "scheme://host[:port]" (default ports dropped, lower-case), or null if not an http(s) origin. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value || value === 'null') {
    return null
  }
  try {
    const u = new URL(value)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return null
    }
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
      return null
    }
    return u.origin.toLowerCase()
  }
  catch {
    return null
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK.has(new URL(origin).hostname)
  }
  catch {
    return false
  }
}

/** First value of an RFC 7239 `Forwarded` header parameter (e.g. host, proto, for). */
export function forwardedParam(header: string | undefined, param: 'host' | 'proto' | 'for'): string | undefined {
  if (!header) {
    return undefined
  }
  const first = header.split(',')[0] ?? ''
  for (const part of first.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k?.toLowerCase() === param) {
      return v.join('=').trim().replace(/^"|"$/g, '')
    }
  }
  return undefined
}

/**
 * The origin the client addressed. Forwarded headers are used only when `trustedPeer` is true
 * (the TCP peer is one of our configured reverse proxies); otherwise they are ignored.
 */
export function requestOrigin(input: {
  host: string | undefined
  encrypted: boolean
  headers: Record<string, string | string[] | undefined>
  trustedPeer: boolean
}): string | null {
  const h = (name: string) => {
    const v = input.headers[name]
    return Array.isArray(v) ? v[0] : v
  }
  let host = input.host
  let proto = input.encrypted ? 'https' : 'http'
  if (input.trustedPeer) {
    const fwd = h('forwarded')
    host = forwardedParam(fwd, 'host') ?? h('x-forwarded-host')?.split(',')[0]?.trim() ?? host
    const p = forwardedParam(fwd, 'proto') ?? h('x-forwarded-proto')?.split(',')[0]?.trim()
    if (p === 'http' || p === 'https') {
      proto = p
    }
  }
  if (!host || /[\s/\\@]/.test(host)) {
    return null
  }
  return normalizeOrigin(`${proto}://${host}`)
}

export function checkCsrf(input: CsrfInput): CsrfResult {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return { ok: true }
  }
  if (input.requestedWith !== 'hr-app') {
    return { ok: false, reason: 'csrf_header_missing' }
  }
  if (input.origin !== undefined) {
    const origin = normalizeOrigin(input.origin)
    if (!origin) {
      return { ok: false, reason: 'csrf_origin_invalid' }
    }
    const allowed = input.allowedOrigins.map(normalizeOrigin).filter((o): o is string => !!o)
    if (allowed.includes(origin)) {
      return { ok: true }
    }
    if (input.dev && isLoopbackOrigin(origin) && origin === input.targetOrigin) {
      return { ok: true }
    }
    return { ok: false, reason: 'csrf_origin_mismatch' }
  }
  // No Origin header (some same-origin requests): rely on Fetch Metadata when present.
  if (input.fetchSite && input.fetchSite !== 'same-origin' && input.fetchSite !== 'none') {
    return { ok: false, reason: 'csrf_cross_site' }
  }
  return { ok: true }
}
