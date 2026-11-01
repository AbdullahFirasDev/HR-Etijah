import { timingSafeEqual } from 'node:crypto'

/**
 * External scheduler entry point (Vercel Cron, system cron, GitHub Actions…) for platforms
 * without long-running Nitro scheduled tasks. Requires `Authorization: Bearer <CRON_SECRET>`.
 */
export default defineEventHandler(async (event) => {
  const secret = serverConfig().cronSecret
  const header = getHeader(event, 'authorization') ?? ''
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(secret)
  if (!secret || secret.length < 24 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw apiError(401, 'unauthorized')
  }
  return closeDays()
})
