export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const def = resourceDef(getRouterParam(event, 'resource'))
  if (!hasPermission(ctx, def.permission)) {
    throw apiError(403, 'forbidden')
  }
  let value = await readValid(event, def.schema) as Record<string, unknown>
  value = def.normalize ? def.normalize(value) : value
  const row = unwrap(await ctx.db.from(def.table).insert(value).select(def.select).single())
  const range = def.recalc?.(row)
  if (range) {
    recalculateSoon(event, 'all', range.from, range.to)
  }
  return row
})
