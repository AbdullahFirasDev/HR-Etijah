/**
 * Weekly / monthly aggregation of daily results.
 *
 * Basis 'daily'  — overtime and shortage are the sums of the daily figures.
 * Basis 'weekly' — overtime/shortage are recomputed on period totals (time worked on one day
 *                  offsets shortage on another). A weekly target (weekly_required_minutes)
 *                  replaces the sum of daily requirements, scaled down proportionally for
 *                  leave and holidays.
 */
import type { DayResult, PeriodSummary } from './types'

export interface PeriodOptions {
  basis: 'daily' | 'weekly'
  weeklyRequiredMinutes?: number | null
  overtimeEligible?: boolean
  minOvertimeMinutes?: number
}

export function summarizePeriod(from: string, to: string, days: DayResult[], opts: PeriodOptions): PeriodSummary {
  let workingDays = 0
  let presentDays = 0
  let presentEquivalent = 0
  let expectedDays = 0
  let absenceDays = 0
  let leaveDays = 0
  let holidayDays = 0
  let lateCount = 0
  let lateMinutes = 0
  let earlyLeaveMinutes = 0
  let breakMinutes = 0
  let netMinutes = 0
  let requiredMinutes = 0
  let baseRequired = 0
  let dailyOvertime = 0
  let dailyShortage = 0
  let missingCheckouts = 0
  let completeNet = 0
  let completeRequired = 0

  for (const d of days) {
    const worked = d.status === 'present' || d.status === 'in_progress' || d.status === 'missing_checkout'
    if (d.isWorkingDay) {
      workingDays++
      if (d.status !== 'scheduled') {
        expectedDays += 1 - d.leaveFraction
        if (worked) {
          presentEquivalent += 1 - d.leaveFraction
        }
      }
      if (worked) {
        presentDays++
      }
    }
    if (d.status === 'absent') absenceDays++
    if (d.isHoliday) holidayDays++
    leaveDays += d.leaveFraction
    if (d.lateMinutes > 0) {
      lateCount++
      lateMinutes += d.lateMinutes
    }
    if (d.status === 'missing_checkout') missingCheckouts++
    earlyLeaveMinutes += d.earlyLeaveMinutes
    breakMinutes += d.breakMinutes
    netMinutes += d.netMinutes
    requiredMinutes += d.requiredMinutes
    baseRequired += d.baseRequiredMinutes
    dailyOvertime += d.overtimeMinutes
    dailyShortage += d.shortageMinutes
    if (d.isComplete) {
      completeNet += d.netMinutes
      completeRequired += d.requiredMinutes
    }
  }

  if (opts.weeklyRequiredMinutes != null && baseRequired > 0) {
    const ratio = requiredMinutes / baseRequired
    const scaled = Math.round(opts.weeklyRequiredMinutes * ratio)
    completeRequired = requiredMinutes > 0 ? Math.round(scaled * (completeRequired / requiredMinutes)) : 0
    requiredMinutes = scaled
  }

  let overtimeMinutes = dailyOvertime
  let shortageMinutes = dailyShortage
  if (opts.basis === 'weekly') {
    const surplus = Math.max(0, netMinutes - requiredMinutes)
    overtimeMinutes = opts.overtimeEligible && surplus >= (opts.minOvertimeMinutes ?? 0) ? surplus : 0
    shortageMinutes = Math.max(0, completeRequired - completeNet)
  }

  const attendancePercentage = expectedDays > 0
    ? Math.min(100, Math.round((presentEquivalent / expectedDays) * 10_000) / 100)
    : 100

  return {
    from,
    to,
    days: days.length,
    workingDays,
    presentDays,
    absenceDays,
    leaveDays,
    holidayDays,
    lateCount,
    lateMinutes,
    earlyLeaveMinutes,
    breakMinutes,
    netMinutes,
    requiredMinutes,
    overtimeMinutes,
    shortageMinutes,
    missingCheckouts,
    attendancePercentage,
    basis: opts.basis,
  }
}
