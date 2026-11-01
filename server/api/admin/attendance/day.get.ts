import { z } from 'zod'

const query = z.object({ employeeId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

/** Everything behind one employee-day: sessions, breaks, immutable events, adjustments, stored result. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'attendance.read' })
  const q = queryValid(event, query)
  const [sessions, events, adjustments, day] = await Promise.all([
    ctx.db.from('attendance_sessions').select('*, breaks ( * )').eq('employee_id', q.employeeId).eq('work_date', q.date).order('check_in_at'),
    ctx.db.from('attendance_events')
      .select('id, session_id, event_type, occurred_at, source, adjustment_id, latitude, longitude, accuracy_m, distance_m, client_ip, risk_score, risk_flags, created_by')
      .eq('employee_id', q.employeeId).eq('work_date', q.date).order('occurred_at'),
    ctx.db.from('attendance_adjustments').select('*').eq('employee_id', q.employeeId).eq('work_date', q.date).order('created_at'),
    ctx.db.from('attendance_days').select('*').eq('employee_id', q.employeeId).eq('work_date', q.date).maybeSingle(),
  ])
  return { sessions: unwrap(sessions), events: unwrap(events), adjustments: unwrap(adjustments), day: day.data ?? null }
})
