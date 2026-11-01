export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const def = resourceDef(getRouterParam(event, 'resource'))
  if (!hasPermission(ctx, def.permission)) {
    throw apiError(403, 'forbidden')
  }
  const id = routeUuid(event)
  let value = await readValid(event, def.schema) as Record<string, unknown>
  value = def.normalize ? def.normalize(value) : value
  const { data, error } = await ctx.db.from(def.table).update(value).eq('id', id).select(def.select).maybeSingle()
  if (error) {
    throw dbError(error)
  }
  if (!data) {
    throw apiError(404, 'not_found')
  }
  const range = def.recalc?.(data)
  if (range) {
    recalculateSoon(event, 'all', range.from, range.to)
  }
  return data
})
