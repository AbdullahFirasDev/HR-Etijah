import { z } from 'zod'

const schema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeId: z.uuid().optional(),
}).refine(v => v.to >= v.from && (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 366, { message: 'invalid_range' })

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'attendance.adjust' })
  await rateLimit(event, 'recalculate', ctx.userId, 5, 300)
  const b = await readValid(event, schema)
  const r = await recalculate(b.employeeId ? [b.employeeId] : 'all', b.from, b.to)
  await audit(event, { actorId: ctx.userId, action: 'attendance.recalculated', entityType: 'attendance_days', metadata: { ...b, ...r } })
  return r
})
