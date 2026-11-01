import { timingSafeEqual } from 'node:crypto'

/** `Authorization: Bearer <secret>` check for scheduler calls (constant-time; 24+ char secret). */
export function cronAuthorized(authorization: string | undefined, secret: string): boolean {
  if (!secret || secret.length < 24) {
    return false
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')
  const given = Buffer.from(match?.[1] ?? '')
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
