import { rolePermissionsSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'roles.manage' })
  const key = getRouterParam(event, 'key')
  if (!key || !['hr_manager', 'department_manager', 'employee'].includes(key)) {
    throw apiError(422, 'role_not_editable')
  }
  const { permissions } = await readValid(event, rolePermissionsSchema)
  if (key !== 'hr_manager' && permissions.includes('roles.manage')) {
    throw apiError(422, 'roles_manage_restricted')
  }
  const row = unwrap(await ctx.db.from('roles').update({ permissions: [...new Set(permissions)] }).eq('key', key).select('key, permissions').single())
  await audit(event, { actorId: ctx.userId, action: 'role.permissions_updated', entityType: 'role', entityId: key, newData: row })
  return row
})
