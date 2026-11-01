/**
 * Vercel only: hand background work passed to `event.waitUntil` (e.g. the summary recalculation
 * after an attendance write, server/utils/attendance.ts) to Vercel's `waitUntil`, so it can finish
 * after the response is sent instead of being frozen with the instance. Nitro's Vercel preset
 * does not connect the two by itself. Elsewhere this plugin does nothing.
 */
import { waitUntil } from '@vercel/functions'

export default defineNitroPlugin((nitroApp) => {
  if (process.env.VERCEL !== '1') {
    return
  }
  nitroApp.hooks.hook('request', (event) => {
    event.context.waitUntil ??= waitUntil
  })
})
