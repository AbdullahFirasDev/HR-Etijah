import { pushSubscriptionSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  if (!serverConfig().vapidPublicKey) {
    throw apiError(501, 'push_not_configured')
  }
  const sub = await readValid(event, pushSubscriptionSchema)
  unwrap(await serviceDb().from('push_subscriptions').upsert({
    user_id: ctx.userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: userAgent(event),
  }, { onConflict: 'endpoint' }))
  return { ok: true }
})
