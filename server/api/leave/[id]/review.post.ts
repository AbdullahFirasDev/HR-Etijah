import { reviewSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'leave.approve' })
  const id = routeUuid(event)
  const body = await readValid(event, reviewSchema)
  const r = unwrap(await ctx.db.rpc('review_leave_request', { p_request_id: id, p_approve: body.approve, p_note: body.note ?? null })) as {
    status: string, employee_id: string, start_date: string, end_date: string
  }
  await audit(event, { actorId: ctx.userId, action: `leave.${r.status}`, entityType: 'leave_request', entityId: id, reason: body.note })
  if (r.status === 'approved') {
    recalculateSoon(event, [r.employee_id], r.start_date, r.end_date)
  }

  const { data: emp } = await serviceDb().from('employees').select('profile_id').eq('id', r.employee_id).single()
  const labels: Record<string, [string, string]> = {
    approved: ['تمت الموافقة على طلب الإجازة', 'Your leave request was approved'],
    rejected: ['تم رفض طلب الإجازة', 'Your leave request was rejected'],
    manager_approved: ['وافق المدير على طلب الإجازة — بانتظار الموارد البشرية', 'Manager approved your leave — awaiting HR'],
  }
  const [ar, en] = labels[r.status] ?? ['تحديث على طلب الإجازة', 'Leave request updated']
  await notify([emp!.profile_id], { type: `leave.${r.status}`, titleAr: ar, titleEn: en, bodyAr: `${r.start_date} → ${r.end_date}`, bodyEn: `${r.start_date} → ${r.end_date}`, data: { url: '/leave' } })
  if (r.status === 'manager_approved') {
    await notify(await approverIds(r.employee_id, 'leave.approve'), { type: 'leave.awaiting_hr', titleAr: 'طلب إجازة بانتظار اعتماد الموارد البشرية', titleEn: 'Leave request awaiting HR approval', data: { url: '/admin/leave' } })
  }
  return r
})
