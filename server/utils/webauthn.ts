/**
 * WebAuthn relying-party configuration and challenge storage.
 *
 * WebAuthn proves possession of a device-bound private key and that the authenticator
 * performed user verification (fingerprint, face, or device PIN/pattern). It does NOT tell
 * the server which method was used, and no biometric data ever leaves the device.
 */
import type { H3Event } from 'h3'

export function rp() {
  const c = serverConfig()
  return { rpID: c.webauthnRpId, rpName: c.webauthnRpName, origins: c.webauthnOrigins }
}

export async function storeChallenge(
  event: H3Event,
  input: { userId: string, sessionId: string, purpose: 'registration' | 'attendance', action?: string | null, challenge: string },
): Promise<{ id: string, expiresAt: string }> {
  const ttl = serverConfig().webauthnChallengeTtlSeconds
  const now = Date.now()
  const row = unwrap(await serviceDb().from('webauthn_challenges').insert({
    user_id: input.userId,
    app_session_id: input.sessionId,
    purpose: input.purpose,
    action: input.action ?? null,
    challenge: input.challenge,
    client_ip: clientIp(event),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl * 1000).toISOString(),
  }).select('id, expires_at').single())
  return { id: row.id, expiresAt: row.expires_at }
}

/** Atomically consume a challenge (single use). Returns null if missing/expired/used/mismatched. */
export async function consumeChallenge(id: string, userId: string, purpose: 'registration' | 'attendance', action: string | null = null): Promise<string | null> {
  const { data, error } = await serviceDb().rpc('consume_webauthn_challenge', {
    p_challenge_id: id,
    p_user_id: userId,
    p_purpose: purpose,
    p_action: action,
  })
  if (error) {
    throw dbError(error)
  }
  return (data as string | null) ?? null
}

/** Friendly names for common platform authenticators (AAGUID → name). */
const AAGUID_NAMES: Record<string, string> = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain (Managed)',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
  'b5397666-4885-aa6b-cebf-e52262a439a9': 'Samsung Pass',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
}

export function authenticatorName(aaguid: string | null | undefined): string | null {
  if (!aaguid || aaguid === '00000000-0000-0000-0000-000000000000') {
    return null
  }
  return AAGUID_NAMES[aaguid.toLowerCase()] ?? null
}
