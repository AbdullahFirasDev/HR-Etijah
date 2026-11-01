/**
 * Server-side login sessions.
 *
 * The browser only ever holds an opaque random token in an HttpOnly, SameSite=Strict
 * (and Secure in production) cookie. The database stores its SHA-256 hash plus the user's
 * Supabase access token encrypted with AES-256-GCM. Every request re-checks the absolute
 * and idle limits (server/lib/session-policy.ts); an expired session is revoked
 * server-side and its Supabase token signed out. Sessions are never extended beyond the
 * absolute limit, and passive requests do not count as activity.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import type { Permission, RoleKey, RoleScope } from '#shared/constants'
import { cookieMaxAge, newSessionTimes, sessionState, shouldRecordActivity, type SessionTimes } from '../lib/session-policy'

export interface EmployeeRef {
  id: string
  departmentId: string | null
  officeId: string | null
  employeeCode: string
  status: 'active' | 'suspended' | 'terminated'
}

export interface AuthContext {
  sessionId: string
  userId: string
  email: string
  fullName: string
  fullNameEn: string | null
  locale: 'ar' | 'en'
  role: RoleKey
  scope: RoleScope
  permissions: Set<string>
  employee: EmployeeRef | null
  mustChangePassword: boolean
  expiresAt: Date
  absoluteExpiresAt: Date
  accessToken: string
  /** RLS-scoped database client acting as this user. */
  db: SupabaseClient
}

type RevokeReason = 'logout' | 'absolute_timeout' | 'idle_timeout' | 'admin' | 'password_change' | 'account_disabled'

export function sessionCookieName(): string {
  // __Host- prefix: Secure, Path=/, no Domain — cannot be set or shadowed by subdomains.
  return serverConfig().cookieSecure ? '__Host-hr_session' : 'hr_session'
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: serverConfig().cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  }
}

export async function createSession(event: H3Event, userId: string, accessToken: string): Promise<{ expiresAt: Date }> {
  const c = serverConfig()
  const token = randomToken(32)
  const times = newSessionTimes(new Date(), c.sessionAbsoluteSeconds, c.sessionIdleSeconds)
  const { error } = await serviceDb().from('app_sessions').insert({
    user_id: userId,
    token_hash: sha256Hex(token),
    access_token_enc: encryptSecret(accessToken),
    created_at: times.createdAt.toISOString(),
    last_activity_at: times.lastActivityAt.toISOString(),
    absolute_expires_at: times.absoluteExpiresAt.toISOString(),
    idle_timeout_seconds: times.idleTimeoutSeconds,
    ip: clientIp(event),
    user_agent: userAgent(event),
  })
  if (error) {
    throw dbError(error, 'session_create_failed')
  }
  setCookie(event, sessionCookieName(), token, cookieOptions(c.sessionAbsoluteSeconds))
  return { expiresAt: times.absoluteExpiresAt }
}

async function revokeRow(sessionId: string, reason: RevokeReason, accessTokenEnc?: string | null): Promise<void> {
  await serviceDb().from('app_sessions')
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq('id', sessionId)
    .is('revoked_at', null)
  if (accessTokenEnc) {
    try {
      // Revoke the Supabase refresh token tied to this access token.
      await serviceDb().auth.admin.signOut(decryptSecret(accessTokenEnc), 'local')
    }
    catch {
      // token may already be expired/invalid — nothing more to revoke
    }
  }
}

/** Revoke every active session of a user (password change, deactivation, admin action). */
export async function revokeUserSessions(userId: string, reason: RevokeReason, exceptSessionId?: string): Promise<void> {
  let q = serviceDb().from('app_sessions').select('id, access_token_enc').eq('user_id', userId).is('revoked_at', null)
  if (exceptSessionId) {
    q = q.neq('id', exceptSessionId)
  }
  const { data } = await q
  await Promise.all((data ?? []).map(s => revokeRow(s.id, reason, s.access_token_enc)))
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/**
 * Resolve the session for this request (memoised on the event). Returns null when there is
 * no valid session; sets event.context.sessionEndReason when one just expired.
 */
export async function resolveSession(event: H3Event, opts: { passive?: boolean } = {}): Promise<AuthContext | null> {
  if (event.context.auth !== undefined) {
    return event.context.auth as AuthContext | null
  }
  event.context.auth = null
  const token = getCookie(event, sessionCookieName())
  if (!token || token.length > 100) {
    return null
  }

  const { data: row, error } = await serviceDb()
    .from('app_sessions')
    .select(`id, user_id, created_at, last_activity_at, absolute_expires_at, idle_timeout_seconds, revoked_at, access_token_enc,
      profile:profiles!inner ( id, email, full_name, full_name_en, locale, is_active, must_change_password,
        role:roles!inner ( key, scope, permissions ),
        employee:employees ( id, department_id, office_id, employee_code, status ) )`)
    .eq('token_hash', sha256Hex(token))
    .maybeSingle()
  if (error) {
    throw dbError(error, 'session_lookup_failed')
  }
  if (!row) {
    deleteCookie(event, sessionCookieName(), cookieOptions(0))
    return null
  }

  const times: SessionTimes = {
    createdAt: new Date(row.created_at),
    lastActivityAt: new Date(row.last_activity_at),
    absoluteExpiresAt: new Date(row.absolute_expires_at),
    idleTimeoutSeconds: row.idle_timeout_seconds,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  }
  const now = new Date()
  const state = sessionState(times, now)
  const profile = one(row.profile as any)

  if (!state.valid || !profile?.is_active) {
    const reason: RevokeReason = !state.valid
      ? (state.reason === 'revoked' ? 'logout' : state.reason)
      : 'account_disabled'
    if (!times.revokedAt) {
      await revokeRow(row.id, reason, row.access_token_enc)
      await audit(event, { actorId: row.user_id, action: `session.${reason}`, entityType: 'app_session', entityId: row.id })
    }
    deleteCookie(event, sessionCookieName(), cookieOptions(0))
    event.context.sessionEndReason = state.valid ? 'account_disabled' : state.reason
    return null
  }

  let expiresAt = state.expiresAt
  if (!opts.passive && shouldRecordActivity(times, now)) {
    await serviceDb().from('app_sessions').update({ last_activity_at: now.toISOString() }).eq('id', row.id)
    const idleExpires = new Date(now.getTime() + times.idleTimeoutSeconds * 1000)
    expiresAt = idleExpires < times.absoluteExpiresAt ? idleExpires : times.absoluteExpiresAt
  }
  // Cookie lifetime always tracks the (fixed) absolute expiry — never extended.
  setCookie(event, sessionCookieName(), token, cookieOptions(cookieMaxAge(times, now)))

  const role = one(profile.role as any)
  const emp = one(profile.employee as any)
  let accessToken: string
  try {
    accessToken = decryptSecret(row.access_token_enc)
  }
  catch {
    await revokeRow(row.id, 'admin')
    deleteCookie(event, sessionCookieName(), cookieOptions(0))
    return null
  }

  const ctx: AuthContext = {
    sessionId: row.id,
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    fullNameEn: profile.full_name_en,
    locale: profile.locale,
    role: role.key,
    scope: role.scope,
    permissions: new Set<string>(role.permissions ?? []),
    employee: emp
      ? { id: emp.id, departmentId: emp.department_id, officeId: emp.office_id, employeeCode: emp.employee_code, status: emp.status }
      : null,
    mustChangePassword: profile.must_change_password,
    expiresAt,
    absoluteExpiresAt: times.absoluteExpiresAt,
    accessToken,
    db: userDb(accessToken),
  }
  event.context.auth = ctx
  return ctx
}

export function hasPermission(ctx: AuthContext, permission: Permission): boolean {
  return ctx.role === 'owner' || ctx.permissions.has(permission)
}

export interface RequireOptions {
  permission?: Permission | Permission[]
  passive?: boolean
  employee?: boolean
  allowPasswordChange?: boolean
}

/** Authenticate + authorise a request. `permission` arrays mean "any of". */
export async function requireAuth(event: H3Event, opts: RequireOptions = {}): Promise<AuthContext> {
  const ctx = await resolveSession(event, { passive: opts.passive })
  if (!ctx) {
    throw apiError(401, event.context.sessionEndReason ? 'session_expired' : 'unauthenticated', {
      reason: event.context.sessionEndReason ?? null,
    })
  }
  setResponseHeader(event, 'x-session-expires', ctx.expiresAt.toISOString())
  if (ctx.mustChangePassword && !opts.allowPasswordChange) {
    throw apiError(403, 'password_change_required')
  }
  if (opts.permission) {
    const perms = Array.isArray(opts.permission) ? opts.permission : [opts.permission]
    if (!perms.some(p => hasPermission(ctx, p))) {
      throw apiError(403, 'forbidden')
    }
  }
  if (opts.employee) {
    if (!ctx.employee) {
      throw apiError(403, 'not_an_employee')
    }
    if (ctx.employee.status !== 'active') {
      throw apiError(403, 'employee_inactive')
    }
  }
  return ctx
}

export async function destroySession(event: H3Event, ctx: AuthContext, reason: RevokeReason): Promise<void> {
  const { data } = await serviceDb().from('app_sessions').select('access_token_enc').eq('id', ctx.sessionId).maybeSingle()
  await revokeRow(ctx.sessionId, reason, data?.access_token_enc)
  deleteCookie(event, sessionCookieName(), cookieOptions(0))
  event.context.auth = null
}

/** Service client that attributes audit-trigger rows to this user. */
export function actorDb(event: H3Event, ctx: AuthContext): SupabaseClient {
  return serviceDb({ userId: ctx.userId, ip: clientIp(event) })
}
