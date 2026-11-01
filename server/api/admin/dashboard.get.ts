import { addDays, localDate, resolveCheckInWorkDate } from '#shared/engine'

/**
 * Admin dashboard. Polled every ~30 s as a passive request (does not extend the session).
 * Scope follows RLS: HR/owners see the organisation, department managers their departments.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: ['attendance.read', 'reports.view'], passive: getQuery(event).passive === '1' })
  const now = new Date()
  const settings = await loadSettings(ctx.db)
  const today = localDate(now, settings.timezone)
  const employees = (await reportEmployees(ctx, {}))
  const ids = employees.map(e => e.id)
  const data = await loadCalcData(ids, addDays(today, -1), today)

  // ---- live status ----------------------------------------------------------------------
  let present = 0
  let onBreak = 0
  let checkedInToday = 0
  let late = 0
  let notArrived = 0
  let netToday = 0
  let overtimeToday = 0
  const lateList: Array<{ id: string, name: string, nameEn: string | null, minutes: number }> = []
  const absentList: Array<{ id: string, name: string, nameEn: string | null }> = []
  for (const e of employees) {
    const calc = data.employees.get(e.id)
    if (!calc || calc.status !== 'active') {
      continue
    }
    const sessions = data.sessions.get(e.id) ?? []
    const open = sessions.find(s => s.status === 'open')
    if (open) {
      const hasOpenBreak = (data.breaks.get(open.id) ?? []).some(b => b.status === 'open')
      hasOpenBreak ? onBreak++ : present++
    }
    const workDate = open?.work_date ?? resolveCheckInWorkDate(now, settings.timezone, scheduleResolver(data, e.id))
    const [day] = computeEmployeeDays(data, e.id, [workDate], now)
    if (!day) continue
    if (sessions.some(s => s.work_date === workDate)) checkedInToday++
    netToday += day.netMinutes
    overtimeToday += day.overtimeMinutes
    if (day.lateMinutes > 0) {
      late++
      lateList.push({ id: e.id, name: e.name, nameEn: e.nameEn, minutes: day.lateMinutes })
    }
    const sched = scheduleResolver(data, e.id)(workDate)
    const shiftStarted = day.scheduledStart ? now.getTime() > day.scheduledStart.getTime() + (sched?.graceMinutes ?? 0) * 60_000 : false
    if (day.isWorkingDay && day.leaveFraction < 1 && !sessions.some(s => s.work_date === workDate) && (shiftStarted || day.status === 'absent')) {
      notArrived++
      absentList.push({ id: e.id, name: e.name, nameEn: e.nameEn })
    }
  }

  // ---- trends (persisted results) ----------------------------------------------------------------
  const since = addDays(today, -29)
  const daysRows = ids.length
    ? await fetchAll<any>((a, b) => ctx.db.from('attendance_days')
      .select('work_date, status, late_minutes, net_minutes, overtime_minutes, shortage_minutes, is_working_day')
      .gte('work_date', since).lt('work_date', today).order('work_date').range(a, b))
    : []
  const trendMap = new Map<string, { date: string, present: number, absent: number, late: number, leave: number, netMinutes: number }>()
  for (let d = since; d < today; d = addDays(d, 1)) trendMap.set(d, { date: d, present: 0, absent: 0, late: 0, leave: 0, netMinutes: 0 })
  for (const r of daysRows) {
    const t = trendMap.get(r.work_date)
    if (!t) continue
    if (['present', 'missing_checkout'].includes(r.status)) t.present++
    if (r.status === 'absent') t.absent++
    if (r.status === 'on_leave') t.leave++
    if (r.late_minutes > 0) t.late++
    t.netMinutes += r.net_minutes
  }

  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const monthly = ids.length
    ? await fetchAll<any>((a, b) => ctx.db.from('monthly_summaries')
      .select('employee_id, year, month, net_minutes, required_minutes, overtime_minutes, shortage_minutes, late_count, absence_days, attendance_percentage')
      .gte('year', year - 1).order('year').order('month').range(a, b))
    : []
  const monthTrend = new Map<string, { key: string, netMinutes: number, overtimeMinutes: number, shortageMinutes: number, attendance: number[] }>()
  for (const m of monthly) {
    const key = `${m.year}-${String(m.month).padStart(2, '0')}`
    const t = monthTrend.get(key) ?? { key, netMinutes: 0, overtimeMinutes: 0, shortageMinutes: 0, attendance: [] }
    t.netMinutes += m.net_minutes
    t.overtimeMinutes += m.overtime_minutes
    t.shortageMinutes += m.shortage_minutes
    t.attendance.push(Number(m.attendance_percentage))
    monthTrend.set(key, t)
  }
  const months = [...monthTrend.values()].slice(-6).map(t => ({
    key: t.key,
    netMinutes: t.netMinutes,
    overtimeMinutes: t.overtimeMinutes,
    shortageMinutes: t.shortageMinutes,
    attendancePercentage: t.attendance.length ? Math.round((t.attendance.reduce((a, b) => a + b, 0) / t.attendance.length) * 10) / 10 : null,
  }))

  // ---- department performance (current month) ------------------------------------------------
  const deptOf = new Map(employees.map(e => [e.id, e]))
  const depts = new Map<string, { id: string | null, nameAr: string, nameEn: string, employees: number, attendance: number[], late: number, overtime: number, shortage: number }>()
  for (const m of monthly.filter(x => x.year === year && x.month === month)) {
    const e = deptOf.get(m.employee_id)
    if (!e) continue
    const k = e.departmentId ?? 'none'
    const d = depts.get(k) ?? { id: e.departmentId, nameAr: e.departmentAr ?? '—', nameEn: e.departmentEn ?? '—', employees: 0, attendance: [], late: 0, overtime: 0, shortage: 0 }
    d.employees++
    d.attendance.push(Number(m.attendance_percentage))
    d.late += m.late_count
    d.overtime += m.overtime_minutes
    d.shortage += m.shortage_minutes
    depts.set(k, d)
  }

  // ---- live activity + security --------------------------------------------------------------
  const nameOf = new Map(employees.map(e => [e.id, e]))
  const { data: events } = await ctx.db.from('attendance_events')
    .select('id, employee_id, event_type, occurred_at, source, distance_m')
    .gte('occurred_at', new Date(now.getTime() - 24 * 3600_000).toISOString())
    .order('occurred_at', { ascending: false }).limit(25)
  let security: any[] = []
  let rejected24h = 0
  if (hasPermission(ctx, 'security.read')) {
    const [{ data: sec }, { count }] = await Promise.all([
      ctx.db.from('verification_attempts')
        .select('id, employee_id, action, occurred_at, outcome, failure_reasons, risk_score, client_ip, distance_m')
        .or(`outcome.eq.rejected,risk_score.gte.${settings.risk_review_threshold}`)
        .order('occurred_at', { ascending: false }).limit(15),
      ctx.db.from('verification_attempts').select('id', { count: 'exact', head: true })
        .eq('outcome', 'rejected').gte('occurred_at', new Date(now.getTime() - 24 * 3600_000).toISOString()),
    ])
    security = (sec ?? []).map(s => ({ ...s, name: nameOf.get(s.employee_id)?.name, nameEn: nameOf.get(s.employee_id)?.nameEn }))
    rejected24h = count ?? 0
  }

  const [pendingLeave, pendingAdj, pendingDevices, geofences] = await Promise.all([
    ctx.db.from('leave_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'manager_approved']),
    ctx.db.from('attendance_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    hasPermission(ctx, 'devices.manage')
      ? ctx.db.from('webauthn_credentials').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      : Promise.resolve({ count: 0 }),
    ctx.db.from('geofences').select('id, name, latitude, longitude, radius_m').eq('is_active', true),
  ])

  return {
    generatedAt: now.toISOString(),
    today,
    stats: {
      totalEmployees: employees.filter(e => data.employees.get(e.id)?.status === 'active').length,
      present,
      onBreak,
      checkedInToday,
      late,
      absent: notArrived,
      netMinutesToday: netToday,
      overtimeMinutesToday: overtimeToday,
      rejected24h,
    },
    pending: { leave: pendingLeave.count ?? 0, adjustments: pendingAdj.count ?? 0, devices: (pendingDevices as any).count ?? 0 },
    lateList: lateList.sort((a, b) => b.minutes - a.minutes).slice(0, 10),
    absentList: absentList.slice(0, 20),
    dailyTrend: [...trendMap.values()],
    monthTrend: months,
    departments: [...depts.values()].map(d => ({
      ...d,
      attendance: undefined,
      attendancePercentage: d.attendance.length ? Math.round((d.attendance.reduce((a, b) => a + b, 0) / d.attendance.length) * 10) / 10 : null,
    })),
    activity: (events ?? []).map(ev => ({ ...ev, name: nameOf.get(ev.employee_id)?.name, nameEn: nameOf.get(ev.employee_id)?.nameEn })),
    security,
    geofences: geofences.data ?? [],
  }
})
