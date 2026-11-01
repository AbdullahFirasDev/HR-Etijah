export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { passive: getQuery(event).passive === '1' })
  const [items, unread] = await Promise.all([
    ctx.db.from('notifications').select('id, type, title_ar, title_en, body_ar, body_en, data, read_at, created_at')
      .eq('user_id', ctx.userId).order('created_at', { ascending: false }).limit(50),
    ctx.db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).is('read_at', null),
  ])
  return { items: unwrap(items), unread: unread.count ?? 0 }
})
