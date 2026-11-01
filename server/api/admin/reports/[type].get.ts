import { reportQuerySchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: ['reports.view', 'attendance.read'] })
  const type = getRouterParam(event, 'type')
  if (type !== 'daily' && type !== 'weekly' && type !== 'monthly') {
    throw apiError(404, 'unknown_report')
  }
  await rateLimit(event, 'reports', ctx.userId, 30, 60)
  return buildReport(ctx, type, queryValid(event, reportQuerySchema))
})
