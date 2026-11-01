import { addDays, localDate } from '#shared/engine'

/**
 * Periodic housekeeping (every 30 min via Nitro scheduled task, or /api/cron/daily):
 *  - flag sessions without check-out (missing check-out detection) and notify
 *  - recompute yesterday + today for everyone (absence detection, live summaries)
 *  - revoke expired login sessions, purge expired challenges
 */
export async function closeDays(now = new Date()): Promise<Record<string, unknown>> {
  const db = serviceDb()
  const settings = await loadSettings(db)
  const today = localDate(now, settings.timezone)

  const flagged = unwrap(await db.rpc('flag_missing_checkouts')) as Array<{ session_id: string, employee_id: string, work_date: string }>
  for (const f of flagged ?? []) {
    const { data: emp } = await db.from('employees').select('profile_id').eq('id', f.employee_id).single()
    if (emp) {
      await notify([emp.profile_id], {
        type: 'attendance.missing_checkout',
        titleAr: 'لم يتم تسجيل الانصراف',
        titleEn: 'Missing check-out',
        bodyAr: `يوم ${f.work_date}: يرجى تقديم طلب تصحيح.`,
        bodyEn: `${f.work_date}: please request a correction.`,
        data: { url: '/history' },
      })
    }
    await notify(await approverIds(f.employee_id, 'attendance.adjust'), {
      type: 'attendance.missing_checkout_staff',
      titleAr: 'انصراف مفقود لموظف',
      titleEn: 'Employee missing check-out',
      bodyAr: f.work_date,
      bodyEn: f.work_date,
      data: { url: '/admin/attendance' },
    })
  }

  const recalculated = await recalculate('all', addDays(today, -1), today, now)

  const { count: expired } = await db.from('app_sessions')
    .update({ revoked_at: now.toISOString(), revoke_reason: 'absolute_timeout' }, { count: 'exact' })
    .is('revoked_at', null)
    .lt('absolute_expires_at', now.toISOString())
  const purged = unwrap(await db.rpc('purge_expired_security_data'))

  return { flaggedMissingCheckouts: flagged?.length ?? 0, recalculated, expiredSessions: expired ?? 0, purged }
}
