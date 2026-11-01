import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { allowPasswordChange: true })
  const { locale } = await readValid(event, z.object({ locale: z.enum(['ar', 'en']) }))
  unwrap(await ctx.db.from('profiles').update({ locale }).eq('id', ctx.userId))
  return { ok: true, locale }
})
