import { adjustmentRequestSchema } from '#shared/schemas'

/**
 * Request an attendance correction (reason mandatory). Authorisation is enforced inside
 * request_attendance_adjustment(). Users holding attendance.adjust have it applied at once,
 * except for their own attendance (no self-approval).
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  await rateLimit(event, 'adjustment', ctx.userId, 30, 3600)
  const b = await readValid(event, adjustmentRequestSchema)
  const id = unwrap(await ctx.db.rpc('request_attendance_adjustment', {
    p_employee_id: b.employeeId,
    p_work_date: b.workDate,
    p_type: b.type,
    p_target_session_id: b.targetSessionId ?? null,
    p_target_break_id: b.targetBreakId ?? null,
    p_new_start_at: b.newStartAt ?? null,
    p_new_end_at: b.newEndAt ?? null,
    p_reason: b.reason,
  })) as string
  await audit(event, { actorId: ctx.userId, action: 'adjustment.requested', entityType: 'attendance_adjustment', entityId: id, reason: b.reason, metadata: { type: b.type, workDate: b.workDate } })

  const selfAdjust = b.employeeId === ctx.employee?.id && ctx.role !== 'owner'
  if (hasPermission(ctx, 'attendance.adjust') && !selfAdjust) {
    const r = unwrap(await ctx.db.rpc('review_attendance_adjustment', { p_adjustment_id: id, p_approve: true, p_note: 'Applied by requester with attendance.adjust' })) as { work_date: string }
    await audit(event, { actorId: ctx.userId, action: 'adjustment.approved', entityType: 'attendance_adjustment', entityId: id, reason: b.reason })
    recalculateSoon(event, [b.employeeId], r.work_date, r.work_date)
    return { id, status: 'approved' }
  }
  await notify(await approverIds(b.employeeId, 'attendance.adjust'), {
    type: 'adjustment.requested',
    titleAr: 'طلب تصحيح حضور بانتظار المراجعة',
    titleEn: 'Attendance correction awaiting review',
    bodyAr: b.workDate,
    bodyEn: b.workDate,
    data: { url: '/admin/attendance?tab=adjustments' },
  })
  return { id, status: 'pending' }
})
