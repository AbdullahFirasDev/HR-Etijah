/**
 * One-line diagnostic for every geofence decision (pre-check and final submission).
 * Contains what is needed to explain a decision — device and office coordinates, distance,
 * radius, reading accuracy and limit, fix age, verdict and reasons — and nothing else:
 * an employee code instead of a name, no IP, no tokens. Coordinates are rounded to 5
 * decimals (≈ 1 m).
 */
export interface GeoDecision {
  stage: 'precheck' | 'submit'
  employeeCode: string
  action: string
  device: { latitude: number, longitude: number, accuracy: number, ageMs?: number } | null
  office: { name: string, latitude: number, longitude: number } | null
  distanceM: number | null | undefined
  radiusM: number | null | undefined
  maxAccuracyM: number | null | undefined
  passed: boolean
  reasons: string[]
}

const coord = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`
const n = (v: number | null | undefined, unit = 'm') => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 10) / 10}${unit}` : 'n/a')

export function formatGeoDecision(d: GeoDecision): string {
  return [
    `[geo] ${d.stage}`,
    `emp=${d.employeeCode}`,
    `action=${d.action}`,
    `device=${d.device ? `${coord(d.device.latitude, d.device.longitude)} ±${n(d.device.accuracy)}` : 'none'}`,
    d.device?.ageMs !== undefined ? `fixAge=${n(d.device.ageMs / 1000, 's')}` : null,
    `office=${d.office ? `"${d.office.name.replace(/"/g, '')}" ${coord(d.office.latitude, d.office.longitude)}` : 'none'}`,
    `distance=${n(d.distanceM)}`,
    `radius=${n(d.radiusM)}`,
    `maxAccuracy=${n(d.maxAccuracyM)}`,
    `→ ${d.passed ? 'ACCEPT' : 'REJECT'}`,
    d.reasons.length ? `reasons=${d.reasons.join(',')}` : null,
  ].filter(Boolean).join(' ')
}
