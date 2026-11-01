import type { H3Event } from 'h3'

/**
 * Fixed-window rate limiter.
 *
 * NUXT_RATE_LIMIT_STORE=memory   — Nitro storage in this process (one long-running server).
 * NUXT_RATE_LIMIT_STORE=database — shared counters in Postgres (public.rate_limit_hit, migration
 *   20261101000100), required on serverless platforms such as Vercel where each instance has
 *   its own memory. If that function is missing (migration not applied) or the call fails, the
 *   request falls back to this instance's memory counter and the problem is logged.
 *
 * `shared: false` keeps a limit per instance even with the database store (used for the coarse
 * per-IP API guard, which would otherwise add a database round trip to every request).
 */
let sharedUnavailable = false

async function localHit(k: string, windowSeconds: number): Promise<number> {
  const storage = useStorage('ratelimit')
  const window = Math.floor(Date.now() / (windowSeconds * 1000))
  const key = `${k}:${window}`
  const count = ((await storage.getItem<number>(key)) ?? 0) + 1
  await storage.setItem(key, count, { ttl: windowSeconds })
  return count
}

async function sharedHit(k: string, windowSeconds: number): Promise<number | null> {
  const { data, error } = await serviceDb().rpc('rate_limit_hit', { p_key: k, p_window_seconds: windowSeconds })
  if (!error && typeof data === 'number') {
    return data
  }
  // PGRST202 / 42883: the function does not exist (migration not applied).
  if (error && (error.code === 'PGRST202' || error.code === '42883')) {
    sharedUnavailable = true
    console.error('[rate-limit] NUXT_RATE_LIMIT_STORE=database but public.rate_limit_hit is missing — apply supabase/migrations/20261101000100_rate_limits.sql. Falling back to per-instance memory counters.')
  }
  else {
    console.error('[rate-limit] shared counter failed, using this instance\'s counter:', error?.message ?? 'unexpected response')
  }
  return null
}

export async function rateLimit(event: H3Event, bucket: string, key: string, limit: number, windowSeconds: number, opts: { shared?: boolean } = {}): Promise<void> {
  const k = `${bucket}:${key}`.slice(0, 512)
  const shared = opts.shared !== false && serverConfig().rateLimitStore === 'database' && !sharedUnavailable
  const count = (shared ? await sharedHit(k, windowSeconds) : null) ?? await localHit(k, windowSeconds)
  if (count > limit) {
    const retryAfter = windowSeconds - Math.floor((Date.now() / 1000) % windowSeconds)
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw apiError(429, 'rate_limited', { retryAfter })
  }
}
