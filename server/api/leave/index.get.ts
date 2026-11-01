import { z } from 'zod'

const query = z.object({
  status: z.enum(['pending', 'manager_approved', 'approved', 'rejected', 'cancelled', 'open']).optional(),
  employeeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** Leave requests visible to the caller (RLS: own, department, or organisation). */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'leave.read' })
  const q = queryValid(event, query)
  let s = ctx.db.from('leave_requests')
    .select(`id, start_date, end_date, is_half_day, days_count, reason, status, manager_note, review_note, created_at, reviewed_at,
      leave_type:leave_types ( id, code, name_ar, name_en, color ),
      employee:employees!inner ( id, employee_code, department_id, profile:profiles!inner ( full_name, full_name_en ) )`)
    .order('created_at', { ascending: false })
  if (q.status === 'open') s = s.in('status', ['pending', 'manager_approved'])
  else if (q.status) s = s.eq('status', q.status)
  if (q.employeeId) s = s.eq('employee_id', q.employeeId)
  if (q.departmentId) s = s.eq('employee.department_id', q.departmentId)
  if (q.from) s = s.gte('end_date', q.from)
  if (q.to) s = s.lte('start_date', q.to)
  const settings = await loadSettings(ctx.db)
  return { flow: settings.leave_approval_flow, requests: unwrap(await s.limit(500)) }
})
