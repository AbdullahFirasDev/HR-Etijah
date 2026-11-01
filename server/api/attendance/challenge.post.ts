import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { challengeRequestSchema } from '#shared/schemas'

/**
 * Issue a fresh, short-lived, single-use WebAuthn challenge bound to this user, this login
 * session and this specific attendance action. Every check-in/out needs a new ceremony.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  await rateLimit(event, 'attendance-challenge', ctx.userId, 12, 60)
  const { action } = await readValid(event, challengeRequestSchema)

  const { data: creds } = await serviceDb().from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('employee_id', ctx.employee!.id)
    .eq('status', 'active')
  if (!creds?.length) {
    throw apiError(409, 'no_registered_device')
  }

  const options = await generateAuthenticationOptions({
    rpID: rp().rpID,
    allowCredentials: creds.map(c => ({ id: c.credential_id, transports: c.transports })),
    userVerification: 'required',
    timeout: 60_000,
  })
  const challenge = await storeChallenge(event, {
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    purpose: 'attendance',
    action,
    challenge: options.challenge,
  })
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt, options }
})
