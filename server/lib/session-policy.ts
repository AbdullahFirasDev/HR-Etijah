/**
 * Login-session expiry rules. A session ends at whichever comes first:
 *   - absolute lifetime (default 10 min after login) — never extended by anything
 *   - idle timeout (default 10 min since the last user-initiated request)
 * Passive requests (status polling) never count as activity.
 */

export interface SessionTimes {
  createdAt: Date
  lastActivityAt: Date
  absoluteExpiresAt: Date
  idleTimeoutSeconds: number
  revokedAt: Date | null
}

export type SessionState =
  | { valid: true, expiresAt: Date, absoluteExpiresAt: Date, idleExpiresAt: Date }
  | { valid: false, reason: 'revoked' | 'absolute_timeout' | 'idle_timeout' }

export function newSessionTimes(now: Date, absoluteSeconds: number, idleSeconds: number): SessionTimes {
  return {
    createdAt: now,
    lastActivityAt: now,
    absoluteExpiresAt: new Date(now.getTime() + absoluteSeconds * 1000),
    idleTimeoutSeconds: idleSeconds,
    revokedAt: null,
  }
}

export function sessionState(s: SessionTimes, now: Date): SessionState {
  if (s.revokedAt) {
    return { valid: false, reason: 'revoked' }
  }
  if (now.getTime() >= s.absoluteExpiresAt.getTime()) {
    return { valid: false, reason: 'absolute_timeout' }
  }
  const idleExpiresAt = new Date(s.lastActivityAt.getTime() + s.idleTimeoutSeconds * 1000)
  if (now.getTime() >= idleExpiresAt.getTime()) {
    return { valid: false, reason: 'idle_timeout' }
  }
  return {
    valid: true,
    absoluteExpiresAt: s.absoluteExpiresAt,
    idleExpiresAt,
    expiresAt: idleExpiresAt < s.absoluteExpiresAt ? idleExpiresAt : s.absoluteExpiresAt,
  }
}

/** Whether a user-initiated request should persist a new last-activity time (write throttling). */
export function shouldRecordActivity(s: SessionTimes, now: Date, throttleSeconds = 15): boolean {
  return now.getTime() - s.lastActivityAt.getTime() >= throttleSeconds * 1000
}

/** Remaining whole seconds for the cookie Max-Age (never beyond the absolute expiry). */
export function cookieMaxAge(s: SessionTimes, now: Date): number {
  return Math.max(0, Math.floor((s.absoluteExpiresAt.getTime() - now.getTime()) / 1000))
}
