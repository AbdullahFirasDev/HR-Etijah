import type { z } from 'zod'
import type { scheduleSchema } from '#shared/schemas'

export function scheduleRow(b: z.output<typeof scheduleSchema>) {
  return {
    employee_id: b.employeeId,
    shift_id: b.shiftId ?? null,
    effective_from: b.effectiveFrom,
    effective_to: b.effectiveTo ?? null,
    required_minutes: b.requiredMinutes ?? null,
    working_days: b.workingDays ?? null,
    start_time: b.startTime ?? null,
    end_time: b.endTime ?? null,
    grace_minutes: b.graceMinutes ?? null,
    early_leave_grace_minutes: b.earlyLeaveGraceMinutes ?? null,
    break_minutes: b.breakMinutes ?? null,
    paid_break_minutes: b.paidBreakMinutes ?? null,
    weekly_required_minutes: b.weeklyRequiredMinutes ?? null,
    is_flexible: b.isFlexible ?? null,
    flex_earliest_start: b.flexEarliestStart ?? null,
    flex_latest_end: b.flexLatestEnd ?? null,
    overtime_eligible: b.overtimeEligible ?? null,
    count_before_shift: b.countBeforeShift ?? null,
    count_after_shift: b.countAfterShift ?? null,
    notes: b.notes ?? null,
  }
}
