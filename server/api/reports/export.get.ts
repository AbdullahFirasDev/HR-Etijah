import { z } from 'zod'
import { reportQuerySchema } from '#shared/schemas'

const exportQuery = z.object({
  type: z.enum(['daily', 'weekly', 'monthly']),
  format: z.enum(['xlsx', 'pdf']),
  lang: z.enum(['ar', 'en']).default('ar'),
})

/**
 * Excel / PDF export. Users without reports.export can export only their own data.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  await rateLimit(event, 'export', ctx.userId, 10, 60)
  const opts = queryValid(event, exportQuery)
  const q = queryValid(event, reportQuerySchema)
  if (!hasPermission(ctx, 'reports.export')) {
    if (!ctx.employee) {
      throw apiError(403, 'forbidden')
    }
    q.employeeId = ctx.employee.id
    q.departmentId = undefined
  }
  const report = await buildReport(ctx, opts.type, q)
  const settings = await loadSettings(ctx.db)
  const meta = {
    orgName: opts.lang === 'ar' ? settings.org_name_ar : settings.org_name_en,
    generatedBy: opts.lang === 'en' ? (ctx.fullNameEn ?? ctx.fullName) : ctx.fullName,
    timezone: settings.timezone,
  }
  const file = `attendance-${opts.type}-${q.from}_${q.to}.${opts.format}`
  await audit(event, { actorId: ctx.userId, action: 'report.exported', entityType: 'report', metadata: { ...opts, ...q, rows: report.items.length } })

  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${file}"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (opts.format === 'xlsx') {
    setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return reportToXlsx(report, opts.type, opts.lang, meta)
  }
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  return reportToPdf(report, opts.type, opts.lang, meta)
})
