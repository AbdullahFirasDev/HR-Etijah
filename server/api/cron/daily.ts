import { cronAuthorized } from '../../lib/cron-auth'

/**
 * External scheduler entry point for platforms without long-running Nitro scheduled tasks.
 * Vercel Cron calls it with GET (schedule in nuxt.config.ts → nitro.vercel.config.crons);
 * other schedulers may use POST. Requires `Authorization: Bearer <CRON_SECRET>`.
 */
export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'POST') {
    throw apiError(405, 'method_not_allowed')
  }
  if (!cronAuthorized(getHeader(event, 'authorization'), serverConfig().cronSecret)) {
    throw apiError(401, 'unauthorized')
  }
  return closeDays()
})
