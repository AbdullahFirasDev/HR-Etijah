/**
 * In-app notifications (+ Web Push where the browser supports it and VAPID keys are set).
 */
import webpush from 'web-push'

export interface NotificationInput {
  type: string
  titleAr: string
  titleEn: string
  bodyAr?: string
  bodyEn?: string
  data?: Record<string, unknown>
}

let vapidReady: boolean | null = null

function pushEnabled(): boolean {
  if (vapidReady === null) {
    const c = serverConfig()
    vapidReady = !!(c.vapidPublicKey && c.vapidPrivateKey)
    if (vapidReady) {
      webpush.setVapidDetails(c.vapidSubject, c.vapidPublicKey, c.vapidPrivateKey)
    }
  }
  return vapidReady
}

export async function notify(userIds: string[], n: NotificationInput): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (!ids.length) {
    return
  }
  const db = serviceDb()
  const { error } = await db.from('notifications').insert(ids.map(user_id => ({
    user_id,
    type: n.type,
    title_ar: n.titleAr,
    title_en: n.titleEn,
    body_ar: n.bodyAr ?? null,
    body_en: n.bodyEn ?? null,
    data: n.data ?? {},
  })))
  if (error) {
    console.error('[notify]', error.message)
  }
  if (!pushEnabled()) {
    return
  }
  const { data: subs } = await db.from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, profile:profiles ( locale )')
    .in('user_id', ids)
  await Promise.all((subs ?? []).map(async (s: any) => {
    const locale = (Array.isArray(s.profile) ? s.profile[0] : s.profile)?.locale ?? 'ar'
    // Payload deliberately minimal: details are fetched in-app after authentication.
    const payload = JSON.stringify({
      title: locale === 'en' ? n.titleEn : n.titleAr,
      body: (locale === 'en' ? n.bodyEn : n.bodyAr) ?? '',
      tag: n.type,
      url: typeof n.data?.url === 'string' ? n.data.url : '/notifications',
    })
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
    }
    catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
  }))
}

/** User ids of people who can act on an employee (HR + owners, plus the department's managers). */
export async function approverIds(employeeId: string, permission: string): Promise<string[]> {
  const db = serviceDb()
  const { data: emp } = await db.from('employees').select('department_id, profile_id').eq('id', employeeId).maybeSingle()
  const { data: people } = await db.from('profiles').select('id, role:roles!inner ( key, scope, permissions )').eq('is_active', true)
  const roleOf = new Map((people ?? []).map((p: any) => [p.id as string, Array.isArray(p.role) ? p.role[0] : p.role]))
  const can = (r: any) => r && (r.key === 'owner' || r.permissions.includes(permission))
  const ids = [...roleOf].filter(([, r]) => r.scope === 'organization' && can(r)).map(([id]) => id)
  if (emp?.department_id) {
    const { data: mgrs } = await db.from('department_managers').select('user_id').eq('department_id', emp.department_id)
    ids.push(...(mgrs ?? []).map(m => m.user_id).filter(id => can(roleOf.get(id))))
  }
  return [...new Set(ids)].filter(id => id !== emp?.profile_id)
}
