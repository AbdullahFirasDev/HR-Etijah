import type { H3Event } from 'h3'

/**
 * Fixed-window rate limiter on Nitro storage (in-memory by default). For multiple app
 * instances mount a shared driver (e.g. Redis) at the `ratelimit` storage key — see
 * docs/DEPLOYMENT.md.
 */
export async function rateLimit(event: H3Event, bucket: string, key: string, limit: number, windowSeconds: number): Promise<void> {
  const storage = useStorage('ratelimit')
  const window = Math.floor(Date.now() / (windowSeconds * 1000))
  const k = `${bucket}:${key}:${window}`
  const count = ((await storage.getItem<number>(k)) ?? 0) + 1
  await storage.setItem(k, count, { ttl: windowSeconds })
  if (count > limit) {
    const retryAfter = windowSeconds - Math.floor((Date.now() / 1000) % windowSeconds)
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw apiError(429, 'rate_limited', { retryAfter })
  }
}
