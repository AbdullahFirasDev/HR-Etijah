import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'employees.read' })
  const { employeeId } = queryValid(event, z.object({ employeeId: z.uuid() }))
  return unwrap(await ctx.db.from('employee_schedules')
    .select('*, shift:shifts ( id, code, name_ar, name_en, start_time, end_time )')
    .eq('employee_id', employeeId)
    .order('effective_from', { ascending: false }))
})
