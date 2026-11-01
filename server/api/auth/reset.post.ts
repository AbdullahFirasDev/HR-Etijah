import { resetPasswordSchema } from '#shared/schemas'

/** Completes a recovery link: {{ .SiteURL }}/auth/reset?token_hash={{ .TokenHash }}&type=recovery */
export default defineEventHandler(async (event) => {
  await rateLimit(event, 'reset-ip', clientIp(event) ?? 'unknown', 10, 900)
  const body = await readValid(event, resetPasswordSchema)
  const { data, error } = await authDb().auth.verifyOtp({ token_hash: body.tokenHash, type: 'recovery' })
  if (error || !data.user || !data.session) {
    throw apiError(400, 'invalid_or_expired_link')
  }
  const userId = data.user.id
  await serviceDb().auth.admin.signOut(data.session.access_token, 'local').catch(() => {})
  const upd = await serviceDb().auth.admin.updateUserById(userId, { password: body.password })
  if (upd.error) {
    throw apiError(422, upd.error.code === 'weak_password' ? 'weak_password' : 'password_update_failed')
  }
  await serviceDb().from('profiles').update({ must_change_password: false }).eq('id', userId)
  await revokeUserSessions(userId, 'password_change')
  await audit(event, { actorId: userId, action: 'auth.password_reset', entityType: 'auth', entityId: userId })
  return { ok: true }
})
