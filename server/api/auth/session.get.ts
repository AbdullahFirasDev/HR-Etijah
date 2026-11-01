import { PERMISSIONS } from '#shared/constants'

/** Session status. Passive: polling this endpoint never extends the idle timeout. */
export default defineEventHandler(async (event) => {
  const ctx = await resolveSession(event, { passive: true })
  if (!ctx) {
    return { authenticated: false as const, reason: (event.context.sessionEndReason as string | undefined) ?? null }
  }
  return {
    authenticated: true as const,
    user: {
      id: ctx.userId,
      email: ctx.email,
      fullName: ctx.fullName,
      fullNameEn: ctx.fullNameEn,
      locale: ctx.locale,
      role: ctx.role,
      scope: ctx.scope,
      permissions: ctx.role === 'owner' ? [...PERMISSIONS] : [...ctx.permissions],
      employee: ctx.employee,
      mustChangePassword: ctx.mustChangePassword,
    },
    session: {
      expiresAt: ctx.expiresAt.toISOString(),
      absoluteExpiresAt: ctx.absoluteExpiresAt.toISOString(),
      serverTime: new Date().toISOString(),
    },
  }
})
