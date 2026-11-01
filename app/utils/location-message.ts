/**
 * Message for a location failure, with the measured numbers when the server provided them.
 * Keeps the two independent checks distinct:
 *   - distance from the office centre vs the geofence radius  → outside_geofence
 *   - precision of the GPS reading vs the maximum accuracy     → gps_accuracy_insufficient
 */
export interface LocationDetail {
  distance?: number | null
  radius?: number | null
  accuracy?: number | null
  maxAccuracy?: number | null
}

export interface LocationMessage {
  key: string
  params?: Record<string, number>
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function locationReasonMessage(reason: string, d: LocationDetail = {}): LocationMessage {
  if (reason === 'outside_geofence' && num(d.distance) && num(d.radius)) {
    return { key: 'reasonsDetail.outside_geofence', params: { d: Math.round(d.distance), r: d.radius } }
  }
  if (reason === 'gps_accuracy_insufficient' && num(d.accuracy) && num(d.maxAccuracy)) {
    const params = { a: Math.round(d.accuracy), max: d.maxAccuracy }
    return num(d.distance) && num(d.radius)
      ? { key: 'reasonsDetail.gps_accuracy_insufficient_distance', params: { ...params, d: Math.round(d.distance), r: d.radius } }
      : { key: 'reasonsDetail.gps_accuracy_insufficient', params }
  }
  return { key: `reasons.${reason}` }
}
