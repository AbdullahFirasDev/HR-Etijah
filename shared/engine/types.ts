import type { DayStatus } from '../constants'

/** Raw shift row (snake_case as stored). */
export interface ShiftRow {
  id: string
  start_time: string
  end_time: string
  required_minutes: number
  grace_minutes: number
  early_leave_grace_minutes: number
  break_minutes: number
  paid_break_minutes: number
  working_days: number[]
  weekly_required_minutes: number | null
  is_flexible: boolean
  flex_earliest_start: string | null
  flex_latest_end: string | null
  overtime_eligible: boolean
  count_before_shift: boolean
  count_after_shift: boolean
}

/** Raw employee_schedules row with its shift joined. NULL override = inherit. */
export interface EmployeeScheduleRow {
  id: string
  effective_from: string
  effective_to: string | null
  shift: ShiftRow | null
  required_minutes: number | null
  working_days: number[] | null
  start_time: string | null
  end_time: string | null
  grace_minutes: number | null
  early_leave_grace_minutes: number | null
  break_minutes: number | null
  paid_break_minutes: number | null
  weekly_required_minutes: number | null
  is_flexible: boolean | null
  flex_earliest_start: string | null
  flex_latest_end: string | null
  overtime_eligible: boolean | null
  count_before_shift: boolean | null
  count_after_shift: boolean | null
}

export interface ResolvedSchedule {
  scheduleId: string | null
  shiftId: string | null
  startTime: string | null
  endTime: string | null
  crossesMidnight: boolean
  requiredMinutes: number
  graceMinutes: number
  earlyLeaveGraceMinutes: number
  breakMinutes: number
  paidBreakMinutes: number
  workingDays: number[]
  weeklyRequiredMinutes: number | null
  isFlexible: boolean
  flexEarliestStart: string | null
  flexLatestEnd: string | null
  overtimeEligible: boolean
  countBeforeShift: boolean
  countAfterShift: boolean
}

/** Organisation policy values that affect calculations (subset of org_settings). */
export interface CalcPolicy {
  timezone: string
  weekStart: number
  defaultRequiredMinutes: number
  defaultWorkingDays: number[]
  missingCheckoutPolicy: 'zero' | 'scheduled_end'
  absenceCountsAsShortage: boolean
  lateCountsFrom: 'shift_start' | 'grace_end'
  minOvertimeMinutes: number
  maxDailyOvertimeMinutes: number
  overtimeBasis: 'daily' | 'weekly'
  holidayWorkIsOvertime: boolean
}

export interface SessionInput {
  id: string
  checkIn: Date
  checkOut: Date | null
  status: 'open' | 'closed' | 'missing_checkout'
}

export interface BreakInput {
  id: string
  sessionId: string
  start: Date
  end: Date | null
  status: 'open' | 'closed'
}

export interface HolidayInput {
  id: string
  nameAr: string
  nameEn: string
  type: 'official' | 'company'
  startDate: string
  endDate: string
  isRecurring: boolean
  officeId: string | null
}

export interface LeaveInput {
  requestId: string
  leaveTypeId: string
  code: string
  startDate: string
  endDate: string
  isHalfDay: boolean
  isPaid: boolean
  excludedFromAbsence: boolean
  excludedFromShortage: boolean
}

export interface DayInput {
  date: string
  now: Date
  policy: CalcPolicy
  schedule: ResolvedSchedule | null
  sessions: SessionInput[]
  breaks: BreakInput[]
  holiday: HolidayInput | null
  leave: LeaveInput | null
}

export interface IntervalDetail {
  sessionId: string
  start: string
  end: string | null
  countedStart: string | null
  countedEnd: string | null
  minutes: number
  note?: string
}

export interface DayResult {
  date: string
  status: DayStatus
  isWorkingDay: boolean
  isScheduledDay: boolean
  isHoliday: boolean
  isComplete: boolean
  leaveTypeId: string | null
  leaveFraction: number
  firstCheckIn: Date | null
  lastCheckOut: Date | null
  scheduledStart: Date | null
  scheduledEnd: Date | null
  grossMinutes: number
  breakMinutes: number
  paidBreakMinutes: number
  unpaidBreakMinutes: number
  netMinutes: number
  /** Required minutes before leave reductions (used for proportional weekly targets). */
  baseRequiredMinutes: number
  requiredMinutes: number
  remainingMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number
  overtimeMinutes: number
  shortageMinutes: number
  flags: string[]
  details: Record<string, unknown>
  calcVersion: string
}

export interface PeriodSummary {
  from: string
  to: string
  days: number
  workingDays: number
  presentDays: number
  absenceDays: number
  leaveDays: number
  holidayDays: number
  lateCount: number
  lateMinutes: number
  earlyLeaveMinutes: number
  breakMinutes: number
  netMinutes: number
  requiredMinutes: number
  overtimeMinutes: number
  shortageMinutes: number
  missingCheckouts: number
  attendancePercentage: number
  basis: 'daily' | 'weekly'
}
