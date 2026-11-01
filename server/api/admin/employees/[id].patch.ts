import { employeeUpdateSchema } from '#shared/schemas'

/** Update a person (by user id). Role changes go through set_user_role() (owner-only for privileged roles). */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'employees.manage' })
  const userId = routeUuid(event)
  const body = await readValid(event, employeeUpdateSchema)

  // Visibility through RLS = scope check for the caller.
  const { data: target } = await ctx.db.from('profiles').select('id, role:roles ( key )').eq('id', userId).maybeSingle()
  if (!target) {
    throw apiError(404, 'not_found')
  }
  const targetRole = (Array.isArray(target.role) ? target.role[0] : target.role)?.key
  if ((targetRole === 'owner' || targetRole === 'hr_manager') && ctx.role !== 'owner' && userId !== ctx.userId) {
    throw apiError(403, 'only_owner_can_edit_privileged_user')
  }
  if (userId === ctx.userId && body.isActive === false) {
    throw apiError(422, 'cannot_deactivate_self')
  }

  const db = actorDb(event, ctx)
  const profilePatch: Record<string, unknown> = {}
  if (body.fullName !== undefined) profilePatch.full_name = body.fullName
  if (body.fullNameEn !== undefined) profilePatch.full_name_en = body.fullNameEn
  if (body.phone !== undefined) profilePatch.phone = body.phone
  if (body.isActive !== undefined) profilePatch.is_active = body.isActive
  if (Object.keys(profilePatch).length) {
    unwrap(await db.from('profiles').update(profilePatch).eq('id', userId))
  }

  if (body.role && body.role !== targetRole) {
    unwrap(await ctx.db.rpc('set_user_role', { p_user_id: userId, p_role_key: body.role }))
  }

  const empPatch: Record<string, unknown> = {}
  if (body.employeeCode !== undefined) empPatch.employee_code = body.employeeCode
  if (body.departmentId !== undefined) empPatch.department_id = body.departmentId
  if (body.officeId !== undefined) empPatch.office_id = body.officeId
  if (body.jobTitle !== undefined) empPatch.job_title = body.jobTitle
  if (body.hireDate !== undefined) empPatch.hire_date = body.hireDate
  if (body.terminationDate !== undefined) empPatch.termination_date = body.terminationDate
  if (body.status !== undefined) empPatch.status = body.status
  if (Object.keys(empPatch).length) {
    unwrap(await db.from('employees').update(empPatch).eq('profile_id', userId))
  }

  if (body.managedDepartmentIds) {
    unwrap(await db.from('department_managers').delete().eq('user_id', userId))
    if (body.managedDepartmentIds.length) {
      unwrap(await db.from('department_managers').insert(body.managedDepartmentIds.map(department_id => ({ department_id, user_id: userId }))))
    }
  }

  if (body.isActive === false || body.status === 'suspended' || body.status === 'terminated') {
    await revokeUserSessions(userId, 'account_disabled')
  }
  await audit(event, { actorId: ctx.userId, action: 'user.updated', entityType: 'profile', entityId: userId, newData: body })
  return { ok: true }
})
