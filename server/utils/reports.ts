/**
 * Report building. Days are computed live by the engine (always reflecting the latest
 * schedules/leave/adjustments), except in payroll-locked months where the persisted
 * snapshot (attendance_days) is authoritative and frozen.
 */
import { eachDate, localDate, monthRange, startOfWeek, type DayResult, type PeriodSummary } from '#shared/engine'
import type { CalcData } from './attendance'
import type { AuthContext } from './session'

export interface ReportEmployee {
  id: string
  code: string
  name: string
  nameEn: string | null
  departmentId: string | null
  departmentAr: string | null
  departmentEn: string | null
}

/** Employees the caller may report on (RLS-filtered), narrowed by optional filters. */
export async function reportEmployees(ctx: AuthContext, filters: { employeeId?: string, departmentId?: string }): Promise<ReportEmployee[]> {
  const canViewOthers = hasPermission(ctx, 'reports.view') || hasPermission(ctx, 'attendance.read')
  let q = ctx.db.from('employees')
    .select('id, employee_code, department_id, profile:profiles!inner ( full_name, full_name_en ), department:departments ( name_ar, name_en )')
    .order('employee_code')
  if (!canViewOthers) {
    if (!ctx.employee) {
      return []
    }
    q = q.eq('id', ctx.employee.id)
  }
  if (filters.employeeId) q = q.eq('id', filters.employeeId)
  if (filters.departmentId) q = q.eq('department_id', filters.departmentId)
  const rows = await fetchAll<any>((a, b) => q.range(a, b))
  return rows.map((r) => {
    const p = Array.isArray(r.profile) ? r.profile[0] : r.profile
    const d = Array.isArray(r.department) ? r.department[0] : r.department
    return { id: r.id, code: r.employee_code, name: p.full_name, nameEn: p.full_name_en, departmentId: r.department_id, departmentAr: d?.name_ar ?? null, departmentEn: d?.name_en ?? null }
  })
}

export interface EmployeeDays {
  employee: ReportEmployee
  days: DayResult[]
}

export async function computeReportDays(employees: ReportEmployee[], from: string, to: string, now = new Date()): Promise<{ data: CalcData, rows: EmployeeDays[] }> {
  const db = serviceDb()
  const data = await loadCalcData(employees.map(e => e.id), from, to, db)
  const today = localDate(now, data.settings.timezone)
  const last = to < today ? to : today
  const dates = last >= from ? eachDate(from, last) : []

  const { data: locks } = await db.from('attendance_period_locks').select('year, month')
  const lockedKeys = new Set((locks ?? []).map(l => `${l.year}-${String(l.month).padStart(2, '0')}`))
  const lockedDates = dates.filter(d => lockedKeys.has(d.slice(0, 7)))
  const persisted = new Map<string, DayResult>()
  if (lockedDates.length) {
    const rows = await fetchAll<any>((a, b) => db.from('attendance_days').select('*')
      .in('employee_id', employees.map(e => e.id)).gte('work_date', lockedDates[0]!).lte('work_date', lockedDates.at(-1)!)
      .order('work_date').range(a, b))
    for (const r of rows) persisted.set(`${r.employee_id}|${r.work_date}`, rowToDay(r))
  }

  const rows = employees.map((employee) => {
    const live = computeEmployeeDays(data, employee.id, dates.filter(d => !lockedKeys.has(d.slice(0, 7))), now)
    const frozen = lockedDates.map(d => persisted.get(`${employee.id}|${d}`)).filter((d): d is DayResult => !!d)
    return { employee, days: [...live, ...frozen].sort((a, b) => (a.date < b.date ? -1 : 1)) }
  })
  return { data, rows }
}

export function dailyRows(rows: EmployeeDays[]) {
  return rows.flatMap(({ employee, days }) => days.map(d => ({
    employeeId: employee.id,
    code: employee.code,
    name: employee.name,
    nameEn: employee.nameEn,
    departmentAr: employee.departmentAr,
    departmentEn: employee.departmentEn,
    date: d.date,
    status: d.status,
    checkIn: d.firstCheckIn?.toISOString() ?? null,
    checkOut: d.lastCheckOut?.toISOString() ?? null,
    netMinutes: d.netMinutes,
    requiredMinutes: d.requiredMinutes,
    breakMinutes: d.breakMinutes,
    lateMinutes: d.lateMinutes,
    earlyLeaveMinutes: d.earlyLeaveMinutes,
    overtimeMinutes: d.overtimeMinutes,
    shortageMinutes: d.shortageMinutes,
    flags: d.flags,
  })))
}

function periodRow(employee: ReportEmployee, period: string, s: PeriodSummary) {
  return {
    employeeId: employee.id,
    code: employee.code,
    name: employee.name,
    nameEn: employee.nameEn,
    departmentAr: employee.departmentAr,
    departmentEn: employee.departmentEn,
    period,
    from: s.from,
    to: s.to,
    netMinutes: s.netMinutes,
    requiredMinutes: s.requiredMinutes,
    overtimeMinutes: s.overtimeMinutes,
    shortageMinutes: s.shortageMinutes,
    lateCount: s.lateCount,
    lateMinutes: s.lateMinutes,
    absenceDays: s.absenceDays,
    leaveDays: s.leaveDays,
    holidayDays: s.holidayDays,
    workingDays: s.workingDays,
    presentDays: s.presentDays,
    attendancePercentage: s.attendancePercentage,
  }
}

export function weeklyRows(data: CalcData, rows: EmployeeDays[]) {
  return rows.flatMap(({ employee, days }) => {
    const weeks = new Map<string, DayResult[]>()
    for (const d of days) {
      const k = startOfWeek(d.date, data.policy.weekStart)
      weeks.set(k, [...(weeks.get(k) ?? []), d])
    }
    return [...weeks].map(([start, w]) => periodRow(employee, start, summarize(data, employee.id, w[0]!.date, w.at(-1)!.date, w)))
  })
}

export function monthlyRows(data: CalcData, rows: EmployeeDays[]) {
  return rows.flatMap(({ employee, days }) => {
    const months = new Map<string, DayResult[]>()
    for (const d of days) {
      const k = d.date.slice(0, 7)
      months.set(k, [...(months.get(k) ?? []), d])
    }
    return [...months].map(([key, m]) => {
      const r = monthRange(Number(key.slice(0, 4)), Number(key.slice(5, 7)))
      return periodRow(employee, key, summarize(data, employee.id, r.from, m.at(-1)!.date, m))
    })
  })
}

export type ReportType = 'daily' | 'weekly' | 'monthly'

export async function buildReport(ctx: AuthContext, type: ReportType, q: { from: string, to: string, employeeId?: string, departmentId?: string }) {
  const employees = await reportEmployees(ctx, q)
  if (employees.length > 500) {
    throw apiError(422, 'too_many_employees')
  }
  const { data, rows } = await computeReportDays(employees, q.from, q.to)
  const items = type === 'daily' ? dailyRows(rows) : type === 'weekly' ? weeklyRows(data, rows) : monthlyRows(data, rows)
  const totals = rows.reduce((acc, r) => {
    const s = summarize(data, r.employee.id, q.from, q.to, r.days)
    acc.netMinutes += s.netMinutes
    acc.requiredMinutes += s.requiredMinutes
    acc.overtimeMinutes += s.overtimeMinutes
    acc.shortageMinutes += s.shortageMinutes
    acc.lateCount += s.lateCount
    acc.absenceDays += s.absenceDays
    acc.leaveDays += s.leaveDays
    return acc
  }, { netMinutes: 0, requiredMinutes: 0, overtimeMinutes: 0, shortageMinutes: 0, lateCount: 0, absenceDays: 0, leaveDays: 0 })
  return { type, from: q.from, to: q.to, timezone: data.settings.timezone, basis: data.policy.overtimeBasis, employees: employees.length, totals, items }
}
