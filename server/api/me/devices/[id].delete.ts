export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  const id = routeUuid(event)
  const r = unwrap(await ctx.db.rpc('set_credential_status', { p_credential_id: id, p_status: 'revoked', p_reason: 'Revoked by employee' }))
  await audit(event, { actorId: ctx.userId, action: 'device.revoked', entityType: 'webauthn_credential', entityId: id, reason: 'self' })
  return r
})
