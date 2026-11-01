export default defineEventHandler(async (event) => {
  const ctx = await resolveSession(event, { passive: true })
  if (ctx) {
    await destroySession(event, ctx, 'logout')
    await audit(event, { actorId: ctx.userId, action: 'auth.logout', entityType: 'auth' })
  }
  return { ok: true }
})
