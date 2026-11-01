import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const { endpoint } = await readValid(event, z.object({ endpoint: z.string().max(2048) }))
  unwrap(await ctx.db.from('push_subscriptions').delete().eq('user_id', ctx.userId).eq('endpoint', endpoint))
  return { ok: true }
})
