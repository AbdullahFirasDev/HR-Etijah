/**
 * API request guard:
 *  - CSRF: state-changing /api requests must carry the X-Requested-With header the app sets
 *    (forces a CORS preflight cross-site), come from an allowed origin (server/lib/origin.ts)
 *    and use a JSON body. Session cookies are additionally SameSite=Strict.
 *  - Coarse per-IP rate limit for the whole API (endpoint-specific limits are stricter).
 */
import { checkCsrf } from '../lib/origin'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/')) {
    return
  }
  const config = serverConfig() // a misconfigured server answers 500 server_misconfigured
  // Coarse per-instance flood guard; endpoint limits (login, attendance…) use the shared store.
  await rateLimit(event, 'api', clientIp(event) ?? 'unknown', 600, 60, { shared: false })

  if (SAFE_METHODS.has(event.method) || path.startsWith('/api/cron/')) {
    return
  }

  const origin = getHeader(event, 'origin')
  const target = targetOrigin(event)
  const csrf = checkCsrf({
    method: event.method,
    origin,
    fetchSite: getHeader(event, 'sec-fetch-site'),
    requestedWith: getHeader(event, 'x-requested-with'),
    allowedOrigins: config.webauthnOrigins,
    targetOrigin: target,
    dev: import.meta.dev,
  })
  if (!csrf.ok) {
    // Diagnostic for operators; origins are not secrets.
    console.warn(`[csrf] ${csrf.reason} ${event.method} ${path} origin=${origin ?? '-'} target=${target ?? '-'} allowed=${config.webauthnOrigins.join(',') || '-'}`)
    throw apiError(403, csrf.reason)
  }

  const contentType = getHeader(event, 'content-type') ?? ''
  const length = Number(getHeader(event, 'content-length') ?? '0')
  if (length > 0 && !contentType.toLowerCase().startsWith('application/json')) {
    throw apiError(415, 'unsupported_media_type')
  }
  if (length > 256 * 1024) {
    throw apiError(413, 'payload_too_large')
  }
})
