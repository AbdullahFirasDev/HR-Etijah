import { loginSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ip = clientIp(event) ?? 'unknown'
  await rateLimit(event, 'login-ip', ip, 30, 900)
  const body = await readValid(event, loginSchema)
  await rateLimit(event, 'login-email', body.email, 8, 900)

  const { data, error } = await authDb().auth.signInWithPassword({ email: body.email, password: body.password })
  if (error && (error.name === 'AuthRetryableFetchError' || !error.status || error.status >= 500)) {
    console.error('[auth] Supabase Auth unavailable:', error.message)
    throw apiError(503, 'auth_unavailable')
  }
  if (error || !data.session || !data.user) {
    await audit(event, { action: 'auth.login_failed', entityType: 'auth', metadata: { email: body.email } })
    throw apiError(401, 'invalid_credentials')
  }

  const { data: profile } = await serviceDb().from('profiles')
    .select('id, is_active, must_change_password, locale')
    .eq('id', data.user.id)
    .maybeSingle()
  if (!profile || !profile.is_active) {
    await serviceDb().auth.admin.signOut(data.session.access_token, 'local').catch(() => {})
    await audit(event, { actorId: data.user.id, action: 'auth.login_denied', entityType: 'auth' })
    throw apiError(403, 'account_disabled')
  }

  // Never reuse a pre-existing session cookie (session fixation).
  const previous = await resolveSession(event, { passive: true })
  if (previous) {
    await destroySession(event, previous, 'logout')
  }

  const { expiresAt } = await createSession(event, data.user.id, data.session.access_token)
  await serviceDb().from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.user.id)
  await audit(event, { actorId: data.user.id, action: 'auth.login', entityType: 'auth' })
  return { ok: true, expiresAt, mustChangePassword: profile.must_change_password, locale: profile.locale }
})
