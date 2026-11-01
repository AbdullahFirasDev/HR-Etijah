import { describe, expect, it } from 'vitest'
import { verifyAssertion } from '~~/server/lib/assertion'
import { createAuthenticator, makeAssertion } from './software-authenticator'

const rpId = 'localhost'
const origin = 'http://localhost:3000'
const challenge = Buffer.from('server-issued-challenge-0123456789').toString('base64url')

function setup() {
  const a = createAuthenticator()
  const credential = { id: a.credentialId, publicKey: a.publicKey, counter: 0 }
  return { a, credential }
}

describe('WebAuthn assertion verification', () => {
  it('accepts a valid, user-verified assertion and returns the new counter', async () => {
    const { a, credential } = setup()
    const r = await verifyAssertion({ response: makeAssertion(a, { challenge, origin, rpId }), expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(r).toEqual({ ok: true, newCounter: 1 })
  })

  it('rejects an assertion without user verification (no biometric / PIN)', async () => {
    const { a, credential } = setup()
    const r = await verifyAssertion({ response: makeAssertion(a, { challenge, origin, rpId, userVerified: false }), expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(r).toMatchObject({ ok: false, reason: 'biometric_failed' })
  })

  it('rejects an assertion signed for a different challenge (replay of an old ceremony)', async () => {
    const { a, credential } = setup()
    const old = makeAssertion(a, { challenge: Buffer.from('an-older-challenge-value-xyz').toString('base64url'), origin, rpId })
    const r = await verifyAssertion({ response: old, expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(r).toMatchObject({ ok: false, reason: 'biometric_failed' })
  })

  it('rejects a phishing origin and a foreign RP ID', async () => {
    const { a, credential } = setup()
    const phish = await verifyAssertion({ response: makeAssertion(a, { challenge, origin: 'https://evil.example', rpId }), expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(phish.ok).toBe(false)
    const foreign = await verifyAssertion({ response: makeAssertion(a, { challenge, origin, rpId: 'evil.example' }), expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(foreign.ok).toBe(false)
  })

  it('rejects a tampered signature', async () => {
    const { a, credential } = setup()
    const resp = makeAssertion(a, { challenge, origin, rpId })
    const sig = Buffer.from(resp.response.signature, 'base64url')
    sig[sig.length - 1] ^= 0xFF
    resp.response.signature = sig.toString('base64url')
    expect((await verifyAssertion({ response: resp, expectedChallenge: challenge, origins: [origin], rpId, credential })).ok).toBe(false)
  })

  it('rejects an assertion made by a different key for the same credential ID', async () => {
    const { credential } = setup()
    const impostor = createAuthenticator()
    impostor.credentialId = credential.id
    const r = await verifyAssertion({ response: makeAssertion(impostor, { challenge, origin, rpId }), expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(r.ok).toBe(false)
  })

  it('rejects a non-increasing signature counter (cloned authenticator)', async () => {
    const { a, credential } = setup()
    const r = await verifyAssertion({ response: makeAssertion(a, { challenge, origin, rpId, counter: 5 }), expectedChallenge: challenge, origins: [origin], rpId, credential: { ...credential, counter: 5 } })
    expect(r).toMatchObject({ ok: false, reason: 'authenticator_counter_mismatch' })
  })

  it('rejects a registration-type clientData and a mismatched credential id', async () => {
    const { a, credential } = setup()
    const wrongType = await verifyAssertion({ response: makeAssertion(a, { challenge, origin, rpId, type: 'webauthn.create' }), expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(wrongType.ok).toBe(false)
    const other = createAuthenticator()
    const mismatch = await verifyAssertion({ response: makeAssertion(other, { challenge, origin, rpId }), expectedChallenge: challenge, origins: [origin], rpId, credential })
    expect(mismatch).toMatchObject({ ok: false, reason: 'device_not_authorized' })
  })
})
