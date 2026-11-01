import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resolveAppEnv, rpIdMatchesOrigin, supabaseKeyKind, validateServerConfig, type RawServerConfig } from '~~/server/lib/config-validate'
import { documentCsp, inlineScriptHashes } from '~~/server/lib/csp'
import { checkCsrf, forwardedParam, normalizeOrigin, requestOrigin, type CsrfInput } from '~~/server/lib/origin'

describe('CSRF origin check', () => {
  const base: CsrfInput = {
    method: 'POST',
    origin: 'http://localhost:3000',
    fetchSite: 'same-origin',
    requestedWith: 'hr-app',
    allowedOrigins: ['http://localhost:3000'],
    targetOrigin: 'http://localhost:3000',
    dev: false,
  }

  it('accepts the configured origin (the local dev URL)', () => {
    expect(checkCsrf(base)).toEqual({ ok: true })
    expect(checkCsrf({ ...base, origin: 'HTTP://LOCALHOST:3000' })).toEqual({ ok: true })
  })

  it('rejects other origins — including the one that caused csrf_origin_mismatch', () => {
    expect(checkCsrf({ ...base, origin: 'https://evil.example' })).toEqual({ ok: false, reason: 'csrf_origin_mismatch' })
    expect(checkCsrf({ ...base, allowedOrigins: ['https://hr.example.com'] })).toEqual({ ok: false, reason: 'csrf_origin_mismatch' })
    expect(checkCsrf({ ...base, origin: 'http://localhost:3001' })).toEqual({ ok: false, reason: 'csrf_origin_mismatch' })
  })

  it('rejects opaque / malformed origins', () => {
    expect(checkCsrf({ ...base, origin: 'null' })).toEqual({ ok: false, reason: 'csrf_origin_invalid' })
    expect(checkCsrf({ ...base, origin: 'http://localhost:3000/path' })).toEqual({ ok: false, reason: 'csrf_origin_invalid' })
  })

  it('requires the app header and lets safe methods through', () => {
    expect(checkCsrf({ ...base, requestedWith: undefined })).toEqual({ ok: false, reason: 'csrf_header_missing' })
    expect(checkCsrf({ ...base, method: 'GET', requestedWith: undefined, origin: 'https://evil.example' })).toEqual({ ok: true })
  })

  it('uses Fetch Metadata when the Origin header is absent', () => {
    expect(checkCsrf({ ...base, origin: undefined, fetchSite: 'cross-site' })).toEqual({ ok: false, reason: 'csrf_cross_site' })
    expect(checkCsrf({ ...base, origin: undefined, fetchSite: 'same-origin' })).toEqual({ ok: true })
  })

  it('in development only, accepts a loopback origin that equals the addressed origin', () => {
    const viaIp = { ...base, origin: 'http://127.0.0.1:3000', targetOrigin: 'http://127.0.0.1:3000' }
    expect(checkCsrf({ ...viaIp, dev: true })).toEqual({ ok: true })
    expect(checkCsrf({ ...viaIp, dev: false })).toEqual({ ok: false, reason: 'csrf_origin_mismatch' })
    // not a loopback host, or not the addressed origin → still rejected in development
    expect(checkCsrf({ ...base, dev: true, allowedOrigins: [], origin: 'http://192.168.1.5:3000', targetOrigin: 'http://192.168.1.5:3000' }).ok).toBe(false)
    expect(checkCsrf({ ...base, dev: true, allowedOrigins: [], origin: 'http://localhost:4000', targetOrigin: 'http://localhost:3000' }).ok).toBe(false)
  })
})

describe('addressed origin and forwarded headers', () => {
  const fwd = { 'x-forwarded-host': 'hr.etijah.com', 'x-forwarded-proto': 'https' }

  it('uses the Host header and ignores forwarded headers from untrusted peers', () => {
    expect(requestOrigin({ host: 'localhost:3000', encrypted: false, headers: fwd, trustedPeer: false })).toBe('http://localhost:3000')
  })

  it('honours X-Forwarded-Host/Proto and RFC 7239 Forwarded only behind a trusted proxy', () => {
    expect(requestOrigin({ host: '127.0.0.1:3000', encrypted: false, headers: fwd, trustedPeer: true })).toBe('https://hr.etijah.com')
    const rfc = { forwarded: 'for=203.0.113.7;proto=https;host="hr.etijah.com"' }
    expect(requestOrigin({ host: '127.0.0.1:3000', encrypted: false, headers: rfc, trustedPeer: true })).toBe('https://hr.etijah.com')
    expect(forwardedParam('for=1.2.3.4;host=a.example, for=5.6.7.8', 'host')).toBe('a.example')
  })

  it('rejects malformed hosts', () => {
    expect(requestOrigin({ host: 'evil.example/path', encrypted: false, headers: {}, trustedPeer: false })).toBeNull()
    expect(normalizeOrigin('https://hr.etijah.com:443')).toBe('https://hr.etijah.com')
  })
})

describe('hash-based CSP', () => {
  const config = 'window.__NUXT__={};window.__NUXT__.config={public:{}}'
  const html = `<html><head><script type="importmap">{"imports":{}}</script><script>${config}</script>`
    + '<script type="application/json" id="__NUXT_DATA__">[1]</script><script type="module" src="/_nuxt/a.js"></script></head></html>'

  it('hashes executable inline scripts only', () => {
    const hashes = inlineScriptHashes(html)
    expect(hashes).toHaveLength(2)
    expect(hashes).toContain(`'sha256-${createHash('sha256').update(config).digest('base64')}'`)
  })

  it('never allows unsafe-inline or unsafe-eval for scripts', () => {
    const prod = documentCsp({ scriptHashes: inlineScriptHashes(html), dev: false })
    const scriptSrc = prod.split('; ').find(d => d.startsWith('script-src'))!
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/)
    expect(prod).toContain("frame-ancestors 'none'")
    expect(prod).not.toContain('ws:')
    expect(documentCsp({ scriptHashes: [], dev: true })).toContain('ws:')
  })
})

describe('server configuration validation', () => {
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`
  const good: RawServerConfig = {
    onVercel: false,
    supabaseUrl: 'https://abc.supabase.co',
    supabaseAnonKey: jwt('anon'),
    supabaseServiceRoleKey: jwt('service_role'),
    sessionSecret: 'Q1w2E3r4T5y6U7i8O9p0AaSsDdFfGgHhJjKkLl',
    sessionAbsoluteSeconds: 600,
    sessionIdleSeconds: 600,
    cookieSecure: true,
    webauthnRpId: 'hr.etijah.com',
    webauthnOrigins: ['https://hr.etijah.com'],
    trustProxyMode: 'none',
    trustedProxyCidrs: [],
    clientIpHeader: '',
    devLoopbackClientIp: '',
    rateLimitStore: 'memory',
    cronSecret: '',
    vapidPublicKey: '',
    vapidPrivateKey: '',
  }
  const settings = (c: Partial<RawServerConfig>, env: 'development' | 'test' | 'production' = 'production') =>
    validateServerConfig({ ...good, ...c }, env).errors.map(e => e.setting)

  it('accepts a correct production configuration', () => {
    expect(validateServerConfig(good, 'production').errors).toEqual([])
  })

  it('names missing settings without exposing values', () => {
    const r = validateServerConfig({ ...good, sessionSecret: '' }, 'development')
    expect(r.errors).toEqual([{ setting: 'NUXT_SESSION_SECRET', message: 'is not set' }])
    expect(settings({ sessionSecret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).toEqual(['NUXT_SESSION_SECRET'])
  })

  it('detects the origin / RP ID mismatch behind the reported 403 and WebAuthn failures', () => {
    expect(settings({ webauthnOrigins: ['http://localhost:3000'], cookieSecure: false }, 'development')).toEqual(['NUXT_WEBAUTHN_RP_ID'])
    expect(settings({ webauthnRpId: 'localhost', webauthnOrigins: ['http://localhost:3000'], cookieSecure: false }, 'development')).toEqual([])
    expect(rpIdMatchesOrigin('etijah.com', 'https://hr.etijah.com')).toBe(true)
    expect(rpIdMatchesOrigin('jah.com', 'https://hr.etijah.com')).toBe(false)
  })

  it('is stricter in production: https origins and Secure cookies', () => {
    expect(settings({ webauthnRpId: 'localhost', webauthnOrigins: ['http://localhost:3000'], cookieSecure: false })).toEqual(['NUXT_WEBAUTHN_ORIGINS', 'NUXT_COOKIE_SECURE'])
  })

  it('warns (not fails) in development about Secure cookies over http', () => {
    const r = validateServerConfig({ ...good, webauthnRpId: 'localhost', webauthnOrigins: ['http://localhost:3000'] }, 'development')
    expect(r.errors).toEqual([])
    expect(r.warnings.map(w => w.setting)).toContain('NUXT_COOKIE_SECURE')
  })

  it('catches swapped or wrong Supabase keys, except in test mode', () => {
    expect(settings({ supabaseAnonKey: jwt('service_role'), supabaseServiceRoleKey: jwt('anon') })).toEqual(['NUXT_SUPABASE_ANON_KEY', 'NUXT_SUPABASE_SERVICE_ROLE_KEY'])
    expect(settings({ supabaseServiceRoleKey: good.supabaseAnonKey })).toContain('NUXT_SUPABASE_SERVICE_ROLE_KEY')
    expect(settings({ supabaseAnonKey: 'fake', supabaseServiceRoleKey: 'fake2' }, 'test')).toEqual([])
    expect(supabaseKeyKind('sb_publishable_abc')).toBe('publishable')
  })

  it('checks proxy, cron and VAPID consistency', () => {
    expect(settings({ trustProxyMode: 'xff' })).toEqual(['NUXT_TRUSTED_PROXY_CIDRS'])
    expect(settings({ trustProxyMode: 'header' })).toEqual(['NUXT_CLIENT_IP_HEADER'])
    expect(settings({ trustProxyMode: 'xff', trustedProxyCidrs: ['nope'] })).toEqual(['NUXT_TRUSTED_PROXY_CIDRS'])
    expect(settings({ cronSecret: 'short' })).toEqual(['NUXT_CRON_SECRET'])
    expect(settings({ vapidPublicKey: 'x' })).toEqual(['NUXT_VAPID_PRIVATE_KEY'])
  })

  it('accepts the local-testing loopback IP only outside production, as a single routable address', () => {
    const dev = validateServerConfig({ ...good, devLoopbackClientIp: '169.224.96.169' }, 'development')
    expect(dev.errors).toEqual([])
    expect(dev.warnings.map(w => w.setting)).toContain('NUXT_DEV_LOOPBACK_CLIENT_IP')
    expect(dev.warnings.map(w => w.message).join()).not.toContain('169.224.96.169') // names, never values
    expect(settings({ devLoopbackClientIp: '169.224.96.169' }, 'test')).toEqual([])
    expect(settings({ devLoopbackClientIp: '169.224.96.169' })).toEqual(['NUXT_DEV_LOOPBACK_CLIENT_IP']) // production
    for (const bad of ['169.224.96.0/24', 'office', '127.0.0.1', '::1', '::ffff:127.0.0.1', '0.0.0.0', '169.224.96.169, 1.2.3.4']) {
      expect(settings({ devLoopbackClientIp: bad }, 'development')).toEqual(['NUXT_DEV_LOOPBACK_CLIENT_IP'])
    }
  })

  it('resolves the environment', () => {
    expect(resolveAppEnv('', true)).toBe('development')
    expect(resolveAppEnv('', false)).toBe('production')
    expect(resolveAppEnv('TEST', false)).toBe('test')
  })
})

describe('development error overlay under the strict CSP', () => {
  it('allows exactly one static overlay script, by hash', async () => {
    const { devErrorOverlayScriptHashes } = await import('~~/server/lib/csp')
    const first = await devErrorOverlayScriptHashes()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/)
    expect(await devErrorOverlayScriptHashes()).toEqual(first)
  })
})
