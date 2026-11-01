import { z } from 'zod'

const query = z.object({
  entityType: z.string().max(64).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'audit.read' })
  const q = queryValid(event, query)
  let s = ctx.db.from('audit_logs').select('*').order('occurred_at', { ascending: false })
  if (q.entityType) s = s.eq('entity_type', q.entityType)
  if (q.actorId) s = s.eq('actor_id', q.actorId)
  if (q.action) s = s.ilike('action', `${q.action.replace(/[%_\\]/g, '')}%`)
  const rows = unwrap(await s.limit(q.limit)) as any[]
  const actorIds = [...new Set(rows.map(r => r.actor_id).filter(Boolean))]
  const { data: actors } = actorIds.length
    ? await ctx.db.from('profiles').select('id, full_name, full_name_en').in('id', actorIds)
    : { data: [] as any[] }
  const names = new Map((actors ?? []).map((a: any) => [a.id, a]))
  return rows.map(r => ({ ...r, actor: names.get(r.actor_id) ?? null }))
})
