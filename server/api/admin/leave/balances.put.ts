import { leaveBalanceSchema } from '#shared/schemas'

/** Set an employee's leave allocation for a year (RLS: leave.manage within scope). */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'leave.manage' })
  const b = await readValid(event, leaveBalanceSchema)
  const row = unwrap(await ctx.db.from('leave_balances').upsert({
    employee_id: b.employeeId,
    leave_type_id: b.leaveTypeId,
    year: b.year,
    allocated_days: b.allocatedDays,
    carried_over_days: b.carriedOverDays,
  }, { onConflict: 'employee_id,leave_type_id,year' }).select('*').single())
  return row
})
