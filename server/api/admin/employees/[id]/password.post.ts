import { resetEmployeePasswordSchema } from '#shared/schemas'

/** Admin password reset: sets a temporary password, forces a change at next login, ends sessions. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'employees.manage' })
  const userId = routeUuid(event)
  const { password } = await readValid(event, resetEmployeePasswordSchema)
  const { data: target } = await ctx.db.from('profiles').select('id, role:roles ( key )').eq('id', userId).maybeSingle()
  if (!target) {
    throw apiError(404, 'not_found')
  }
  const role = (Array.isArray(target.role) ? target.role[0] : target.role)?.key
  if ((role === 'owner' || role === 'hr_manager') && ctx.role !== 'owner') {
    throw apiError(403, 'only_owner_can_edit_privileged_user')
  }
  const { error } = await serviceDb().auth.admin.updateUserById(userId, { password })
  if (error) {
    throw apiError(422, error.code === 'weak_password' ? 'weak_password' : 'password_update_failed')
  }
  unwrap(await actorDb(event, ctx).from('profiles').update({ must_change_password: true }).eq('id', userId))
  await revokeUserSessions(userId, 'admin')
  await audit(event, { actorId: ctx.userId, action: 'user.password_reset_by_admin', entityType: 'profile', entityId: userId })
  return { ok: true }
})
