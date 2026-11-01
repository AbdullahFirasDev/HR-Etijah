import type { CalcPolicy, EmployeeScheduleRow, HolidayInput, LeaveInput, ResolvedSchedule } from './types'
import { addDays, isoWeekday, localDate, zonedInstant } from './time'

/** Pick the schedule effective on `date` and merge: employee override > shift > org default. */
export function resolveSchedule(date: string, schedules: EmployeeScheduleRow[], policy: CalcPolicy): ResolvedSchedule | null {
  const row = schedules.find(s => s.effective_from <= date && (s.effective_to === null || s.effective_to >= date))
  if (!row) {
    return null
  }
  const sh = row.shift
  const startTime = row.start_time ?? sh?.start_time ?? null
  const endTime = row.end_time ?? sh?.end_time ?? null
  const breakMinutes = row.break_minutes ?? sh?.break_minutes ?? 0
  return {
    scheduleId: row.id,
    shiftId: sh?.id ?? null,
    startTime,
    endTime,
    crossesMidnight: startTime !== null && endTime !== null && endTime <= startTime,
    requiredMinutes: row.required_minutes ?? sh?.required_minutes ?? policy.defaultRequiredMinutes,
    graceMinutes: row.grace_minutes ?? sh?.grace_minutes ?? 0,
    earlyLeaveGraceMinutes: row.early_leave_grace_minutes ?? sh?.early_leave_grace_minutes ?? 0,
    breakMinutes,
    paidBreakMinutes: Math.min(row.paid_break_minutes ?? sh?.paid_break_minutes ?? 0, breakMinutes),
    workingDays: row.working_days ?? sh?.working_days ?? policy.defaultWorkingDays,
    weeklyRequiredMinutes: row.weekly_required_minutes ?? sh?.weekly_required_minutes ?? null,
    isFlexible: row.is_flexible ?? sh?.is_flexible ?? startTime === null,
    flexEarliestStart: row.flex_earliest_start ?? sh?.flex_earliest_start ?? null,
    flexLatestEnd: row.flex_latest_end ?? sh?.flex_latest_end ?? null,
    overtimeEligible: row.overtime_eligible ?? sh?.overtime_eligible ?? false,
    countBeforeShift: row.count_before_shift ?? sh?.count_before_shift ?? false,
    countAfterShift: row.count_after_shift ?? sh?.count_after_shift ?? false,
  }
}

export function isScheduledDay(date: string, schedule: ResolvedSchedule | null): boolean {
  return schedule !== null && schedule.workingDays.includes(isoWeekday(date))
}

/** Fixed shift window of the work date (overnight shifts end on the next calendar day). */
export function shiftWindow(date: string, schedule: ResolvedSchedule, tz: string): { start: Date, end: Date } | null {
  if (!schedule.startTime || !schedule.endTime) {
    return null
  }
  return {
    start: zonedInstant(date, schedule.startTime, tz),
    end: zonedInstant(schedule.crossesMidnight ? addDays(date, 1) : date, schedule.endTime, tz),
  }
}

/**
 * Bounds within which worked time counts for this work date (null = unbounded).
 * Time outside the approved schedule only counts when policy permits it
 * (count_before_shift / count_after_shift, or the flexible window).
 */
export function countingBounds(
  date: string,
  schedule: ResolvedSchedule | null,
  tz: string,
  scheduledDay: boolean,
): { lower: Date | null, upper: Date | null } {
  if (!schedule || !scheduledDay) {
    return { lower: null, upper: null } // day off / holiday work: no schedule to clip against
  }
  if (schedule.isFlexible) {
    const lower = schedule.flexEarliestStart ? zonedInstant(date, schedule.flexEarliestStart, tz) : null
    let upper: Date | null = null
    if (schedule.flexLatestEnd) {
      const overnight = schedule.flexEarliestStart !== null && schedule.flexLatestEnd <= schedule.flexEarliestStart
      upper = zonedInstant(overnight ? addDays(date, 1) : date, schedule.flexLatestEnd, tz)
    }
    return { lower, upper }
  }
  const w = shiftWindow(date, schedule, tz)
  if (!w) {
    return { lower: null, upper: null }
  }
  return {
    lower: schedule.countBeforeShift ? null : w.start,
    upper: schedule.countAfterShift ? null : w.end,
  }
}

/**
 * Work date for a check-in at `now`. A check-in after midnight while the previous day's
 * overnight shift is still running belongs to the previous day (late arrival).
 */
export function resolveCheckInWorkDate(
  now: Date,
  tz: string,
  scheduleFor: (date: string) => ResolvedSchedule | null,
): string {
  const today = localDate(now, tz)
  const yesterday = addDays(today, -1)
  const prev = scheduleFor(yesterday)
  if (prev && prev.crossesMidnight && isScheduledDay(yesterday, prev)) {
    const w = shiftWindow(yesterday, prev, tz)
    if (w && now.getTime() < w.end.getTime()) {
      return yesterday
    }
  }
  return today
}

/** Holiday covering `date` (recurring holidays match on month-day every year). */
export function holidayOn(date: string, holidays: HolidayInput[], officeId: string | null): HolidayInput | null {
  for (const h of holidays) {
    if (h.officeId && h.officeId !== officeId) {
      continue
    }
    if (h.isRecurring) {
      const year = date.slice(0, 4)
      const start = `${year}${h.startDate.slice(4)}`
      const end = `${year}${h.endDate.slice(4)}`
      if (start <= end ? date >= start && date <= end : date >= start || date <= end) {
        return h
      }
    }
    else if (date >= h.startDate && date <= h.endDate) {
      return h
    }
  }
  return null
}

/** Approved leave covering `date`. */
export function leaveOn(date: string, leaves: LeaveInput[]): LeaveInput | null {
  return leaves.find(l => date >= l.startDate && date <= l.endDate) ?? null
}

/**
 * Chargeable leave days in a range: only scheduled working days that are not holidays count.
 * A half-day request counts 0.5 when it falls on a working day.
 */
export function countLeaveDays(
  startDate: string,
  endDate: string,
  isHalfDay: boolean,
  scheduleFor: (date: string) => ResolvedSchedule | null,
  holidays: HolidayInput[],
  officeId: string | null,
): number {
  let days = 0
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    if (isScheduledDay(d, scheduleFor(d)) && !holidayOn(d, holidays, officeId)) {
      days += 1
    }
  }
  return isHalfDay ? Math.min(days, 1) * 0.5 : days
}
