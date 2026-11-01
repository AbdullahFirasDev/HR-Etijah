import { monthRange } from '#shared/engine'
import { periodLockSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'attendance.lock' })
  const b = await readValid(event, periodLockSchema)
  if (b.locked) {
    // Freeze an up-to-date snapshot before locking.
    const r = monthRange(b.year, b.month)
    await recalculate('all', r.from, r.to)
  }
  const r = unwrap(await ctx.db.rpc('set_period_lock', { p_year: b.year, p_month: b.month, p_locked: b.locked }))
  await audit(event, { actorId: ctx.userId, action: b.locked ? 'period.locked' : 'period.unlocked', entityType: 'attendance_period', entityId: `${b.year}-${b.month}` })
  return r
})
