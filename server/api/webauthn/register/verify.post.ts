import { verifyRegistrationResponse } from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { registerVerifySchema } from '#shared/schemas'

function platformOf(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/Mac OS X/i.test(ua)) return 'macOS'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Unknown'
}

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  await rateLimit(event, 'webauthn-register', ctx.userId, 10, 600)
  const body = await readValid(event, registerVerifySchema)
  const employee = ctx.employee!

  const expectedChallenge = await consumeChallenge(body.challengeId, ctx.userId, 'registration')
  if (!expectedChallenge) {
    throw apiError(400, 'challenge_expired')
  }

  const { rpID, origins } = rp()
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    })
  }
  catch (e) {
    await audit(event, { actorId: ctx.userId, action: 'device.register_failed', entityType: 'webauthn_credential', metadata: { error: (e as Error).message.slice(0, 200) } })
    throw apiError(400, 'registration_failed')
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    throw apiError(400, 'registration_failed')
  }
  const info = verification.registrationInfo

  const settings = await loadSettings()
  const db = actorDb(event, ctx)
  const ua = userAgent(event)
  const device = unwrap(await db.from('employee_devices').insert({
    employee_id: employee.id,
    label: body.label,
    platform: platformOf(ua),
    user_agent: ua,
    last_seen_at: new Date().toISOString(),
  }).select('id').single())

  const autoApprove = !settings.require_device_approval
  const { data: cred, error } = await db.from('webauthn_credentials').insert({
    employee_id: employee.id,
    user_id: ctx.userId,
    device_id: device.id,
    credential_id: info.credential.id,
    public_key: bytesToBytea(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? body.response.response.transports ?? [],
    aaguid: info.aaguid,
    authenticator_name: authenticatorName(info.aaguid),
    device_type: info.credentialDeviceType,
    backed_up: info.credentialBackedUp,
    status: autoApprove ? 'active' : 'pending',
    approved_at: autoApprove ? new Date().toISOString() : null,
  }).select('id, status').single()
  if (error) {
    await db.from('employee_devices').delete().eq('id', device.id)
    throw error.code === '23505' ? apiError(409, 'credential_exists') : dbError(error)
  }

  await audit(event, { actorId: ctx.userId, action: 'device.registered', entityType: 'webauthn_credential', entityId: cred.id, metadata: { status: cred.status, platform: platformOf(ua), authenticator: authenticatorName(info.aaguid) } })
  if (cred.status === 'pending') {
    await notify(await approverIds(employee.id, 'devices.manage'), {
      type: 'device.pending',
      titleAr: 'جهاز جديد بانتظار الموافقة',
      titleEn: 'New device awaiting approval',
      bodyAr: `${ctx.fullName}: ${body.label}`,
      bodyEn: `${ctx.fullNameEn ?? ctx.fullName}: ${body.label}`,
      data: { url: '/admin/devices' },
    })
  }
  return { ok: true, credentialId: cred.id, status: cred.status }
})
