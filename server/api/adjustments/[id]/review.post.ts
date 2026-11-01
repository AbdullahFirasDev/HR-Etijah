import { reviewSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'attendance.adjust' })
  const id = routeUuid(event)
  const body = await readValid(event, reviewSchema)
  const r = unwrap(await ctx.db.rpc('review_attendance_adjustment', { p_adjustment_id: id, p_approve: body.approve, p_note: body.note ?? null })) as {
    status: string, employee_id: string, work_date: string
  }
  await audit(event, { actorId: ctx.userId, action: `adjustment.${r.status}`, entityType: 'attendance_adjustment', entityId: id, reason: body.note })
  if (r.status === 'approved') {
    recalculateSoon(event, [r.employee_id], r.work_date, r.work_date)
  }
  const { data: emp } = await serviceDb().from('employees').select('profile_id').eq('id', r.employee_id).single()
  await notify([emp!.profile_id], {
    type: `adjustment.${r.status}`,
    titleAr: r.status === 'approved' ? 'تم اعتماد تصحيح الحضور' : 'تم رفض طلب تصحيح الحضور',
    titleEn: r.status === 'approved' ? 'Attendance correction approved' : 'Attendance correction rejected',
    bodyAr: r.work_date,
    bodyEn: r.work_date,
    data: { url: '/history' },
  })
  return r
})
