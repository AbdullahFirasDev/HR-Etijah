import { PERMISSIONS } from '#shared/constants'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const roles = unwrap(await ctx.db.from('roles').select('id, key, name_ar, name_en, scope, permissions').order('id'))
  return { roles, catalog: PERMISSIONS }
})
