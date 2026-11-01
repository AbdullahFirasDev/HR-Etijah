export interface GeoFix {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  speed: number | null
  timestamp: number
}

export class GeoError extends Error {
  constructor(public code: 'location_permission_denied' | 'location_unavailable' | 'location_timeout') {
    super(code)
  }
}

/**
 * High-accuracy GPS reading. Watches positions until one meets `targetAccuracy` (or the
 * timeout passes, returning the best fix seen so the server can report "accuracy
 * insufficient"). The browser decides the source (GPS/Wi-Fi/cell); the server never trusts
 * any client-side distance computation.
 */
export function useGeo() {
  const supported = import.meta.client && 'geolocation' in navigator

  async function permission(): Promise<PermissionState | 'unknown'> {
    try {
      const s = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      return s?.state ?? 'unknown'
    }
    catch {
      return 'unknown'
    }
  }

  function read(targetAccuracy: number, timeoutMs = 20_000, onProgress?: (fix: GeoFix) => void): Promise<GeoFix> {
    return new Promise((resolve, reject) => {
      if (!supported) {
        reject(new GeoError('location_unavailable'))
        return
      }
      let best: GeoFix | null = null
      let settled = false
      const finish = (fix: GeoFix | null, err?: GeoError) => {
        if (settled) return
        settled = true
        navigator.geolocation.clearWatch(watchId)
        clearTimeout(timer)
        if (fix) resolve(fix)
        else reject(err ?? new GeoError('location_unavailable'))
      }
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const fix: GeoFix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            speed: pos.coords.speed,
            timestamp: pos.timestamp,
          }
          if (!best || fix.accuracy < best.accuracy) {
            best = fix
            onProgress?.(fix)
          }
          if (fix.accuracy <= targetAccuracy) finish(fix)
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) finish(null, new GeoError('location_permission_denied'))
          else if (err.code === err.POSITION_UNAVAILABLE && !best) finish(null, new GeoError('location_unavailable'))
          else if (err.code === err.TIMEOUT && !best) finish(null, new GeoError('location_timeout'))
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
      )
      // No fix at all within the time limit → timeout; otherwise the best (most accurate) fix seen
      // is returned and the server decides whether its accuracy is acceptable.
      const timer = setTimeout(() => finish(best, new GeoError('location_timeout')), timeoutMs)
    })
  }

  /** Payload for the API; age is computed now so device clock skew does not matter. */
  function toReading(fix: GeoFix) {
    return {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      ageMs: Math.round(Date.now() - fix.timestamp),
      altitude: fix.altitude,
      speed: fix.speed,
    }
  }

  return { supported, permission, read, toReading }
}
