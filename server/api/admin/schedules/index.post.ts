import { scheduleSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'schedules.manage' })
  const b = await readValid(event, scheduleSchema)
  const { data, error } = await ctx.db.from('employee_schedules').insert(scheduleRow(b)).select('*').single()
  if (error) {
    throw error.code === '23P01' ? apiError(409, 'schedule_overlap') : dbError(error)
  }
  recalculateSoon(event, [b.employeeId], b.effectiveFrom, b.effectiveTo ?? new Date().toISOString().slice(0, 10))
  return data
})
