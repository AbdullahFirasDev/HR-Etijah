export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const def = resourceDef(getRouterParam(event, 'resource'))
  if (!hasPermission(ctx, def.permission)) {
    throw apiError(403, 'forbidden')
  }
  const id = routeUuid(event)
  const { data, error } = await ctx.db.from(def.table).delete().eq('id', id).select('*').maybeSingle()
  if (error) {
    // in use (FK) → suggest deactivating instead of deleting
    throw error.code === '23503' ? apiError(409, 'in_use_deactivate_instead') : dbError(error)
  }
  if (!data) {
    throw apiError(404, 'not_found')
  }
  const range = def.recalc?.(data)
  if (range) {
    recalculateSoon(event, 'all', range.from, range.to)
  }
  return { ok: true }
})
