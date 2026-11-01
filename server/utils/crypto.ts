import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

let key: Buffer | null = null

function encryptionKey(): Buffer {
  key ??= Buffer.from(hkdfSync('sha256', serverConfig().sessionSecret, 'etijah-hr', 'app-session-token-encryption', 32))
  return key
}

/** AES-256-GCM; output "v1.<base64url(iv | tag | ciphertext)>" */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')}`
}

export function decryptSecret(value: string): string {
  if (!value.startsWith('v1.')) {
    throw new Error('Unsupported ciphertext version')
  }
  const raw = Buffer.from(value.slice(3), 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
