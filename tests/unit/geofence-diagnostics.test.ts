import { describe, expect, it } from 'vitest'
import { locationReasonMessage } from '~~/app/utils/location-message'
import { formatGeoDecision } from '~~/server/lib/geo-log'

describe('location failure messages', () => {
  it('states distance vs radius for an out-of-area reading', () => {
    expect(locationReasonMessage('outside_geofence', { distance: 318.6, radius: 250, accuracy: 12, maxAccuracy: 50 }))
      .toEqual({ key: 'reasonsDetail.outside_geofence', params: { d: 319, r: 250 } })
  })

  it('states the reading precision vs the limit — and that it is not the distance', () => {
    expect(locationReasonMessage('gps_accuracy_insufficient', { distance: 119.7, radius: 250, accuracy: 180.4, maxAccuracy: 50 }))
      .toEqual({ key: 'reasonsDetail.gps_accuracy_insufficient_distance', params: { a: 180, max: 50, d: 120, r: 250 } })
    expect(locationReasonMessage('gps_accuracy_insufficient', { accuracy: 75, maxAccuracy: 50 }))
      .toEqual({ key: 'reasonsDetail.gps_accuracy_insufficient', params: { a: 75, max: 50 } })
  })

  it('falls back to the generic reason when numbers are missing or for other reasons', () => {
    expect(locationReasonMessage('outside_geofence', {})).toEqual({ key: 'reasons.outside_geofence' })
    expect(locationReasonMessage('location_timeout')).toEqual({ key: 'reasons.location_timeout' })
    expect(locationReasonMessage('location_permission_denied', { accuracy: 10 })).toEqual({ key: 'reasons.location_permission_denied' })
  })
})

describe('geofence diagnostic log line', () => {
  const base = {
    stage: 'precheck' as const,
    employeeCode: 'E004',
    action: 'check_in',
    device: { latitude: 32.019287654, longitude: 44.341549912, accuracy: 180.42, ageMs: 1250 },
    office: { name: 'Head office', latitude: 32.0182103, longitude: 44.3415499 },
    distanceM: 119.7,
    radiusM: 250,
    maxAccuracyM: 50,
    passed: false,
    reasons: ['gps_accuracy_insufficient'],
  }

  it('contains every decision input and the verdict', () => {
    expect(formatGeoDecision(base)).toBe('[geo] precheck emp=E004 action=check_in device=32.01929,44.34155 ±180.4m fixAge=1.3s office="Head office" 32.01821,44.34155 distance=119.7m radius=250m maxAccuracy=50m → REJECT reasons=gps_accuracy_insufficient')
  })

  it('handles missing readings and an accepted decision', () => {
    expect(formatGeoDecision({ ...base, device: null, distanceM: null, passed: true, reasons: [] }))
      .toBe('[geo] precheck emp=E004 action=check_in device=none office="Head office" 32.01821,44.34155 distance=n/a radius=250m maxAccuracy=50m → ACCEPT')
  })
})
