import { orgSettingsSchema } from '#shared/schemas'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'settings.manage' })
  const body = await readValid(event, orgSettingsSchema)
  try {
    new Intl.DateTimeFormat('en', { timeZone: body.timezone })
  }
  catch {
    throw apiError(422, 'invalid_timezone')
  }
  const before = await loadSettings(ctx.db)
  const row = unwrap(await ctx.db.from('org_settings').update(body).eq('id', 1).select('*').single())
  await audit(event, { actorId: ctx.userId, action: 'settings.updated', entityType: 'org_settings', entityId: '1', oldData: before, newData: row })
  const today = new Date().toISOString().slice(0, 10)
  recalculateSoon(event, 'all', `${today.slice(0, 7)}-01`, today)
  return row
})
