export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'schedules.manage' })
  const id = routeUuid(event)
  const { data, error } = await ctx.db.from('employee_schedules').delete().eq('id', id).select('employee_id, effective_from, effective_to').maybeSingle()
  if (error) {
    throw dbError(error)
  }
  if (!data) {
    throw apiError(404, 'not_found')
  }
  recalculateSoon(event, [data.employee_id], data.effective_from, data.effective_to ?? new Date().toISOString().slice(0, 10))
  return { ok: true }
})
