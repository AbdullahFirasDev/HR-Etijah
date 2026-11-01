import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event)
  const { ids } = await readValid(event, z.object({ ids: z.array(z.uuid()).max(100).optional() }))
  let q = ctx.db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.userId).is('read_at', null)
  if (ids?.length) {
    q = q.in('id', ids)
  }
  unwrap(await q)
  return { ok: true }
})
