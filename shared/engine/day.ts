/**
 * Daily attendance calculation.
 *
 *   net working time = Σ valid work intervals (clipped to the permitted window) − unpaid breaks
 *   overtime         = max(0, net − required)        (eligible employees; thresholds/caps apply)
 *   shortage         = max(0, required − net)        (only once the day is complete)
 *
 * Pure and deterministic: given the same inputs it always yields the same result, and the
 * inputs/policy actually used are returned in `details` so every figure can be audited.
 */
import type { DayStatus } from '../constants'
import type { DayInput, DayResult, IntervalDetail } from './types'
import { countingBounds, isScheduledDay, shiftWindow } from './schedule'
import { addDays, maxDate, minDate, zonedInstant } from './time'

export const CALC_VERSION = '1.0.0'

const MIN = 60_000
const floorMin = (ms: number) => Math.max(0, Math.floor(ms / MIN))

export function calculateDay(input: DayInput): DayResult {
  const { date, now, policy, schedule, holiday } = input
  const tz = policy.timezone
  const scheduledDay = isScheduledDay(date, schedule)
  const isHoliday = holiday !== null
  const isWorkingDay = scheduledDay && !isHoliday
  const leave = isWorkingDay ? input.leave : null
  const leaveFraction = leave ? (leave.isHalfDay ? 0.5 : 1) : 0

  const window = schedule && !schedule.isFlexible ? shiftWindow(date, schedule, tz) : null
  const bounds = countingBounds(date, schedule, tz, isWorkingDay)
  const dayEnd = window?.end ?? bounds.upper ?? zonedInstant(addDays(date, 1), '00:00', tz)

  const sessions = [...input.sessions].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())
  const hasOpen = sessions.some(s => s.status === 'open')
  const hasMissing = sessions.some(s => s.status === 'missing_checkout')
  const worked = sessions.length > 0
  const isComplete = !hasOpen && now.getTime() >= dayEnd.getTime()

  // ---- work intervals ---------------------------------------------------------------
  const counted = new Map<string, { start: Date, end: Date } | null>()
  const intervals: IntervalDetail[] = []
  let grossMs = 0
  let excludedMs = 0
  for (const s of sessions) {
    let end = s.checkOut
    let note: string | undefined
    if (!end) {
      if (s.status === 'open') {
        end = maxDate(s.checkIn, now)
        note = 'open_until_now'
      }
      else if (policy.missingCheckoutPolicy === 'scheduled_end' && window) {
        end = maxDate(s.checkIn, window.end)
        note = 'missing_checkout_counted_to_shift_end'
      }
      else {
        end = s.checkIn
        note = 'missing_checkout_not_counted'
      }
    }
    const cs = bounds.lower ? maxDate(s.checkIn, bounds.lower) : s.checkIn
    const ce = bounds.upper ? minDate(end, bounds.upper) : end
    const ms = Math.max(0, ce.getTime() - cs.getTime())
    excludedMs += Math.max(0, end.getTime() - s.checkIn.getTime()) - ms
    grossMs += ms
    counted.set(s.id, ms > 0 ? { start: cs, end: ce } : null)
    intervals.push({
      sessionId: s.id,
      start: s.checkIn.toISOString(),
      end: s.checkOut?.toISOString() ?? null,
      countedStart: ms > 0 ? cs.toISOString() : null,
      countedEnd: ms > 0 ? ce.toISOString() : null,
      minutes: floorMin(ms),
      note,
    })
  }

  // ---- breaks (only the part inside a counted interval reduces time) -------------------
  let breakMs = 0
  const breakDetails: Array<{ breakId: string, minutes: number }> = []
  for (const b of input.breaks) {
    const c = counted.get(b.sessionId)
    if (!c) {
      continue
    }
    const bEnd = b.end ?? (b.status === 'open' ? now : b.start)
    const ms = Math.max(0, minDate(bEnd, c.end).getTime() - maxDate(b.start, c.start).getTime())
    breakMs += ms
    breakDetails.push({ breakId: b.id, minutes: floorMin(ms) })
  }
  const paidAllowanceMs = (schedule?.paidBreakMinutes ?? 0) * MIN
  const paidBreakMs = Math.min(breakMs, paidAllowanceMs)
  const unpaidBreakMs = breakMs - paidBreakMs
  const netMs = Math.max(0, grossMs - unpaidBreakMs)

  const grossMinutes = floorMin(grossMs)
  const breakMinutes = floorMin(breakMs)
  const paidBreakMinutes = floorMin(paidBreakMs)
  const unpaidBreakMinutes = floorMin(unpaidBreakMs)
  const netMinutes = floorMin(netMs)

  // ---- required time --------------------------------------------------------------------
  const baseRequiredMinutes = isWorkingDay && schedule ? schedule.requiredMinutes : 0
  const requiredMinutes = leave && leave.excludedFromShortage
    ? Math.round(baseRequiredMinutes * (1 - leaveFraction))
    : baseRequiredMinutes

  // ---- late arrival / early departure (fixed schedules only) -------------------------------
  let lateMinutes = 0
  let earlyLeaveMinutes = 0
  if (isWorkingDay && window && worked && leaveFraction === 0 && schedule) {
    const firstIn = sessions[0]!.checkIn
    const graceEnd = window.start.getTime() + schedule.graceMinutes * MIN
    if (firstIn.getTime() > graceEnd) {
      const from = policy.lateCountsFrom === 'shift_start' ? window.start.getTime() : graceEnd
      lateMinutes = floorMin(firstIn.getTime() - from)
    }
    if (isComplete && !hasMissing) {
      const lastOut = sessions.reduce<Date | null>((acc, s) => (s.checkOut && (!acc || s.checkOut > acc) ? s.checkOut : acc), null)
      if (lastOut && lastOut.getTime() < window.end.getTime() - schedule.earlyLeaveGraceMinutes * MIN) {
        earlyLeaveMinutes = floorMin(window.end.getTime() - lastOut.getTime())
      }
    }
  }

  // ---- overtime --------------------------------------------------------------------------
  let overtimeMinutes = 0
  if (schedule?.overtimeEligible) {
    if (!isWorkingDay) {
      overtimeMinutes = isHoliday && !policy.holidayWorkIsOvertime ? 0 : netMinutes
    }
    else {
      overtimeMinutes = Math.max(0, netMinutes - requiredMinutes)
    }
    if (overtimeMinutes < policy.minOvertimeMinutes) {
      overtimeMinutes = 0
    }
    overtimeMinutes = Math.min(overtimeMinutes, policy.maxDailyOvertimeMinutes)
  }

  // ---- shortage (final only once the day is over) -----------------------------------------
  const remainingMinutes = Math.max(0, requiredMinutes - netMinutes)
  let shortageMinutes = 0
  if (isComplete && requiredMinutes > 0) {
    const plainAbsence = !worked && !leave
    shortageMinutes = plainAbsence && !policy.absenceCountsAsShortage ? 0 : remainingMinutes
  }

  // ---- status + flags ------------------------------------------------------------------------
  let status: DayStatus
  if (hasOpen) {
    status = 'in_progress'
  }
  else if (hasMissing) {
    status = 'missing_checkout'
  }
  else if (worked) {
    status = 'present'
  }
  else if (isHoliday) {
    status = 'holiday'
  }
  else if (!scheduledDay) {
    status = 'day_off'
  }
  else if (leave && leaveFraction >= 1 && leave.excludedFromAbsence) {
    status = 'on_leave'
  }
  else if (isComplete) {
    status = 'absent'
  }
  else {
    status = 'scheduled'
  }

  const flags: string[] = []
  if (lateMinutes > 0) flags.push('late')
  if (earlyLeaveMinutes > 0) flags.push('early_departure')
  if (overtimeMinutes > 0) flags.push('overtime')
  if (shortageMinutes > 0) flags.push('shortage')
  if (hasMissing) flags.push('missing_checkout')
  if (schedule && breakMinutes > schedule.breakMinutes) flags.push('break_exceeded')
  if (worked && isHoliday) flags.push('holiday_work')
  if (worked && !scheduledDay) flags.push('day_off_work')
  if (leaveFraction === 0.5) flags.push('half_day_leave')
  if (excludedMs >= MIN) flags.push('time_outside_schedule_excluded')

  return {
    date,
    status,
    isWorkingDay,
    isScheduledDay: scheduledDay,
    isHoliday,
    isComplete,
    leaveTypeId: leave?.leaveTypeId ?? null,
    leaveFraction,
    firstCheckIn: sessions[0]?.checkIn ?? null,
    lastCheckOut: sessions.reduce<Date | null>((acc, s) => (s.checkOut && (!acc || s.checkOut > acc) ? s.checkOut : acc), null),
    scheduledStart: window?.start ?? null,
    scheduledEnd: window?.end ?? null,
    grossMinutes,
    breakMinutes,
    paidBreakMinutes,
    unpaidBreakMinutes,
    netMinutes,
    baseRequiredMinutes,
    requiredMinutes,
    remainingMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    shortageMinutes,
    flags,
    calcVersion: CALC_VERSION,
    details: {
      calcVersion: CALC_VERSION,
      computedFor: now.toISOString(),
      schedule: schedule
        ? {
            scheduleId: schedule.scheduleId,
            shiftId: schedule.shiftId,
            start: schedule.startTime,
            end: schedule.endTime,
            crossesMidnight: schedule.crossesMidnight,
            flexible: schedule.isFlexible,
            requiredMinutes: schedule.requiredMinutes,
            graceMinutes: schedule.graceMinutes,
            breakMinutes: schedule.breakMinutes,
            paidBreakMinutes: schedule.paidBreakMinutes,
            overtimeEligible: schedule.overtimeEligible,
            countBeforeShift: schedule.countBeforeShift,
            countAfterShift: schedule.countAfterShift,
          }
        : null,
      countingBounds: { lower: bounds.lower?.toISOString() ?? null, upper: bounds.upper?.toISOString() ?? null },
      intervals,
      breaks: breakDetails,
      excludedMinutes: floorMin(excludedMs),
      holiday: holiday ? { id: holiday.id, type: holiday.type, name: holiday.nameEn } : null,
      leave: leave ? { requestId: leave.requestId, code: leave.code, fraction: leaveFraction, excludedFromShortage: leave.excludedFromShortage, excludedFromAbsence: leave.excludedFromAbsence } : null,
      policy: {
        missingCheckoutPolicy: policy.missingCheckoutPolicy,
        absenceCountsAsShortage: policy.absenceCountsAsShortage,
        lateCountsFrom: policy.lateCountsFrom,
        minOvertimeMinutes: policy.minOvertimeMinutes,
        maxDailyOvertimeMinutes: policy.maxDailyOvertimeMinutes,
        holidayWorkIsOvertime: policy.holidayWorkIsOvertime,
      },
      formula: {
        net: `${grossMinutes} gross − ${unpaidBreakMinutes} unpaid break = ${netMinutes}`,
        overtime: `max(0, ${netMinutes} − ${requiredMinutes}) → ${overtimeMinutes}`,
        shortage: isComplete ? `max(0, ${requiredMinutes} − ${netMinutes}) → ${shortageMinutes}` : 'day not complete',
      },
    },
  }
}
