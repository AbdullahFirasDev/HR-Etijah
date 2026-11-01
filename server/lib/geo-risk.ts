/**
 * Location-spoofing risk heuristics. A browser cannot prove a GPS reading is genuine, so this
 * scores tell-tale signs of mock-location tools and impossible movement. The score is passed
 * to record_attendance_event(), which rejects at org_settings.risk_block_threshold and the
 * dashboard surfaces anything above risk_review_threshold for HR review.
 * These are deterrents, not proof — see docs/SECURITY.md.
 */

export interface LocationReading {
  latitude: number
  longitude: number
  accuracy: number
  ageMs: number
  altitude?: number | null
  speed?: number | null
}

export interface PreviousFix {
  latitude: number
  longitude: number
  at: Date
}

export interface RiskInput {
  reading: LocationReading
  previous?: PreviousFix | null
  now: Date
  maxTravelSpeedKmh: number
  maxAgeMs: number
  webdriver?: boolean
}

export interface RiskResult {
  score: number
  flags: string[]
  travelSpeedKmh?: number
}

const EARTH_RADIUS_M = 6_371_008.8

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

function decimals(n: number): number {
  const s = String(n)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export function assessLocationRisk(input: RiskInput): RiskResult {
  const { reading: r, previous, now } = input
  const flags: string[] = []
  let score = 0
  const add = (flag: string, points: number) => {
    flags.push(flag)
    score += points
  }

  if (r.accuracy <= 0) {
    add('accuracy_zero', 40)
  }
  else if (r.accuracy < 1) {
    add('accuracy_suspiciously_precise', 20)
  }
  if (decimals(r.latitude) <= 3 && decimals(r.longitude) <= 3) {
    add('coordinates_low_precision', 15)
  }
  if (r.ageMs < -5_000) {
    add('future_timestamp', 20)
  }
  else if (r.ageMs > input.maxAgeMs) {
    add('stale_fix', 10)
  }
  if (typeof r.speed === 'number' && r.speed > 50) {
    add('reported_speed_high', 20)
  }
  if (input.webdriver) {
    add('automation_detected', 40)
  }

  let travelSpeedKmh: number | undefined
  if (previous) {
    const meters = haversineMeters(previous.latitude, previous.longitude, r.latitude, r.longitude)
    const seconds = Math.max(60, (now.getTime() - previous.at.getTime()) / 1000)
    // Ignore small displacements that GPS error alone can explain.
    if (meters > Math.max(500, r.accuracy * 3)) {
      travelSpeedKmh = (meters / 1000) / (seconds / 3600)
      if (travelSpeedKmh > input.maxTravelSpeedKmh * 2) {
        add('impossible_travel', 80)
      }
      else if (travelSpeedKmh > input.maxTravelSpeedKmh) {
        add('impossible_travel', 60)
      }
      else if (travelSpeedKmh > input.maxTravelSpeedKmh / 2) {
        add('fast_travel', 20)
      }
    }
    const elapsedMin = (now.getTime() - previous.at.getTime()) / 60_000
    if (elapsedMin > 10 && previous.latitude === r.latitude && previous.longitude === r.longitude) {
      add('identical_coordinates', 30) // real GPS jitters; replayed/mocked fixes often repeat exactly
    }
  }

  return { score: Math.min(100, score), flags, travelSpeedKmh }
}
