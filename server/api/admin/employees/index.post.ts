import { localDate } from '#shared/engine'
import { employeeCreateSchema } from '#shared/schemas'

/** Provision an account (Supabase Auth) + profile + optional employee record and schedule. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'employees.manage' })
  const body = await readValid(event, employeeCreateSchema)
  if (ctx.scope !== 'organization') {
    throw apiError(403, 'forbidden')
  }
  if ((body.role === 'owner' || body.role === 'hr_manager') && ctx.role !== 'owner') {
    throw apiError(403, 'only_owner_can_grant_role')
  }

  const admin = serviceDb()
  const db = actorDb(event, ctx)
  const { data: created, error } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.initialPassword,
    email_confirm: true,
    user_metadata: { full_name: body.fullName },
  })
  if (error || !created.user) {
    throw apiError(error?.code === 'email_exists' || /already/i.test(error?.message ?? '') ? 409 : 422, error?.code === 'weak_password' ? 'weak_password' : (error?.code === 'email_exists' || /already/i.test(error?.message ?? '') ? 'email_exists' : 'user_create_failed'))
  }
  const userId = created.user.id

  try {
    const { data: role } = await admin.from('roles').select('id').eq('key', body.role).single()
    unwrap(await db.from('profiles').insert({
      id: userId,
      email: body.email,
      full_name: body.fullName,
      full_name_en: body.fullNameEn ?? null,
      phone: body.phone ?? null,
      role_id: role!.id,
      must_change_password: true,
    }))

    let employeeId: string | null = null
    if (body.isEmployee) {
      const emp = unwrap(await db.from('employees').insert({
        profile_id: userId,
        employee_code: body.employeeCode!,
        department_id: body.departmentId ?? null,
        office_id: body.officeId ?? null,
        job_title: body.jobTitle ?? null,
        hire_date: body.hireDate ?? null,
      }).select('id').single())
      employeeId = emp.id

      const settings = await loadSettings(admin)
      const today = localDate(new Date(), settings.timezone)
      if (body.shiftId) {
        unwrap(await db.from('employee_schedules').insert({ employee_id: emp.id, shift_id: body.shiftId, effective_from: body.hireDate ?? today }))
      }
      const { data: types } = await admin.from('leave_types').select('id, annual_allowance_days').eq('tracks_balance', true).eq('is_active', true)
      if (types?.length) {
        unwrap(await db.from('leave_balances').insert(types.map(t => ({ employee_id: emp.id, leave_type_id: t.id, year: Number(today.slice(0, 4)), allocated_days: t.annual_allowance_days }))))
      }
    }
    if (body.role === 'department_manager' && body.managedDepartmentIds.length) {
      unwrap(await db.from('department_managers').insert(body.managedDepartmentIds.map(department_id => ({ department_id, user_id: userId }))))
    }

    await audit(event, { actorId: ctx.userId, action: 'user.created', entityType: 'profile', entityId: userId, metadata: { role: body.role, employeeId } })
    return { userId, employeeId }
  }
  catch (e) {
    // roll back the auth account so a retry can succeed cleanly
    await admin.auth.admin.deleteUser(userId).catch(() => {})
    throw e
  }
})
