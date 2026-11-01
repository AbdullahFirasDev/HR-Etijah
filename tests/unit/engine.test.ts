import { describe, expect, it } from 'vitest'
import {
  calculateDay,
  countLeaveDays,
  holidayOn,
  isoWeekday,
  resolveCheckInWorkDate,
  resolveSchedule,
  summarizePeriod,
  zonedInstant,
} from '#shared/engine'
import type {
  BreakInput,
  CalcPolicy,
  DayInput,
  EmployeeScheduleRow,
  HolidayInput,
  LeaveInput,
  ResolvedSchedule,
  SessionInput,
  ShiftRow,
} from '#shared/engine'

const TZ = 'Asia/Baghdad'
const at = (date: string, time: string) => zonedInstant(date, time, TZ)

// 2026-11-01 is a Sunday (working day in Iraq), 2026-11-06 a Friday (weekend).
const SUN = '2026-11-01'
const MON = '2026-11-02'
const TUE = '2026-11-03'
const FRI = '2026-11-06'

const policy: CalcPolicy = {
  timezone: TZ,
  weekStart: 7,
  defaultRequiredMinutes: 480,
  defaultWorkingDays: [7, 1, 2, 3, 4],
  missingCheckoutPolicy: 'zero',
  absenceCountsAsShortage: true,
  lateCountsFrom: 'shift_start',
  minOvertimeMinutes: 15,
  maxDailyOvertimeMinutes: 240,
  overtimeBasis: 'daily',
  holidayWorkIsOvertime: true,
}

const dayShift: ResolvedSchedule = {
  scheduleId: 's1',
  shiftId: 'DAY',
  startTime: '08:00',
  endTime: '16:00',
  crossesMidnight: false,
  requiredMinutes: 480,
  graceMinutes: 10,
  earlyLeaveGraceMinutes: 0,
  breakMinutes: 30,
  paidBreakMinutes: 30,
  workingDays: [7, 1, 2, 3, 4],
  weeklyRequiredMinutes: null,
  isFlexible: false,
  flexEarliestStart: null,
  flexLatestEnd: null,
  overtimeEligible: true,
  countBeforeShift: false,
  countAfterShift: true,
}

let seq = 0
const session = (date: string, inT: string, outT: string | null, status: SessionInput['status'] = outT ? 'closed' : 'open', outDate = date): SessionInput => ({
  id: `s${++seq}`,
  checkIn: at(date, inT),
  checkOut: outT ? at(outDate, outT) : null,
  status,
})
const brk = (s: SessionInput, date: string, start: string, end: string | null): BreakInput => ({
  id: `b${++seq}`,
  sessionId: s.id,
  start: at(date, start),
  end: end ? at(date, end) : null,
  status: end ? 'closed' : 'open',
})

function day(partial: Partial<DayInput> & { date: string }): ReturnType<typeof calculateDay> {
  return calculateDay({
    now: at(addOne(partial.date), '09:00'), // the next morning: day complete by default
    policy,
    schedule: dayShift,
    sessions: [],
    breaks: [],
    holiday: null,
    leave: null,
    ...partial,
  })
}
function addOne(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

describe('calendar helpers', () => {
  it('knows the weekdays used by the fixtures', () => {
    expect(isoWeekday(SUN)).toBe(7)
    expect(isoWeekday(FRI)).toBe(5)
  })
  it('converts Baghdad wall-clock time to UTC (UTC+3)', () => {
    expect(at(SUN, '08:00').toISOString()).toBe('2026-11-01T05:00:00.000Z')
  })
})

describe('a regular working day', () => {
  it('computes net time, paid break and no overtime below the threshold', () => {
    const s = session(SUN, '07:58', '16:05')
    const r = day({ date: SUN, sessions: [s], breaks: [brk(s, SUN, '12:00', '12:30')] })
    expect(r).toMatchObject({
      status: 'present',
      grossMinutes: 485, // counting starts at 08:00 (time before shift not permitted)
      breakMinutes: 30,
      unpaidBreakMinutes: 0,
      netMinutes: 485,
      requiredMinutes: 480,
      overtimeMinutes: 0, // 5 min < 15 min threshold
      shortageMinutes: 0,
      lateMinutes: 0,
    })
    expect(r.flags).toContain('time_outside_schedule_excluded')
  })

  it('counts late minutes from shift start once the grace period is exceeded', () => {
    expect(day({ date: SUN, sessions: [session(SUN, '08:09', '16:30')] }).lateMinutes).toBe(0)
    const late = day({ date: SUN, sessions: [session(SUN, '08:25', '16:30')] })
    expect(late.lateMinutes).toBe(25)
    expect(late.flags).toContain('late')
  })

  it('can count late minutes from the end of the grace period', () => {
    const r = calculateDay({
      date: SUN, now: at(MON, '09:00'), policy: { ...policy, lateCountsFrom: 'grace_end' }, schedule: dayShift,
      sessions: [session(SUN, '08:25', '16:30')], breaks: [], holiday: null, leave: null,
    })
    expect(r.lateMinutes).toBe(15)
  })

  it('computes overtime for eligible employees', () => {
    const r = day({ date: SUN, sessions: [session(SUN, '08:00', '18:00')] })
    expect(r.netMinutes).toBe(600)
    expect(r.overtimeMinutes).toBe(120)
    expect(r.flags).toContain('overtime')
  })

  it('caps daily overtime', () => {
    expect(day({ date: SUN, sessions: [session(SUN, '08:00', '23:00')] }).overtimeMinutes).toBe(240)
  })

  it('gives no overtime to ineligible employees', () => {
    const r = day({ date: SUN, schedule: { ...dayShift, overtimeEligible: false }, sessions: [session(SUN, '08:00', '18:00')] })
    expect(r.overtimeMinutes).toBe(0)
    expect(r.netMinutes).toBe(600)
  })

  it('does not count time after the shift unless policy permits it', () => {
    const r = day({ date: SUN, schedule: { ...dayShift, countAfterShift: false }, sessions: [session(SUN, '08:00', '18:00')] })
    expect(r.netMinutes).toBe(480)
    expect(r.overtimeMinutes).toBe(0)
    expect(r.flags).toContain('time_outside_schedule_excluded')
  })

  it('computes shortage and early departure', () => {
    const r = day({ date: SUN, sessions: [session(SUN, '08:00', '14:00')] })
    expect(r).toMatchObject({ netMinutes: 360, shortageMinutes: 120, earlyLeaveMinutes: 120 })
    expect(r.flags).toEqual(expect.arrayContaining(['shortage', 'early_departure']))
  })

  it('deducts unpaid breaks and break time beyond the paid allowance', () => {
    const unpaid = { ...dayShift, breakMinutes: 60, paidBreakMinutes: 0 }
    const s1 = session(SUN, '08:00', '17:00')
    const r1 = day({ date: SUN, schedule: unpaid, sessions: [s1], breaks: [brk(s1, SUN, '12:00', '12:45')] })
    expect(r1).toMatchObject({ grossMinutes: 540, unpaidBreakMinutes: 45, netMinutes: 495 })

    const s2 = session(SUN, '08:00', '16:00')
    const r2 = day({ date: SUN, sessions: [s2], breaks: [brk(s2, SUN, '12:00', '12:50')] })
    expect(r2).toMatchObject({ breakMinutes: 50, paidBreakMinutes: 30, unpaidBreakMinutes: 20, netMinutes: 460, shortageMinutes: 20 })
    expect(r2.flags).toContain('break_exceeded')
  })

  it('supports multiple work intervals in one day', () => {
    const r = day({ date: SUN, sessions: [session(SUN, '08:00', '12:00'), session(SUN, '13:00', '17:00')] })
    expect(r).toMatchObject({ netMinutes: 480, shortageMinutes: 0, earlyLeaveMinutes: 0 })
  })
})

describe('absence and incomplete days', () => {
  it('marks a complete working day without attendance as absent with full shortage', () => {
    const r = day({ date: SUN })
    expect(r).toMatchObject({ status: 'absent', shortageMinutes: 480 })
  })

  it('can exclude plain absences from shortage', () => {
    const r = calculateDay({ date: SUN, now: at(MON, '09:00'), policy: { ...policy, absenceCountsAsShortage: false }, schedule: dayShift, sessions: [], breaks: [], holiday: null, leave: null })
    expect(r).toMatchObject({ status: 'absent', shortageMinutes: 0 })
  })

  it('does not declare shortage or absence before the day is over', () => {
    const r = day({ date: SUN, now: at(SUN, '11:00') })
    expect(r).toMatchObject({ status: 'scheduled', shortageMinutes: 0, remainingMinutes: 480, isComplete: false })
  })

  it('computes live progress for an open session', () => {
    const s = session(SUN, '08:00', null)
    const r = day({ date: SUN, now: at(SUN, '12:00'), sessions: [s], breaks: [brk(s, SUN, '10:00', null)] })
    expect(r.status).toBe('in_progress')
    expect(r.grossMinutes).toBe(240)
    expect(r.breakMinutes).toBe(120) // open break counts until now
    expect(r.unpaidBreakMinutes).toBe(90)
    expect(r.netMinutes).toBe(150)
    expect(r.remainingMinutes).toBe(330)
    expect(r.shortageMinutes).toBe(0)
  })

  it('treats a missing check-out as zero time by default', () => {
    const r = day({ date: SUN, sessions: [session(SUN, '08:00', null, 'missing_checkout')] })
    expect(r).toMatchObject({ status: 'missing_checkout', netMinutes: 0, shortageMinutes: 480 })
    expect(r.flags).toContain('missing_checkout')
  })

  it('can count a missing check-out up to the scheduled end', () => {
    const r = calculateDay({
      date: SUN, now: at(MON, '09:00'), policy: { ...policy, missingCheckoutPolicy: 'scheduled_end' }, schedule: dayShift,
      sessions: [session(SUN, '08:00', null, 'missing_checkout')], breaks: [], holiday: null, leave: null,
    })
    expect(r.netMinutes).toBe(480)
  })
})

describe('overnight shifts', () => {
  const night: ResolvedSchedule = { ...dayShift, shiftId: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true }

  it('calculates a shift that crosses midnight on the start date', () => {
    const s = session(SUN, '21:55', '06:10', 'closed', MON)
    const r = day({ date: SUN, schedule: night, sessions: [s], now: at(MON, '12:00') })
    expect(r.scheduledStart?.toISOString()).toBe(at(SUN, '22:00').toISOString())
    expect(r.scheduledEnd?.toISOString()).toBe(at(MON, '06:00').toISOString())
    expect(r).toMatchObject({ grossMinutes: 490, netMinutes: 490, lateMinutes: 0, overtimeMinutes: 0, shortageMinutes: 0 })
  })

  it('detects late arrival after midnight', () => {
    const s = session(MON, '00:30', '06:00')
    const r = day({ date: SUN, schedule: night, sessions: [s], now: at(MON, '12:00') })
    expect(r.lateMinutes).toBe(150)
    expect(r.shortageMinutes).toBe(150)
  })

  it('assigns post-midnight check-ins to the previous work date', () => {
    const scheduleFor = () => night
    expect(resolveCheckInWorkDate(at(MON, '01:00'), TZ, scheduleFor)).toBe(SUN)
    expect(resolveCheckInWorkDate(at(MON, '21:50'), TZ, scheduleFor)).toBe(MON)
    expect(resolveCheckInWorkDate(at(MON, '07:00'), TZ, () => dayShift)).toBe(MON)
  })
})

describe('holidays, days off and leave', () => {
  const holiday: HolidayInput = { id: 'h1', nameAr: 'عيد', nameEn: 'Holiday', type: 'official', startDate: SUN, endDate: SUN, isRecurring: false, officeId: null }
  const annual: LeaveInput = { requestId: 'l1', leaveTypeId: 'annual', code: 'annual', startDate: SUN, endDate: SUN, isHalfDay: false, isPaid: true, excludedFromAbsence: true, excludedFromShortage: true }

  it('requires nothing on an official holiday', () => {
    expect(day({ date: SUN, holiday })).toMatchObject({ status: 'holiday', requiredMinutes: 0, shortageMinutes: 0, isWorkingDay: false })
  })

  it('counts holiday work as overtime when policy says so', () => {
    const r = day({ date: SUN, holiday, sessions: [session(SUN, '09:00', '12:00')] })
    expect(r).toMatchObject({ status: 'present', overtimeMinutes: 180 })
    expect(r.flags).toContain('holiday_work')
  })

  it('treats the weekend as a day off and work on it as overtime', () => {
    expect(day({ date: FRI })).toMatchObject({ status: 'day_off', requiredMinutes: 0, shortageMinutes: 0 })
    const worked = day({ date: FRI, sessions: [session(FRI, '10:00', '12:00')] })
    expect(worked).toMatchObject({ overtimeMinutes: 120 })
    expect(worked.flags).toContain('day_off_work')
  })

  it('excludes approved full-day leave from absence and shortage', () => {
    expect(day({ date: SUN, leave: annual })).toMatchObject({ status: 'on_leave', requiredMinutes: 0, shortageMinutes: 0, leaveFraction: 1 })
  })

  it('can keep leave in shortage when the leave type is configured so', () => {
    expect(day({ date: SUN, leave: { ...annual, excludedFromShortage: false } })).toMatchObject({ requiredMinutes: 480, shortageMinutes: 480 })
  })

  it('halves the requirement for half-day leave and skips lateness', () => {
    const r = day({ date: SUN, leave: { ...annual, isHalfDay: true }, sessions: [session(SUN, '12:00', '16:00')] })
    expect(r).toMatchObject({ requiredMinutes: 240, netMinutes: 240, shortageMinutes: 0, lateMinutes: 0, leaveFraction: 0.5 })
  })

  it('ignores leave that falls on a holiday', () => {
    expect(day({ date: SUN, holiday, leave: annual })).toMatchObject({ status: 'holiday', leaveFraction: 0 })
  })

  it('counts chargeable leave days excluding weekends and holidays', () => {
    const scheduleFor = () => dayShift
    // Sun 1 → Sat 7 Nov: Sun–Thu working (5), minus a holiday on Tue = 4
    const h: HolidayInput = { ...holiday, startDate: TUE, endDate: TUE }
    expect(countLeaveDays(SUN, '2026-11-07', false, scheduleFor, [h], null)).toBe(4)
    expect(countLeaveDays(SUN, SUN, true, scheduleFor, [], null)).toBe(0.5)
    expect(countLeaveDays(FRI, FRI, true, scheduleFor, [], null)).toBe(0)
  })

  it('matches recurring holidays every year and office-specific ones only for that office', () => {
    const newYear: HolidayInput = { ...holiday, startDate: '2020-01-01', endDate: '2020-01-01', isRecurring: true }
    expect(holidayOn('2027-01-01', [newYear], null)).toBe(newYear)
    const local = { ...holiday, officeId: 'office-a' }
    expect(holidayOn(SUN, [local], 'office-b')).toBeNull()
    expect(holidayOn(SUN, [local], 'office-a')).toBe(local)
  })
})

describe('flexible schedules', () => {
  const flex: ResolvedSchedule = { ...dayShift, isFlexible: true, flexEarliestStart: '07:00', flexLatestEnd: '19:00', breakMinutes: 60, paidBreakMinutes: 0, countAfterShift: false }

  it('has no lateness and clips to the flexible window', () => {
    const s = session(SUN, '10:00', '19:30')
    const r = day({ date: SUN, schedule: flex, sessions: [s], breaks: [brk(s, SUN, '13:00', '14:00')] })
    expect(r).toMatchObject({ lateMinutes: 0, grossMinutes: 540, unpaidBreakMinutes: 60, netMinutes: 480, shortageMinutes: 0 })
  })
})

describe('schedule resolution', () => {
  const shift: ShiftRow = {
    id: 'DAY', start_time: '08:00:00', end_time: '16:00:00', required_minutes: 480, grace_minutes: 10, early_leave_grace_minutes: 0,
    break_minutes: 30, paid_break_minutes: 30, working_days: [7, 1, 2, 3, 4], weekly_required_minutes: null, is_flexible: false,
    flex_earliest_start: null, flex_latest_end: null, overtime_eligible: true, count_before_shift: false, count_after_shift: false,
  }
  const base: EmployeeScheduleRow = {
    id: 'es1', effective_from: '2026-01-01', effective_to: '2026-06-30', shift, required_minutes: null, working_days: null,
    start_time: null, end_time: null, grace_minutes: null, early_leave_grace_minutes: null, break_minutes: null,
    paid_break_minutes: null, weekly_required_minutes: null, is_flexible: null, flex_earliest_start: null, flex_latest_end: null,
    overtime_eligible: null, count_before_shift: null, count_after_shift: null,
  }

  it('applies per-employee overrides over the shift and respects effective dates', () => {
    const rows = [base, { ...base, id: 'es2', effective_from: '2026-07-01', effective_to: null, required_minutes: 420, grace_minutes: 0 }]
    expect(resolveSchedule('2026-03-01', rows, policy)?.requiredMinutes).toBe(480)
    const later = resolveSchedule('2026-08-01', rows, policy)!
    expect(later).toMatchObject({ scheduleId: 'es2', requiredMinutes: 420, graceMinutes: 0, startTime: '08:00:00' })
    expect(resolveSchedule('2025-12-31', rows, policy)).toBeNull()
  })

  it('detects overnight shifts', () => {
    const night = resolveSchedule('2026-03-01', [{ ...base, start_time: '22:00:00', end_time: '06:00:00' }], policy)!
    expect(night.crossesMidnight).toBe(true)
  })
})

describe('period summaries', () => {
  const s1 = session(SUN, '08:00', '17:00') // 540 → overtime 60
  const s2 = session(MON, '08:00', '15:00') // 420 → shortage 60
  const days = [day({ date: SUN, sessions: [s1] }), day({ date: MON, sessions: [s2] }), day({ date: TUE }), day({ date: FRI })]

  it('sums daily overtime and shortage on a daily basis', () => {
    const p = summarizePeriod(SUN, FRI, days, { basis: 'daily' })
    expect(p).toMatchObject({ netMinutes: 960, requiredMinutes: 1440, overtimeMinutes: 60, shortageMinutes: 60 + 480, absenceDays: 1, workingDays: 3, presentDays: 2 })
    expect(p.attendancePercentage).toBeCloseTo(66.67, 1)
  })

  it('offsets surplus and deficit on a weekly basis', () => {
    const p = summarizePeriod(SUN, MON, days.slice(0, 2), { basis: 'weekly', overtimeEligible: true, minOvertimeMinutes: 15 })
    expect(p).toMatchObject({ overtimeMinutes: 0, shortageMinutes: 0 })
  })

  it('applies a weekly target scaled for leave', () => {
    const leave: LeaveInput = { requestId: 'l', leaveTypeId: 'a', code: 'annual', startDate: MON, endDate: MON, isHalfDay: false, isPaid: true, excludedFromAbsence: true, excludedFromShortage: true }
    const week = [day({ date: SUN, sessions: [s1] }), day({ date: MON, leave })]
    const p = summarizePeriod(SUN, MON, week, { basis: 'weekly', weeklyRequiredMinutes: 1000, overtimeEligible: true })
    expect(p.requiredMinutes).toBe(500) // half of the base requirement remains → half of the weekly target
    expect(p.overtimeMinutes).toBe(40)
    expect(p.attendancePercentage).toBe(100)
  })
})
