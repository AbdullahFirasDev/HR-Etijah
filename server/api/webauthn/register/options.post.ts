import { generateRegistrationOptions } from '@simplewebauthn/server'
import { registerOptionsSchema } from '#shared/schemas'

/** Start registering this device's platform authenticator (Face ID / Touch ID / Android / Windows Hello). */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  await rateLimit(event, 'webauthn-register', ctx.userId, 10, 600)
  await readValid(event, registerOptionsSchema)
  const employee = ctx.employee!
  const settings = await loadSettings()

  const { data: creds } = await serviceDb().from('webauthn_credentials')
    .select('credential_id, transports, status')
    .eq('employee_id', employee.id)
    .neq('status', 'revoked')
  if ((creds ?? []).length >= settings.max_devices_per_employee) {
    throw apiError(409, 'device_limit_reached')
  }

  const { rpID, rpName } = rp()
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: ctx.email,
    userDisplayName: ctx.fullName,
    // Opaque, non-PII user handle: the employee UUID bytes.
    userID: new Uint8Array(Buffer.from(employee.id.replaceAll('-', ''), 'hex')),
    attestationType: 'none',
    excludeCredentials: (creds ?? []).map(c => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
    supportedAlgorithmIDs: [-7, -257], // ES256, RS256
    timeout: 60_000,
  })

  const challenge = await storeChallenge(event, { userId: ctx.userId, sessionId: ctx.sessionId, purpose: 'registration', challenge: options.challenge })
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt, options }
})
