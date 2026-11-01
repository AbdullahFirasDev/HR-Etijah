/** One person (by user id): profile, employee record, schedules, devices, leave balances. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'employees.read' })
  const userId = routeUuid(event)
  const { data: profile } = await ctx.db.from('profiles')
    .select('id, email, full_name, full_name_en, phone, locale, is_active, must_change_password, last_login_at, created_at, role:roles ( key )')
    .eq('id', userId).maybeSingle()
  if (!profile) {
    throw apiError(404, 'not_found')
  }
  const { data: employee } = await ctx.db.from('employees')
    .select('id, employee_code, job_title, hire_date, termination_date, status, department_id, office_id, timezone')
    .eq('profile_id', userId).maybeSingle()

  let schedules: unknown[] = []
  let devices: unknown[] = []
  let balances: unknown[] = []
  if (employee) {
    const year = new Date().getUTCFullYear()
    const [s, d, b] = await Promise.all([
      ctx.db.from('employee_schedules').select('*, shift:shifts ( id, code, name_ar, name_en, start_time, end_time )').eq('employee_id', employee.id).order('effective_from', { ascending: false }),
      ctx.db.from('webauthn_credentials').select('id, status, authenticator_name, created_at, last_used_at, device:employee_devices ( label, platform )').eq('employee_id', employee.id).order('created_at', { ascending: false }),
      ctx.db.rpc('leave_balances_for', { p_employee_id: employee.id, p_year: year }),
    ])
    schedules = s.data ?? []
    devices = d.data ?? []
    balances = b.data ?? []
  }
  const { data: managed } = await ctx.db.from('department_managers').select('department_id').eq('user_id', userId)
  return { profile, employee, schedules, devices, balances, managedDepartmentIds: (managed ?? []).map(m => m.department_id) }
})
