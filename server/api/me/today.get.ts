import { addDays, localDate, resolveCheckInWorkDate } from '#shared/engine'

/** Employee home screen: live status, today's numbers (computed now), recent history. */
export default defineEventHandler(async (event) => {
  // Auto-refresh polls pass ?passive=1 so they never extend the login session.
  const ctx = await requireAuth(event, { passive: getQuery(event).passive === '1' })
  if (!ctx.employee) {
    return { employee: null }
  }
  const emp = ctx.employee
  const now = new Date()
  const settings = await loadSettings(ctx.db)
  const today = localDate(now, settings.timezone)

  const [state, data, recent, geofences, creds, unread] = await Promise.all([
    attendanceState(emp.id),
    loadCalcData([emp.id], addDays(today, -1), today),
    ctx.db.from('attendance_days')
      .select('work_date, status, first_check_in, last_check_out, net_minutes, required_minutes, late_minutes, overtime_minutes, shortage_minutes, break_minutes, flags')
      .eq('employee_id', emp.id).lt('work_date', today).gte('work_date', addDays(today, -14))
      .order('work_date', { ascending: false }).limit(10),
    ctx.db.from('geofences').select('id, name, latitude, longitude, radius_m, max_accuracy_m, office_id').eq('is_active', true),
    ctx.db.from('webauthn_credentials').select('status').eq('employee_id', emp.id).neq('status', 'revoked'),
    ctx.db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).is('read_at', null),
  ])

  const scheduleFor = scheduleResolver(data, emp.id)
  const workDate = state.openSession?.workDate ?? resolveCheckInWorkDate(now, settings.timezone, scheduleFor)
  const [day] = computeEmployeeDays(data, emp.id, [workDate], now)
  const statuses = (creds.data ?? []).map(c => c.status)

  const { data: employeeRow } = await ctx.db.from('employees')
    .select('employee_code, job_title, department:departments ( name_ar, name_en ), office:offices ( name_ar, name_en )')
    .eq('id', emp.id).single()

  return {
    employee: {
      id: emp.id,
      code: emp.employeeCode,
      jobTitle: employeeRow?.job_title ?? null,
      department: employeeRow?.department ?? null,
      office: employeeRow?.office ?? null,
    },
    serverTime: now.toISOString(),
    timezone: settings.timezone,
    workDate,
    state,
    schedule: scheduleFor(workDate),
    today: day ?? null,
    recent: recent.data ?? [],
    geofences: (geofences.data ?? []).filter(g => !emp.officeId || g.office_id === emp.officeId),
    device: { registered: statuses.includes('active'), pendingApproval: !statuses.includes('active') && statuses.includes('pending') },
    unreadNotifications: unread.count ?? 0,
  }
})
