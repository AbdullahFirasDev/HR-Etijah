import { changePasswordSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { allowPasswordChange: true })
  await rateLimit(event, 'change-password', ctx.userId, 5, 900)
  const body = await readValid(event, changePasswordSchema)

  const check = await authDb().auth.signInWithPassword({ email: ctx.email, password: body.currentPassword })
  if (check.error || !check.data.session) {
    throw apiError(400, 'invalid_current_password')
  }
  await serviceDb().auth.admin.signOut(check.data.session.access_token, 'local').catch(() => {})

  const { error } = await serviceDb().auth.admin.updateUserById(ctx.userId, { password: body.newPassword })
  if (error) {
    throw apiError(422, error.code === 'weak_password' ? 'weak_password' : 'password_update_failed')
  }
  await serviceDb().from('profiles').update({ must_change_password: false }).eq('id', ctx.userId)
  await revokeUserSessions(ctx.userId, 'password_change', ctx.sessionId)
  await audit(event, { actorId: ctx.userId, action: 'auth.password_changed', entityType: 'auth', entityId: ctx.userId })
  return { ok: true }
})
