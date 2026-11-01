/**
 * Vercel deployment: client IP from Vercel's edge headers (and nowhere else), the production
 * public-IP rule, allowlist entries, Vercel-specific configuration checks and the cron secret.
 * These prove the server's decisions for given headers; that Vercel's edge really overwrites the
 * headers must still be confirmed on a deployment (docs/DEPLOYMENT.md, "Verify the client IP").
 */
import { describe, expect, it } from 'vitest'
import { isPublicSuffixRpId, validateServerConfig, type RawServerConfig } from '~~/server/lib/config-validate'
import { cronAuthorized } from '~~/server/lib/cron-auth'
import { ipInAny, isPublicCidr, isPublicIp, resolveClientIp, type ClientIpOptions } from '~~/server/lib/ip'

const OFFICE_IP = '169.224.96.169'
const OFFICE_V6 = '2a00:1450:4001:81a::200e' // a public IPv6 address standing in for an office prefix
const ALLOWLIST = [`${OFFICE_IP}/32`]
const allowed = (ip: string | null, list = ALLOWLIST) => !!ip && ipInAny(ip, list)

const vercel: ClientIpOptions = { mode: 'vercel', trustedProxies: [], onVercel: true, publicOnly: true }
/** Headers as Vercel's edge sets them for a client connecting from `ip`. */
const edge = (ip: string) => ({ 'x-vercel-forwarded-for': ip, 'x-real-ip': ip, 'x-forwarded-for': ip })
const PROXY_PEER = '10.12.0.7' // the function's TCP peer on Vercel is Vercel's own proxy

describe('client IP on Vercel', () => {
  it('accepts the approved office IPv4 reported by the edge', () => {
    const r = resolveClientIp(PROXY_PEER, edge(OFFICE_IP), vercel)
    expect(r).toEqual({ ip: OFFICE_IP, source: 'vercel' })
    expect(allowed(r.ip)).toBe(true)
  })

  it('rejects an unapproved IPv4', () => {
    const r = resolveClientIp(PROXY_PEER, edge('203.0.114.20'), vercel)
    expect(r.ip).toBe('203.0.114.20')
    expect(allowed(r.ip)).toBe(false)
  })

  it('handles IPv6 clients: rejected unless the office IPv6 prefix is allowed', () => {
    const r = resolveClientIp(PROXY_PEER, edge(OFFICE_V6), vercel)
    expect(r).toEqual({ ip: OFFICE_V6, source: 'vercel' })
    expect(allowed(r.ip)).toBe(false)
    expect(allowed(r.ip, [...ALLOWLIST, '2a00:1450:4001::/48'])).toBe(true)
    // IPv4-mapped IPv6 is the same IPv4 client
    expect(resolveClientIp(PROXY_PEER, edge(`::ffff:${OFFICE_IP}`), vercel).ip).toBe(OFFICE_IP)
  })

  it('needs only x-vercel-forwarded-for, and ignores the TCP peer', () => {
    expect(resolveClientIp(PROXY_PEER, { 'x-vercel-forwarded-for': OFFICE_IP }, vercel).ip).toBe(OFFICE_IP)
    expect(resolveClientIp(OFFICE_IP, {}, vercel)).toEqual({ ip: null, source: 'vercel-invalid:x-vercel-forwarded-for' })
  })

  it('fails closed when the headers disagree, repeat, or are malformed', () => {
    const cases: Record<string, string | string[]>[] = [
      { 'x-vercel-forwarded-for': '203.0.114.20', 'x-forwarded-for': OFFICE_IP }, // spoof attempt surviving a proxy
      { 'x-vercel-forwarded-for': '203.0.114.20', 'x-real-ip': OFFICE_IP },
      { 'x-real-ip': OFFICE_IP, 'x-forwarded-for': OFFICE_IP }, // edge header missing
      { 'x-vercel-forwarded-for': `${OFFICE_IP}, 10.0.0.1` },
      { 'x-vercel-forwarded-for': [OFFICE_IP, OFFICE_IP] },
      { 'x-vercel-forwarded-for': 'office' },
      { 'x-vercel-forwarded-for': `${OFFICE_IP}/32` },
    ]
    for (const headers of cases) {
      expect(resolveClientIp(PROXY_PEER, headers, vercel).ip, JSON.stringify(headers)).toBeNull()
    }
  })

  it('never trusts these headers off Vercel, where anyone can set them', () => {
    expect(resolveClientIp(PROXY_PEER, edge(OFFICE_IP), { ...vercel, onVercel: false })).toEqual({ ip: null, source: 'vercel-unavailable' })
  })

  it('ignores spoofed headers in the other modes', () => {
    const spoofed = { ...edge(OFFICE_IP), 'forwarded': `for=${OFFICE_IP}`, 'cf-connecting-ip': OFFICE_IP }
    expect(resolveClientIp('203.0.114.20', spoofed, { mode: 'none', trustedProxies: [], publicOnly: true }).ip).toBe('203.0.114.20')
    expect(resolveClientIp('203.0.114.20', spoofed, { mode: 'xff', trustedProxies: ['10.0.0.0/8'], publicOnly: true }).ip).toBe('203.0.114.20')
  })

  it('does not apply the local-testing loopback setting', () => {
    expect(resolveClientIp('127.0.0.1', edge('127.0.0.1'), { ...vercel, publicOnly: false, loopbackOverride: OFFICE_IP }).ip).toBe('127.0.0.1')
  })
})

describe('production accepts only public client IPs', () => {
  const NON_PUBLIC = ['127.0.0.1', '::1', '192.168.100.89', '10.0.0.5', '172.16.4.2', '169.254.1.1', '100.64.0.9', '0.0.0.0', 'fd12:3456::1', 'fe80::1', '203.0.113.9', '2001:db8::1']

  it('treats loopback, private LAN, link-local, CGNAT, ULA and documentation addresses as unknown', () => {
    for (const ip of NON_PUBLIC) {
      expect(resolveClientIp(PROXY_PEER, edge(ip), vercel).ip, ip).toBeNull()
      expect(resolveClientIp(ip, {}, { mode: 'none', trustedProxies: [], publicOnly: true }).ip, ip).toBeNull()
      expect(isPublicIp(ip), ip).toBe(false)
    }
    expect(resolveClientIp('192.168.100.89', {}, { mode: 'none', trustedProxies: [], publicOnly: true }).source).toBe('socket+non-public')
  })

  it('keeps public IPv4 and IPv6 clients', () => {
    for (const ip of [OFFICE_IP, OFFICE_V6, '8.8.8.8']) {
      expect(isPublicIp(ip), ip).toBe(true)
    }
  })

  it('outside production a LAN client is still resolved (and checked against the allowlist as usual)', () => {
    expect(resolveClientIp('192.168.100.89', {}, { mode: 'none', trustedProxies: [] }).ip).toBe('192.168.100.89')
  })

  it('only public ranges can be active allowlist entries in production', () => {
    for (const c of [`${OFFICE_IP}/32`, '169.224.0.0/16', '2a00:1450:4001::/48']) {
      expect(isPublicCidr(c), c).toBe(true)
    }
    for (const c of ['192.168.100.89/32', '10.0.0.0/8', '::1/128', '0.0.0.0/0', '::/0', 'fd00::/8', '203.0.113.0/24']) {
      expect(isPublicCidr(c), c).toBe(false)
    }
  })
})

describe('configuration checks on Vercel', () => {
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`
  const vercelProd: RawServerConfig = {
    onVercel: true,
    supabaseUrl: 'https://abc.supabase.co',
    supabaseAnonKey: jwt('anon'),
    supabaseServiceRoleKey: jwt('service_role'),
    sessionSecret: 'Q1w2E3r4T5y6U7i8O9p0AaSsDdFfGgHhJjKkLl',
    sessionAbsoluteSeconds: 600,
    sessionIdleSeconds: 600,
    cookieSecure: true,
    webauthnRpId: 'hr.etijah.com',
    webauthnOrigins: ['https://hr.etijah.com'],
    trustProxyMode: 'vercel',
    trustedProxyCidrs: [],
    clientIpHeader: '',
    devLoopbackClientIp: '',
    rateLimitStore: 'database',
    cronSecret: 'c'.repeat(12) + 'R4nd0mCr0nS3cr',
    vapidPublicKey: '',
    vapidPrivateKey: '',
  }
  const errors = (c: Partial<RawServerConfig>, env: 'development' | 'production' = 'production') =>
    validateServerConfig({ ...vercelProd, ...c }, env).errors.map(e => e.setting)

  it('accepts a complete Vercel production configuration', () => {
    expect(errors({})).toEqual([])
  })

  it('requires the vercel client-IP mode on Vercel, and only there', () => {
    expect(errors({ trustProxyMode: 'none' })).toEqual(['NUXT_TRUST_PROXY_MODE'])
    expect(errors({ trustProxyMode: 'header', clientIpHeader: 'x-real-ip' })).toEqual(['NUXT_TRUST_PROXY_MODE'])
    expect(errors({ onVercel: false })).toEqual(['NUXT_TRUST_PROXY_MODE'])
  })

  it('requires shared rate limits and the cron secret on Vercel', () => {
    expect(errors({ rateLimitStore: 'memory' })).toEqual(['NUXT_RATE_LIMIT_STORE'])
    expect(errors({ rateLimitStore: 'redis' })).toContain('NUXT_RATE_LIMIT_STORE')
    expect(errors({ cronSecret: '' })).toEqual(['CRON_SECRET'])
  })

  it('refuses the loopback testing setting, http origins and insecure cookies in production', () => {
    expect(errors({ devLoopbackClientIp: OFFICE_IP })).toEqual(['NUXT_DEV_LOOPBACK_CLIENT_IP'])
    expect(errors({ webauthnOrigins: ['http://hr.etijah.com'] })).toEqual(['NUXT_WEBAUTHN_ORIGINS'])
    expect(errors({ cookieSecure: false })).toEqual(['NUXT_COOKIE_SECURE'])
  })

  it('only warns outside production (a misconfigured preview fails closed instead of starting wrong)', () => {
    const r = validateServerConfig({ ...vercelProd, trustProxyMode: 'none', rateLimitStore: 'memory', cronSecret: '' }, 'development')
    expect(r.errors).toEqual([])
    expect(r.warnings.map(w => w.setting)).toEqual(expect.arrayContaining(['NUXT_TRUST_PROXY_MODE', 'NUXT_RATE_LIMIT_STORE', 'CRON_SECRET']))
  })

  it('rejects a public-suffix WebAuthn RP ID such as vercel.app', () => {
    expect(errors({ webauthnRpId: 'vercel.app', webauthnOrigins: ['https://etijah-hr.vercel.app'] })).toEqual(['NUXT_WEBAUTHN_RP_ID'])
    expect(errors({ webauthnRpId: 'etijah-hr.vercel.app', webauthnOrigins: ['https://etijah-hr.vercel.app'] })).toEqual([])
    expect(isPublicSuffixRpId('com')).toBe(true)
    expect(isPublicSuffixRpId('localhost')).toBe(false)
  })
})

describe('cron secret', () => {
  const SECRET = 'k9Vx2mQ7rT4pZ8wL1nB6yH3s'
  it('accepts exactly `Bearer <CRON_SECRET>`', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(true)
  })
  it('rejects anything else, and everything when no strong secret is configured', () => {
    for (const h of [undefined, '', SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, `Basic ${SECRET}`, `Bearer ${SECRET} extra`]) {
      expect(cronAuthorized(h, SECRET), String(h)).toBe(false)
    }
    expect(cronAuthorized('Bearer short', 'short')).toBe(false)
    expect(cronAuthorized('Bearer ', '')).toBe(false)
  })
})
