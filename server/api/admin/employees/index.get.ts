/** People directory: employees visible to the caller (RLS) + non-employee accounts for org-wide admins. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'employees.read' })
  const employees = await fetchAll<any>((a, b) => ctx.db.from('employees')
    .select(`id, employee_code, job_title, hire_date, termination_date, status, department_id, office_id,
      profile:profiles!inner ( id, email, full_name, full_name_en, phone, is_active, last_login_at, role:roles ( key ) ),
      department:departments ( id, name_ar, name_en ),
      credentials:webauthn_credentials ( status )`)
    .order('employee_code').range(a, b))

  let users: any[] = []
  if (ctx.scope === 'organization') {
    const ids = new Set(employees.map(e => (Array.isArray(e.profile) ? e.profile[0] : e.profile).id))
    const all = await fetchAll<any>((a, b) => ctx.db.from('profiles')
      .select('id, email, full_name, full_name_en, phone, is_active, last_login_at, role:roles ( key )').order('full_name').range(a, b))
    users = all.filter(p => !ids.has(p.id))
  }
  const { data: managers } = await ctx.db.from('department_managers').select('department_id, user_id')
  return { employees, users, managers: managers ?? [] }
})
