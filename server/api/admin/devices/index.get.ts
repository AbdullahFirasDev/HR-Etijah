import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'devices.manage' })
  const { status } = queryValid(event, z.object({ status: z.enum(['pending', 'active', 'revoked']).optional() }))
  let q = ctx.db.from('webauthn_credentials')
    .select(`id, status, authenticator_name, device_type, backed_up, created_at, approved_at, last_used_at, revoked_at, revoke_reason,
      device:employee_devices ( label, platform, user_agent ),
      employee:employees!inner ( id, employee_code, profile:profiles!inner ( full_name, full_name_en ) )`)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  return unwrap(await q.limit(500))
})
