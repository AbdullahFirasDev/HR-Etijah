import { scheduleSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'schedules.manage' })
  const id = routeUuid(event)
  const b = await readValid(event, scheduleSchema)
  const { data, error } = await ctx.db.from('employee_schedules').update(scheduleRow(b)).eq('id', id).select('*').maybeSingle()
  if (error) {
    throw error.code === '23P01' ? apiError(409, 'schedule_overlap') : dbError(error)
  }
  if (!data) {
    throw apiError(404, 'not_found')
  }
  recalculateSoon(event, [b.employeeId], b.effectiveFrom, b.effectiveTo ?? new Date().toISOString().slice(0, 10))
  return data
})
