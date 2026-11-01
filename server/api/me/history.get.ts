import { z } from 'zod'
import { addDays, localDate } from '#shared/engine'

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** Personal attendance history with each day's intervals and breaks. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  const q = queryValid(event, query)
  const settings = await loadSettings(ctx.db)
  const today = localDate(new Date(), settings.timezone)
  const to = q.to ?? today
  const from = q.from ?? addDays(to, -30)
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) {
    throw apiError(422, 'range_too_large')
  }
  const emp = ctx.employee!
  const [{ rows }, sessions, adjustments] = await Promise.all([
    computeReportDays(await reportEmployees(ctx, { employeeId: emp.id }), from, to),
    ctx.db.from('attendance_sessions')
      .select('id, work_date, check_in_at, check_out_at, status, closed_by, breaks ( id, started_at, ended_at, status )')
      .eq('employee_id', emp.id).gte('work_date', from).lte('work_date', to).order('check_in_at'),
    ctx.db.from('attendance_adjustments')
      .select('id, work_date, adjustment_type, status, reason, review_note, new_start_at, new_end_at, created_at')
      .eq('employee_id', emp.id).gte('work_date', from).lte('work_date', to).order('created_at', { ascending: false }),
  ])
  return {
    from,
    to,
    days: (rows[0]?.days ?? []).reverse(),
    sessions: sessions.data ?? [],
    adjustments: adjustments.data ?? [],
  }
})
