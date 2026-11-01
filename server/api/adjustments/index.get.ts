import { z } from 'zod'

const query = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  employeeId: z.uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const q = queryValid(event, query)
  let s = ctx.db.from('attendance_adjustments')
    .select(`id, work_date, adjustment_type, target_session_id, target_break_id, new_start_at, new_end_at, reason, status,
      requested_by, reviewed_by, reviewed_at, review_note, applied_at, created_at,
      employee:employees!inner ( id, employee_code, profile:profiles!inner ( full_name, full_name_en ) )`)
    .order('created_at', { ascending: false })
  if (q.status) s = s.eq('status', q.status)
  if (q.employeeId) s = s.eq('employee_id', q.employeeId)
  return unwrap(await s.limit(300))
})
