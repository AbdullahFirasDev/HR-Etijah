import { z } from 'zod'

const query = z.object({
  outcome: z.enum(['accepted', 'rejected']).optional(),
  employeeId: z.uuid().optional(),
  minRisk: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'security.read' })
  const q = queryValid(event, query)
  let s = ctx.db.from('verification_attempts')
    .select(`id, action, occurred_at, outcome, failure_reasons, latitude, longitude, accuracy_m, distance_m, geofence_passed,
      client_ip, network_passed, webauthn_passed, risk_score, risk_flags, user_agent,
      employee:employees!inner ( id, employee_code, profile:profiles!inner ( full_name, full_name_en ) )`)
    .order('occurred_at', { ascending: false })
  if (q.outcome) s = s.eq('outcome', q.outcome)
  if (q.employeeId) s = s.eq('employee_id', q.employeeId)
  if (q.minRisk !== undefined) s = s.gte('risk_score', q.minRisk)
  return unwrap(await s.limit(q.limit))
})
