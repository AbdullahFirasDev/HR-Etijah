/**
 * Loads source data for the attendance engine, runs it, and persists the computed daily
 * (attendance_days) and monthly (monthly_summaries) results.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addDays,
  calculateDay,
  CALC_VERSION,
  eachDate,
  holidayOn,
  leaveOn,
  localDate,
  monthRange,
  resolveSchedule,
  startOfWeek,
  summarizePeriod,
  type BreakInput,
  type CalcPolicy,
  type DayResult,
  type EmployeeScheduleRow,
  type HolidayInput,
  type LeaveInput,
  type PeriodSummary,
  type ResolvedSchedule,
  type SessionInput,
} from '#shared/engine'

export interface OrgSettings {
  org_name_ar: string
  org_name_en: string
  timezone: string
  week_start: number
  default_required_minutes: number
  default_working_days: number[]
  max_location_age_seconds: number
  max_travel_speed_kmh: number
  risk_review_threshold: number
  risk_block_threshold: number
  require_device_approval: boolean
  max_devices_per_employee: number
  allow_multiple_sessions: boolean
  missing_checkout_policy: 'zero' | 'scheduled_end'
  auto_close_after_hours: number
  absence_counts_as_shortage: boolean
  late_counts_from: 'shift_start' | 'grace_end'
  min_overtime_minutes: number
  max_daily_overtime_minutes: number
  overtime_basis: 'daily' | 'weekly'
  holiday_work_is_overtime: boolean
  leave_approval_flow: 'single' | 'two_step'
  allow_negative_leave_balance: boolean
}

export async function loadSettings(db: SupabaseClient = serviceDb()): Promise<OrgSettings> {
  return unwrap(await db.from('org_settings').select('*').eq('id', 1).single()) as OrgSettings
}

export function toPolicy(s: OrgSettings): CalcPolicy {
  return {
    timezone: s.timezone,
    weekStart: s.week_start,
    defaultRequiredMinutes: s.default_required_minutes,
    defaultWorkingDays: s.default_working_days,
    missingCheckoutPolicy: s.missing_checkout_policy,
    absenceCountsAsShortage: s.absence_counts_as_shortage,
    lateCountsFrom: s.late_counts_from,
    minOvertimeMinutes: s.min_overtime_minutes,
    maxDailyOvertimeMinutes: s.max_daily_overtime_minutes,
    overtimeBasis: s.overtime_basis,
    holidayWorkIsOvertime: s.holiday_work_is_overtime,
  }
}

/** Page through PostgREST results (the API caps each response at max_rows). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null, error: any }>, pageSize = 1000): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await build(offset, offset + pageSize - 1)
    if (error) {
      throw dbError(error)
    }
    out.push(...(data ?? []))
    if (!data || data.length < pageSize) {
      return out
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface EmployeeCalc {
  id: string
  officeId: string | null
  departmentId: string | null
  hireDate: string | null
  terminationDate: string | null
  status: string
  schedules: EmployeeScheduleRow[]
}

interface SessionRow { id: string, employee_id: string, work_date: string, check_in_at: string, check_out_at: string | null, status: string }
interface BreakRow { id: string, employee_id: string, session_id: string, started_at: string, ended_at: string | null, status: string }

export interface CalcData {
  settings: OrgSettings
  policy: CalcPolicy
  employees: Map<string, EmployeeCalc>
  holidays: HolidayInput[]
  leaves: Map<string, LeaveInput[]>
  sessions: Map<string, SessionRow[]>
  breaks: Map<string, BreakRow[]>
}

const SCHEDULE_SELECT = `id, effective_from, effective_to, required_minutes, working_days, start_time, end_time, grace_minutes,
  early_leave_grace_minutes, break_minutes, paid_break_minutes, weekly_required_minutes, is_flexible, flex_earliest_start,
  flex_latest_end, overtime_eligible, count_before_shift, count_after_shift,
  shift:shifts ( id, start_time, end_time, required_minutes, grace_minutes, early_leave_grace_minutes, break_minutes,
    paid_break_minutes, working_days, weekly_required_minutes, is_flexible, flex_earliest_start, flex_latest_end,
    overtime_eligible, count_before_shift, count_after_shift )`

export async function loadCalcData(employeeIds: string[] | 'all', from: string, to: string, db: SupabaseClient = serviceDb()): Promise<CalcData> {
  const settings = await loadSettings(db)
  const policy = toPolicy(settings)

  const empRows = await fetchAll<any>((a, b) => {
    let q = db.from('employees').select(`id, office_id, department_id, hire_date, termination_date, status, employee_schedules ( ${SCHEDULE_SELECT} )`).order('id').range(a, b)
    if (employeeIds !== 'all') {
      q = q.in('id', employeeIds)
    }
    return q
  })
  const employees = new Map<string, EmployeeCalc>()
  for (const e of empRows) {
    employees.set(e.id, {
      id: e.id,
      officeId: e.office_id,
      departmentId: e.department_id,
      hireDate: e.hire_date,
      terminationDate: e.termination_date,
      status: e.status,
      schedules: (e.employee_schedules ?? []).map((s: any) => ({ ...s, shift: Array.isArray(s.shift) ? s.shift[0] ?? null : s.shift }))
        .sort((x: EmployeeScheduleRow, y: EmployeeScheduleRow) => (x.effective_from < y.effective_from ? 1 : -1)),
    })
  }
  const ids = [...employees.keys()]

  const holidayRows = await fetchAll<any>((a, b) => db.from('holidays').select('*')
    .or(`is_recurring.eq.true,and(start_date.lte.${to},end_date.gte.${from})`).order('start_date').range(a, b))
  const holidays: HolidayInput[] = holidayRows.map(h => ({
    id: h.id, nameAr: h.name_ar, nameEn: h.name_en, type: h.holiday_type, startDate: h.start_date, endDate: h.end_date, isRecurring: h.is_recurring, officeId: h.office_id,
  }))

  const leaves = new Map<string, LeaveInput[]>()
  const sessions = new Map<string, SessionRow[]>()
  const breaks = new Map<string, BreakRow[]>()
  const startUtc = `${addDays(from, -1)}T00:00:00Z`
  const endUtc = `${addDays(to, 2)}T00:00:00Z`

  for (const part of chunk(ids, 150)) {
    const leaveRows = await fetchAll<any>((a, b) => db.from('leave_requests')
      .select('id, employee_id, start_date, end_date, is_half_day, leave_type:leave_types ( id, code, is_paid, excluded_from_absence, excluded_from_shortage )')
      .in('employee_id', part).eq('status', 'approved').lte('start_date', to).gte('end_date', from).order('id').range(a, b))
    for (const l of leaveRows) {
      const t = Array.isArray(l.leave_type) ? l.leave_type[0] : l.leave_type
      const arr = leaves.get(l.employee_id) ?? []
      arr.push({
        requestId: l.id, leaveTypeId: t.id, code: t.code, startDate: l.start_date, endDate: l.end_date, isHalfDay: l.is_half_day,
        isPaid: t.is_paid, excludedFromAbsence: t.excluded_from_absence, excludedFromShortage: t.excluded_from_shortage,
      })
      leaves.set(l.employee_id, arr)
    }

    const sessionRows = await fetchAll<SessionRow>((a, b) => db.from('attendance_sessions')
      .select('id, employee_id, work_date, check_in_at, check_out_at, status')
      .in('employee_id', part).gte('work_date', from).lte('work_date', to).neq('status', 'voided').order('id').range(a, b))
    for (const s of sessionRows) {
      const arr = sessions.get(s.employee_id) ?? []
      arr.push(s)
      sessions.set(s.employee_id, arr)
    }

    const breakRows = await fetchAll<BreakRow>((a, b) => db.from('breaks')
      .select('id, employee_id, session_id, started_at, ended_at, status')
      .in('employee_id', part).gte('started_at', startUtc).lt('started_at', endUtc).neq('status', 'voided').order('id').range(a, b))
    for (const br of breakRows) {
      const arr = breaks.get(br.session_id) ?? []
      arr.push(br)
      breaks.set(br.session_id, arr)
    }
  }

  return { settings, policy, employees, holidays, leaves, sessions, breaks }
}

export function scheduleResolver(data: CalcData, employeeId: string): (date: string) => ResolvedSchedule | null {
  const emp = data.employees.get(employeeId)
  return (date: string) => (emp ? resolveSchedule(date, emp.schedules, data.policy) : null)
}

export function isEmployed(emp: EmployeeCalc, date: string): boolean {
  return (!emp.hireDate || date >= emp.hireDate) && (!emp.terminationDate || date <= emp.terminationDate)
}

export function computeEmployeeDays(data: CalcData, employeeId: string, dates: string[], now: Date): DayResult[] {
  const emp = data.employees.get(employeeId)
  if (!emp) {
    return []
  }
  const scheduleFor = scheduleResolver(data, employeeId)
  const empSessions = data.sessions.get(employeeId) ?? []
  const empLeaves = data.leaves.get(employeeId) ?? []
  const out: DayResult[] = []
  for (const date of dates) {
    if (!isEmployed(emp, date)) {
      continue
    }
    const daySessions = empSessions.filter(s => s.work_date === date)
    const sessionsIn: SessionInput[] = daySessions.map(s => ({
      id: s.id,
      checkIn: new Date(s.check_in_at),
      checkOut: s.check_out_at ? new Date(s.check_out_at) : null,
      status: s.status as SessionInput['status'],
    }))
    const breaksIn: BreakInput[] = daySessions.flatMap(s => (data.breaks.get(s.id) ?? []).map(b => ({
      id: b.id,
      sessionId: b.session_id,
      start: new Date(b.started_at),
      end: b.ended_at ? new Date(b.ended_at) : null,
      status: b.status as BreakInput['status'],
    })))
    out.push(calculateDay({
      date,
      now,
      policy: data.policy,
      schedule: scheduleFor(date),
      sessions: sessionsIn,
      breaks: breaksIn,
      holiday: holidayOn(date, data.holidays, emp.officeId),
      leave: leaveOn(date, empLeaves),
    }))
  }
  return out
}

/** Period summary honouring the organisation's overtime basis. */
export function summarize(data: CalcData, employeeId: string, from: string, to: string, days: DayResult[]): PeriodSummary {
  const daily = summarizePeriod(from, to, days, { basis: 'daily' })
  if (data.policy.overtimeBasis !== 'weekly') {
    return daily
  }
  const schedule = scheduleResolver(data, employeeId)(to)
  const weeks = new Map<string, DayResult[]>()
  for (const d of days) {
    const k = startOfWeek(d.date, data.policy.weekStart)
    weeks.set(k, [...(weeks.get(k) ?? []), d])
  }
  let overtime = 0
  let shortage = 0
  for (const [, w] of weeks) {
    const s = summarizePeriod(w[0]!.date, w.at(-1)!.date, w, {
      basis: 'weekly',
      weeklyRequiredMinutes: w.length === 7 ? schedule?.weeklyRequiredMinutes : null,
      overtimeEligible: schedule?.overtimeEligible ?? false,
      minOvertimeMinutes: data.policy.minOvertimeMinutes,
    })
    overtime += s.overtimeMinutes
    shortage += s.shortageMinutes
  }
  return { ...daily, overtimeMinutes: overtime, shortageMinutes: shortage, basis: 'weekly' }
}

export function dayToRow(employeeId: string, d: DayResult) {
  return {
    employee_id: employeeId,
    work_date: d.date,
    status: d.status,
    is_working_day: d.isWorkingDay,
    is_holiday: d.isHoliday,
    leave_type_id: d.leaveTypeId,
    leave_fraction: d.leaveFraction,
    first_check_in: d.firstCheckIn?.toISOString() ?? null,
    last_check_out: d.lastCheckOut?.toISOString() ?? null,
    scheduled_start: d.scheduledStart?.toISOString() ?? null,
    scheduled_end: d.scheduledEnd?.toISOString() ?? null,
    gross_minutes: d.grossMinutes,
    break_minutes: d.breakMinutes,
    unpaid_break_minutes: d.unpaidBreakMinutes,
    net_minutes: d.netMinutes,
    required_minutes: d.requiredMinutes,
    late_minutes: d.lateMinutes,
    early_leave_minutes: d.earlyLeaveMinutes,
    overtime_minutes: d.overtimeMinutes,
    shortage_minutes: d.shortageMinutes,
    flags: d.flags,
    details: { ...d.details, isComplete: d.isComplete, isScheduledDay: d.isScheduledDay, baseRequiredMinutes: d.baseRequiredMinutes, paidBreakMinutes: d.paidBreakMinutes },
    calc_version: d.calcVersion,
    computed_at: new Date().toISOString(),
  }
}

/** Rebuild a DayResult from a persisted attendance_days row (for reports/aggregation). */
export function rowToDay(r: any): DayResult {
  const det = r.details ?? {}
  return {
    date: r.work_date,
    status: r.status,
    isWorkingDay: r.is_working_day,
    isScheduledDay: det.isScheduledDay ?? r.is_working_day,
    isHoliday: r.is_holiday,
    isComplete: det.isComplete ?? true,
    leaveTypeId: r.leave_type_id,
    leaveFraction: Number(r.leave_fraction),
    firstCheckIn: r.first_check_in ? new Date(r.first_check_in) : null,
    lastCheckOut: r.last_check_out ? new Date(r.last_check_out) : null,
    scheduledStart: r.scheduled_start ? new Date(r.scheduled_start) : null,
    scheduledEnd: r.scheduled_end ? new Date(r.scheduled_end) : null,
    grossMinutes: r.gross_minutes,
    breakMinutes: r.break_minutes,
    paidBreakMinutes: det.paidBreakMinutes ?? Math.max(0, r.break_minutes - r.unpaid_break_minutes),
    unpaidBreakMinutes: r.unpaid_break_minutes,
    netMinutes: r.net_minutes,
    baseRequiredMinutes: det.baseRequiredMinutes ?? r.required_minutes,
    requiredMinutes: r.required_minutes,
    remainingMinutes: Math.max(0, r.required_minutes - r.net_minutes),
    lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes,
    overtimeMinutes: r.overtime_minutes,
    shortageMinutes: r.shortage_minutes,
    flags: r.flags ?? [],
    details: det,
    calcVersion: r.calc_version,
  }
}

async function lockedMonths(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from('attendance_period_locks').select('year, month')
  return new Set((data ?? []).map(l => `${l.year}-${String(l.month).padStart(2, '0')}`))
}

/**
 * Recompute and persist whole months for the given employees (months that are locked for
 * payroll are left untouched). Days after today are not persisted.
 */
export async function recalculate(employeeIds: string[] | 'all', from: string, to: string, now = new Date()): Promise<{ employees: number, days: number }> {
  const db = serviceDb()
  const settings = await loadSettings(db)
  const today = localDate(now, settings.timezone)
  const locked = await lockedMonths(db)

  const months: Array<{ year: number, month: number, from: string, to: string }> = []
  for (let d = `${from.slice(0, 7)}-01`; d <= to; ) {
    const year = Number(d.slice(0, 4))
    const month = Number(d.slice(5, 7))
    const r = monthRange(year, month)
    if (!locked.has(d.slice(0, 7)) && r.from <= today) {
      months.push({ year, month, from: r.from, to: r.to < today ? r.to : today })
    }
    d = addDays(r.to, 1)
  }
  if (months.length === 0) {
    return { employees: 0, days: 0 }
  }

  const data = await loadCalcData(employeeIds, months[0]!.from, months.at(-1)!.to, db)
  let dayCount = 0
  for (const empId of data.employees.keys()) {
    const dayRows: ReturnType<typeof dayToRow>[] = []
    const monthRows: any[] = []
    for (const m of months) {
      const days = computeEmployeeDays(data, empId, eachDate(m.from, m.to), now)
      dayRows.push(...days.map(d => dayToRow(empId, d)))
      if (days.length) {
        const s = summarize(data, empId, m.from, m.to, days)
        monthRows.push({
          employee_id: empId,
          year: m.year,
          month: m.month,
          working_days: s.workingDays,
          present_days: s.presentDays,
          absence_days: s.absenceDays,
          leave_days: s.leaveDays,
          holiday_days: s.holidayDays,
          late_count: s.lateCount,
          late_minutes: s.lateMinutes,
          net_minutes: s.netMinutes,
          required_minutes: s.requiredMinutes,
          overtime_minutes: s.overtimeMinutes,
          shortage_minutes: s.shortageMinutes,
          attendance_percentage: s.attendancePercentage,
          details: { basis: s.basis, through: m.to, missingCheckouts: s.missingCheckouts, earlyLeaveMinutes: s.earlyLeaveMinutes, breakMinutes: s.breakMinutes },
          calc_version: CALC_VERSION,
          computed_at: new Date().toISOString(),
        })
      }
    }
    for (const part of chunk(dayRows, 500)) {
      unwrap(await db.from('attendance_days').upsert(part, { onConflict: 'employee_id,work_date' }))
    }
    if (monthRows.length) {
      unwrap(await db.from('monthly_summaries').upsert(monthRows, { onConflict: 'employee_id,year,month' }))
    }
    dayCount += dayRows.length
  }
  return { employees: data.employees.size, days: dayCount }
}

/**
 * Background recalculation after a write. Uses event.waitUntil so serverless runtimes keep
 * the work alive after the response; failures are logged (the 30-minute job retries).
 */
export function recalculateSoon(event: import('h3').H3Event, employeeIds: string[] | 'all', from: string, to: string): void {
  const p = recalculate(employeeIds, from, to).catch(e => console.error('[recalculate]', e))
  event.waitUntil?.(p)
}
