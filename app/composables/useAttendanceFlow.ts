import { startAuthentication } from '@simplewebauthn/browser'
import type { AttendanceAction } from '#shared/constants'
import { GeoError, type GeoFix } from './useGeo'

export type StepState = 'idle' | 'running' | 'passed' | 'failed'

interface StepInfo {
  state: StepState
  reasons: string[]
  detail: Record<string, unknown>
}

interface PrecheckResponse {
  location: { passed: boolean, reasons: string[], distance_m?: number, radius_m?: number, accuracy_m?: number, max_accuracy_m?: number }
  network: { passed: boolean, reasons: string[], ip: string | null }
  device: { registered: boolean, pendingApproval: boolean }
  actionAllowed: boolean
  state: { allowedActions: AttendanceAction[] }
}

export interface SubmitResponse {
  ok: boolean
  duplicate: boolean
  reasons: string[]
  checks: { geofence: boolean, network: boolean, webauthn: boolean }
  occurredAt: string | null
  workDate: string | null
  distanceM: number | null
  action: AttendanceAction
}

const LOCATION_REASONS = new Set(['outside_geofence', 'gps_accuracy_insufficient', 'location_unavailable', 'location_invalid', 'location_stale', 'location_permission_denied', 'location_timeout', 'location_spoofing_suspected', 'no_geofence_configured'])
const NETWORK_REASONS = new Set(['unauthorized_network', 'network_unknown'])
const BIOMETRIC_REASONS = new Set(['biometric_failed', 'authenticator_counter_mismatch', 'challenge_invalid', 'challenge_replayed', 'challenge_expired', 'device_not_authorized', 'no_registered_device'])

/**
 * Three-step verification for one attendance action:
 *   1. Location — high-accuracy GPS + server-side geofence pre-check (PostGIS)
 *   2. Network  — server observes the client IP and matches the company allowlist
 *   3. Biometric — fresh WebAuthn ceremony (user verification required) → final submit,
 *      where the server re-verifies all three before recording anything.
 * Online only: nothing is ever queued for later.
 */
export function useAttendanceFlow() {
  const api = useApi()
  const geo = useGeo()
  const online = useOnline()

  const running = ref(false)
  const result = ref<SubmitResponse | null>(null)
  const generalReasons = ref<string[]>([])
  const fix = ref<GeoFix | null>(null)
  const steps = reactive<Record<'location' | 'network' | 'biometric', StepInfo>>({
    location: { state: 'idle', reasons: [], detail: {} },
    network: { state: 'idle', reasons: [], detail: {} },
    biometric: { state: 'idle', reasons: [], detail: {} },
  })

  function reset() {
    for (const s of Object.values(steps)) {
      s.state = 'idle'
      s.reasons = []
      s.detail = {}
    }
    generalReasons.value = []
    result.value = null
  }

  function distribute(reasons: string[]) {
    for (const r of reasons) {
      if (LOCATION_REASONS.has(r)) steps.location.reasons.push(r)
      else if (NETWORK_REASONS.has(r)) steps.network.reasons.push(r)
      else if (BIOMETRIC_REASONS.has(r)) steps.biometric.reasons.push(r)
      else generalReasons.value.push(r)
    }
    if (steps.location.reasons.length) steps.location.state = 'failed'
    if (steps.network.reasons.length) steps.network.state = 'failed'
    if (steps.biometric.reasons.length) steps.biometric.state = 'failed'
  }

  async function run(action: AttendanceAction, targetAccuracy: number): Promise<SubmitResponse | null> {
    if (running.value) return null // no concurrent submissions from this screen
    reset()
    running.value = true
    try {
      if (!online.value) {
        generalReasons.value.push('offline')
        return null
      }

      // ---- Step 1: location ---------------------------------------------------------
      steps.location.state = 'running'
      try {
        fix.value = await geo.read(targetAccuracy, 20_000, (f) => {
          steps.location.detail = { accuracy: Math.round(f.accuracy) }
        })
      }
      catch (e) {
        steps.location.state = 'failed'
        steps.location.reasons.push(e instanceof GeoError ? e.code : 'location_unavailable')
        steps.network.state = 'idle'
        return null
      }

      // ---- Steps 1+2 server pre-check (geofence distance + observed IP) ----------------
      steps.network.state = 'running'
      const pre = await api<PrecheckResponse>('/api/attendance/precheck', {
        method: 'POST',
        body: { action, location: geo.toReading(fix.value) },
      })
      steps.location.detail = { ...steps.location.detail, distance: pre.location.distance_m, radius: pre.location.radius_m, accuracy: pre.location.accuracy_m, maxAccuracy: pre.location.max_accuracy_m }
      steps.network.detail = { ip: pre.network.ip }
      steps.location.state = pre.location.passed ? 'passed' : 'failed'
      steps.location.reasons = [...pre.location.reasons]
      steps.network.state = pre.network.passed ? 'passed' : 'failed'
      steps.network.reasons = [...pre.network.reasons]
      if (!pre.device.registered) {
        steps.biometric.state = 'failed'
        steps.biometric.reasons.push(pre.device.pendingApproval ? 'device_pending_approval' : 'no_registered_device')
      }
      if (!pre.actionAllowed) {
        generalReasons.value.push(action === 'check_in' ? 'already_checked_in' : 'not_checked_in')
      }
      if (!pre.location.passed || !pre.network.passed || !pre.device.registered || !pre.actionAllowed) {
        return null
      }

      // ---- Step 3: biometric (fresh WebAuthn ceremony) + authoritative submit -------------
      steps.biometric.state = 'running'
      const challenge = await api<{ challengeId: string, options: any }>('/api/attendance/challenge', { method: 'POST', body: { action } })
      let assertion
      try {
        assertion = await startAuthentication({ optionsJSON: challenge.options })
      }
      catch {
        steps.biometric.state = 'failed'
        steps.biometric.reasons.push('biometric_cancelled')
        return null
      }
      if (!online.value) {
        generalReasons.value.push('offline')
        return null
      }
      const res = await api<SubmitResponse>('/api/attendance/submit', {
        method: 'POST',
        body: {
          action,
          challengeId: challenge.challengeId,
          idempotencyKey: crypto.randomUUID(),
          location: geo.toReading(fix.value),
          assertion,
          client: { webdriver: navigator.webdriver === true },
        },
      })
      result.value = res
      if (res.ok) {
        steps.location.state = 'passed'
        steps.network.state = 'passed'
        steps.biometric.state = 'passed'
      }
      else {
        steps.location.reasons = []
        steps.network.reasons = []
        steps.biometric.reasons = []
        steps.location.state = res.checks.geofence ? 'passed' : 'failed'
        steps.network.state = res.checks.network ? 'passed' : 'failed'
        steps.biometric.state = res.checks.webauthn ? 'passed' : 'failed'
        distribute(res.reasons)
      }
      return res
    }
    catch (e) {
      const code = apiErrorCode(e)
      for (const s of Object.values(steps)) {
        if (s.state === 'running') s.state = 'failed'
      }
      generalReasons.value.push(code === 'network_error' ? 'offline' : code === 'session_expired' || code === 'unauthenticated' ? 'session_expired' : code)
      return null
    }
    finally {
      running.value = false
    }
  }

  return { steps, running, result, generalReasons, fix, run, reset }
}
