import type { H3Event } from 'h3'

export interface AuditEntry {
  actorId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  reason?: string | null
  oldData?: unknown
  newData?: unknown
  metadata?: Record<string, unknown>
}

/** Append an application-level audit record (login, attendance, approvals…). Never throws. */
export async function audit(event: H3Event | null, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await serviceDb().from('audit_logs').insert({
      actor_id: entry.actorId ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      reason: entry.reason ?? null,
      old_data: entry.oldData ?? null,
      new_data: entry.newData ?? null,
      metadata: entry.metadata ?? {},
      ip: event ? clientIp(event) : null,
      user_agent: event ? userAgent(event) : null,
    })
    if (error) {
      console.error('[audit] insert failed', error.message)
    }
  }
  catch (e) {
    console.error('[audit] insert failed', e)
  }
}
