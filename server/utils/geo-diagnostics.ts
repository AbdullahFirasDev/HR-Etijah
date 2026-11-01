import { formatGeoDecision, type GeoDecision } from '../lib/geo-log'

export interface FenceRow {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_m: number
  max_accuracy_m: number
}

/** The geofence a decision was made against (by id, or the employee office's active fence). */
export async function decisionFence(officeId: string | null, match: { id?: string | null, name?: string | null, radius?: number | null } = {}): Promise<FenceRow | null> {
  let q = serviceDb().from('geofences').select('id, name, latitude, longitude, radius_m, max_accuracy_m').eq('is_active', true)
  if (match.id) q = q.eq('id', match.id)
  else if (officeId) q = q.eq('office_id', officeId)
  const { data } = await q
  const rows = (data ?? []) as FenceRow[]
  return rows.find(g => (!match.name || g.name === match.name) && (match.radius == null || g.radius_m === match.radius)) ?? rows[0] ?? null
}

export function logGeoDecision(d: GeoDecision): void {
  console.info(formatGeoDecision(d))
}
