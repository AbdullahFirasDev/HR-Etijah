import { localDate } from '#shared/engine'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  const settings = await loadSettings(ctx.db)
  const year = Number(getQuery(event).year) || Number(localDate(new Date(), settings.timezone).slice(0, 4))
  const [requests, balances, types] = await Promise.all([
    ctx.db.from('leave_requests')
      .select('id, start_date, end_date, is_half_day, days_count, reason, status, review_note, manager_note, created_at, reviewed_at, leave_type:leave_types ( id, code, name_ar, name_en, color )')
      .eq('employee_id', ctx.employee!.id)
      .order('start_date', { ascending: false })
      .limit(100),
    ctx.db.rpc('leave_balances_for', { p_employee_id: ctx.employee!.id, p_year: year }),
    ctx.db.from('leave_types').select('id, code, name_ar, name_en, is_paid, allow_half_day, tracks_balance, color').eq('is_active', true).order('code'),
  ])
  return {
    year,
    requests: unwrap(requests),
    balances: unwrap(balances),
    types: unwrap(types),
  }
})
