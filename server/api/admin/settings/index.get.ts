export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  return loadSettings(ctx.db)
})
