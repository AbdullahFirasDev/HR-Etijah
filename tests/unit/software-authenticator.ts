/**
 * Minimal software WebAuthn authenticator (ES256) producing real, cryptographically valid
 * assertions — so verification tests exercise genuine signature checks, not mocks.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')

function coseFromJwk(jwk: { x?: string, y?: string }): Uint8Array {
  // COSE_Key map {1:2 (EC2), 3:-7 (ES256), -1:1 (P-256), -2:x, -3:y} in canonical CBOR
  const x = Buffer.from(jwk.x!, 'base64url')
  const y = Buffer.from(jwk.y!, 'base64url')
  return new Uint8Array(Buffer.concat([
    Buffer.from([0xA5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x,
    Buffer.from([0x22, 0x58, 0x20]), y,
  ]))
}

export interface SoftAuthenticator {
  credentialId: string
  publicKey: Uint8Array
  counter: number
  privateKey: KeyObject
}

export function createAuthenticator(): SoftAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    credentialId: b64url(randomBytes(32)),
    publicKey: coseFromJwk(publicKey.export({ format: 'jwk' })),
    counter: 0,
    privateKey,
  }
}

export function makeAssertion(a: SoftAuthenticator, opts: {
  challenge: string
  origin: string
  rpId: string
  userVerified?: boolean
  counter?: number
  type?: string
}) {
  const clientData = Buffer.from(JSON.stringify({ type: opts.type ?? 'webauthn.get', challenge: opts.challenge, origin: opts.origin, crossOrigin: false }))
  const rpIdHash = createHash('sha256').update(opts.rpId).digest()
  const flags = 0x01 | (opts.userVerified === false ? 0 : 0x04) // UP | UV
  const counter = Buffer.alloc(4)
  counter.writeUInt32BE(opts.counter ?? ++a.counter)
  const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), counter])
  const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), a.privateKey)
  return {
    id: a.credentialId,
    rawId: a.credentialId,
    type: 'public-key' as const,
    response: {
      clientDataJSON: b64url(clientData),
      authenticatorData: b64url(authData),
      signature: b64url(signature),
      userHandle: undefined,
    },
    authenticatorAttachment: 'platform' as const,
    clientExtensionResults: {},
  }
}
