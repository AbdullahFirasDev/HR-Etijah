/** List a configuration resource (RLS decides visibility, e.g. networks are restricted). */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const def = resourceDef(getRouterParam(event, 'resource'))
  return unwrap(await ctx.db.from(def.table).select(def.select).order(def.order).limit(1000))
})
