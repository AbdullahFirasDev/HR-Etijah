import { credentialStatusSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'devices.manage' })
  const id = routeUuid(event)
  const body = await readValid(event, credentialStatusSchema)
  const r = unwrap(await ctx.db.rpc('set_credential_status', { p_credential_id: id, p_status: body.status, p_reason: body.reason ?? null })) as { employee_id: string, status: string }
  await audit(event, { actorId: ctx.userId, action: `device.${body.status === 'active' ? 'approved' : 'revoked'}`, entityType: 'webauthn_credential', entityId: id, reason: body.reason })
  const { data: emp } = await serviceDb().from('employees').select('profile_id').eq('id', r.employee_id).single()
  await notify([emp!.profile_id], {
    type: `device.${body.status}`,
    titleAr: body.status === 'active' ? 'تمت الموافقة على جهازك' : 'تم إلغاء تفعيل أحد أجهزتك',
    titleEn: body.status === 'active' ? 'Your device was approved' : 'One of your devices was revoked',
    data: { url: '/devices' },
  })
  return r
})
