import { z } from 'zod'
import { addDays, localDate, monthRange, startOfWeek } from '#shared/engine'

const query = z.object({
  period: z.enum(['week', 'month']).default('month'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** Personal weekly / monthly summary. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  const q = queryValid(event, query)
  const settings = await loadSettings(ctx.db)
  const ref = q.date ?? localDate(new Date(), settings.timezone)
  let from: string
  let to: string
  if (q.period === 'week') {
    from = startOfWeek(ref, settings.week_start)
    to = addDays(from, 6)
  }
  else {
    ({ from, to } = monthRange(Number(ref.slice(0, 4)), Number(ref.slice(5, 7))))
  }
  const employees = await reportEmployees(ctx, { employeeId: ctx.employee!.id })
  const { data, rows } = await computeReportDays(employees, from, to)
  const days = rows[0]?.days ?? []
  return {
    period: q.period,
    from,
    to,
    summary: days.length ? summarize(data, ctx.employee!.id, from, days.at(-1)!.date, days) : null,
    days,
  }
})
