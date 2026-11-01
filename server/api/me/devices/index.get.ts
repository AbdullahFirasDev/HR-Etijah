export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  const rows = unwrap(await ctx.db.from('webauthn_credentials')
    .select('id, status, authenticator_name, device_type, backed_up, created_at, approved_at, last_used_at, revoked_at, revoke_reason, device:employee_devices ( label, platform )')
    .eq('employee_id', ctx.employee!.id)
    .order('created_at', { ascending: false }))
  const settings = await loadSettings(ctx.db)
  return { devices: rows, requireApproval: settings.require_device_approval, maxDevices: settings.max_devices_per_employee }
})
