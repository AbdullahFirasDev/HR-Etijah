import { countLeaveDays } from '#shared/engine'
import { leaveRequestSchema } from '#shared/schemas'

/** Create a leave request for oneself, or (with leave.manage) on behalf of an employee. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  await rateLimit(event, 'leave-create', ctx.userId, 20, 3600)
  const body = await readValid(event, leaveRequestSchema)

  const employeeId = body.employeeId ?? ctx.employee?.id
  if (!employeeId) {
    throw apiError(403, 'not_an_employee')
  }
  const onBehalf = employeeId !== ctx.employee?.id
  if (onBehalf) {
    if (!hasPermission(ctx, 'leave.manage')) {
      throw apiError(403, 'forbidden')
    }
    // RLS confirms the caller can reach this employee
    const { data: visible } = await ctx.db.from('employees').select('id').eq('id', employeeId).maybeSingle()
    if (!visible) {
      throw apiError(403, 'forbidden')
    }
  }

  const { data: type } = await ctx.db.from('leave_types').select('id, is_active, allow_half_day, name_ar, name_en').eq('id', body.leaveTypeId).maybeSingle()
  if (!type?.is_active) {
    throw apiError(422, 'invalid_leave_type')
  }
  if (body.isHalfDay && !type.allow_half_day) {
    throw apiError(422, 'half_day_not_allowed')
  }

  const data = await loadCalcData([employeeId], body.startDate, body.endDate)
  const emp = data.employees.get(employeeId)
  if (!emp) {
    throw apiError(404, 'employee_not_found')
  }
  const days = countLeaveDays(body.startDate, body.endDate, body.isHalfDay, scheduleResolver(data, employeeId), data.holidays, emp.officeId)
  if (days <= 0) {
    throw apiError(422, 'no_working_days_in_range')
  }

  const { data: locks } = await serviceDb().from('attendance_period_locks').select('year, month')
  const locked = new Set((locks ?? []).map(l => `${l.year}-${String(l.month).padStart(2, '0')}`))
  if (locked.has(body.startDate.slice(0, 7)) || locked.has(body.endDate.slice(0, 7))) {
    throw apiError(409, 'period_locked')
  }

  const { data: row, error } = await actorDb(event, ctx).from('leave_requests').insert({
    employee_id: employeeId,
    leave_type_id: body.leaveTypeId,
    start_date: body.startDate,
    end_date: body.endDate,
    is_half_day: body.isHalfDay,
    days_count: days,
    reason: body.reason ?? null,
    created_by: ctx.userId,
  }).select('id, status, days_count').single()
  if (error) {
    throw error.code === '23P01' ? apiError(409, 'leave_overlap') : dbError(error)
  }

  const { data: who } = await serviceDb().from('employees').select('profile:profiles ( full_name, full_name_en )').eq('id', employeeId).single()
  const p: any = Array.isArray(who?.profile) ? who.profile[0] : who?.profile
  await notify(await approverIds(employeeId, 'leave.approve'), {
    type: 'leave.requested',
    titleAr: 'طلب إجازة جديد',
    titleEn: 'New leave request',
    bodyAr: `${p?.full_name ?? ''} — ${type.name_ar} (${days})`,
    bodyEn: `${p?.full_name_en ?? p?.full_name ?? ''} — ${type.name_en} (${days})`,
    data: { url: '/admin/leave' },
  })
  return row
})
