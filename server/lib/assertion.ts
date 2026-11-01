/**
 * WebAuthn assertion verification for attendance actions.
 * Requires: valid signature by the registered public key, the exact server challenge,
 * an allowed origin, our RP ID, the User Verified flag (biometric / device PIN), and a
 * strictly increasing signature counter whenever the authenticator implements one.
 */
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server'

export interface StoredCredential {
  id: string // base64url credential ID
  publicKey: Uint8Array
  counter: number
  transports?: string[]
}

export type AssertionResult =
  | { ok: true, newCounter: number }
  | { ok: false, reason: 'device_not_authorized' | 'biometric_failed' | 'authenticator_counter_mismatch', detail?: string }

export async function verifyAssertion(opts: {
  response: AuthenticationResponseJSON
  expectedChallenge: string
  origins: string[]
  rpId: string
  credential: StoredCredential
}): Promise<AssertionResult> {
  if (opts.response.id !== opts.credential.id || opts.response.rawId !== opts.credential.id) {
    return { ok: false, reason: 'device_not_authorized' }
  }
  try {
    const v = await verifyAuthenticationResponse({
      response: opts.response,
      expectedChallenge: opts.expectedChallenge,
      expectedOrigin: opts.origins,
      expectedRPID: opts.rpId,
      credential: {
        id: opts.credential.id,
        publicKey: new Uint8Array(opts.credential.publicKey),
        counter: opts.credential.counter,
        transports: opts.credential.transports as never,
      },
      requireUserVerification: true,
    })
    if (!v.verified || !v.authenticationInfo.userVerified) {
      return { ok: false, reason: 'biometric_failed' }
    }
    return { ok: true, newCounter: v.authenticationInfo.newCounter }
  }
  catch (e) {
    const detail = (e as Error).message ?? ''
    if (/counter/i.test(detail)) {
      return { ok: false, reason: 'authenticator_counter_mismatch', detail }
    }
    return { ok: false, reason: 'biometric_failed', detail }
  }
}
