import { forgotPasswordSchema } from '#shared/schemas'

/** Always answers 200 so the endpoint cannot be used to discover accounts. */
export default defineEventHandler(async (event) => {
  await rateLimit(event, 'forgot-ip', clientIp(event) ?? 'unknown', 5, 900)
  const { email } = await readValid(event, forgotPasswordSchema)
  await rateLimit(event, 'forgot-email', email.toLowerCase(), 3, 3600)
  const origin = serverConfig().webauthnOrigins[0]
  const { error } = await authDb().auth.resetPasswordForEmail(email.toLowerCase(), { redirectTo: `${origin}/auth/reset` })
  if (error) {
    console.warn('[auth] reset email failed:', error.message)
  }
  await audit(event, { action: 'auth.password_reset_requested', entityType: 'auth', metadata: { email: email.toLowerCase() } })
  return { ok: true }
})
