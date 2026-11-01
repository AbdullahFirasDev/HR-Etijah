import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const id = routeUuid(event)
  const { note } = await readValid(event, z.object({ note: z.string().trim().max(1000).optional() }))
  const r = unwrap(await ctx.db.rpc('cancel_leave_request', { p_request_id: id, p_note: note ?? null })) as {
    employee_id: string, start_date: string, end_date: string, was_approved: boolean
  }
  await audit(event, { actorId: ctx.userId, action: 'leave.cancelled', entityType: 'leave_request', entityId: id, reason: note })
  if (r.was_approved) {
    recalculateSoon(event, [r.employee_id], r.start_date, r.end_date)
  }
  return r
})
