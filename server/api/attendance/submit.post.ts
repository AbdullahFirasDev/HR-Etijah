/**
 * Submit an attendance action. ALL THREE checks must pass, every time:
 *   A. Geofence  — GPS reading sent now; distance computed by PostGIS in the database
 *   B. Network   — client IP observed by the server (trusted-proxy aware), never client-sent
 *   C. WebAuthn  — fresh assertion over a single-use challenge for exactly this action
 * Nothing is queued: the request either succeeds online now or is rejected with reasons.
 */
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { addDays, localDate, resolveCheckInWorkDate } from '#shared/engine'
import { submitAttendanceSchema } from '#shared/schemas'
import { verifyAssertion } from '../../lib/assertion'
import { assessLocationRisk } from '../../lib/geo-risk'

interface RecordResult {
  ok: boolean
  duplicate?: boolean
  reasons?: string[]
  checks?: { geofence: boolean, network: boolean, webauthn: boolean }
  event_id?: string
  event_type?: string
  occurred_at?: string
  session_id?: string
  work_date?: string
  distance_m?: number | null
}

export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  await rateLimit(event, 'attendance-submit', ctx.userId, 10, 60)
  const body = await readValid(event, submitAttendanceSchema)
  const employee = ctx.employee!
  const now = new Date()
  const ip = clientIp(event)
  const db = serviceDb()
  const settings = await loadSettings(db)
  const extraReasons: string[] = []

  // ---- C. WebAuthn: consume the challenge first so it can never be used again --------------
  const expectedChallenge = await consumeChallenge(body.challengeId, ctx.userId, 'attendance', body.action)
  const { data: cred } = await db.from('webauthn_credentials')
    .select('id, credential_id, public_key, counter, transports, status')
    .eq('employee_id', employee.id)
    .eq('credential_id', body.assertion.id)
    .maybeSingle()

  let webauthnVerified = false
  if (!expectedChallenge) {
    extraReasons.push('challenge_expired')
  }
  else if (!cred || cred.status !== 'active') {
    extraReasons.push('device_not_authorized')
  }
  else {
    const r = await verifyAssertion({
      response: body.assertion as AuthenticationResponseJSON,
      expectedChallenge,
      origins: rp().origins,
      rpId: rp().rpID,
      credential: { id: cred.credential_id, publicKey: byteaToBytes(cred.public_key), counter: Number(cred.counter), transports: cred.transports },
    })
    if (r.ok) {
      webauthnVerified = true
      await db.from('webauthn_credentials').update({ counter: r.newCounter }).eq('id', cred.id)
    }
    else {
      extraReasons.push(r.reason)
      if (r.reason === 'authenticator_counter_mismatch') {
        await audit(event, { actorId: ctx.userId, action: 'security.authenticator_clone_suspected', entityType: 'webauthn_credential', entityId: cred.id })
      }
    }
  }

  // ---- A. Location risk (spoofing / impossible movement) -----------------------------------
  const { data: prev } = await db.from('verification_attempts')
    .select('latitude, longitude, occurred_at')
    .eq('employee_id', employee.id)
    .not('latitude', 'is', null)
    .lte('accuracy_m', 100)
    .gte('occurred_at', new Date(now.getTime() - 24 * 3600_000).toISOString())
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const risk = assessLocationRisk({
    reading: body.location,
    previous: prev ? { latitude: prev.latitude, longitude: prev.longitude, at: new Date(prev.occurred_at) } : null,
    now,
    maxTravelSpeedKmh: settings.max_travel_speed_kmh,
    maxAgeMs: settings.max_location_age_seconds * 1000,
    webdriver: body.client.webdriver,
  })

  // ---- Work date (overnight shifts: a post-midnight check-in may belong to yesterday) --------
  let workDate: string | null = null
  if (body.action === 'check_in') {
    const today = localDate(now, settings.timezone)
    const data = await loadCalcData([employee.id], addDays(today, -1), today, db)
    workDate = resolveCheckInWorkDate(now, settings.timezone, scheduleResolver(data, employee.id))
  }

  // ---- Authoritative verification + state machine in the database ---------------------------
  const result = unwrap(await db.rpc('record_attendance_event', {
    p_employee_id: employee.id,
    p_event_type: body.action,
    p_idempotency_key: body.idempotencyKey,
    p_challenge_id: body.challengeId,
    p_credential_id: cred?.id ?? null,
    p_webauthn_verified: webauthnVerified,
    p_latitude: body.location.latitude,
    p_longitude: body.location.longitude,
    p_accuracy_m: body.location.accuracy,
    p_position_captured_at: new Date(now.getTime() - Math.max(0, body.location.ageMs)).toISOString(),
    p_client_ip: ip,
    p_work_date: workDate,
    p_risk_score: risk.score,
    p_risk_flags: risk.flags,
    p_extra_reasons: extraReasons,
    p_user_agent: userAgent(event),
  })) as RecordResult

  if (!result.duplicate) {
    const fence = await decisionFence(employee.officeId, { id: (result as { geofence_id?: string }).geofence_id ?? null })
    logGeoDecision({
      stage: 'submit',
      employeeCode: employee.employeeCode,
      action: body.action,
      device: { latitude: body.location.latitude, longitude: body.location.longitude, accuracy: body.location.accuracy, ageMs: body.location.ageMs },
      office: fence ? { name: fence.name, latitude: fence.latitude, longitude: fence.longitude } : null,
      distanceM: result.distance_m,
      radiusM: fence?.radius_m,
      maxAccuracyM: fence?.max_accuracy_m,
      passed: result.ok, // overall verdict; reasons say which check failed
      reasons: result.reasons ?? [],
    })
    logNetworkDecision(event, {
      stage: 'submit',
      employeeCode: employee.employeeCode,
      action: body.action,
      passed: result.checks?.network ?? result.ok,
      reasons: (result.reasons ?? []).filter(r => r === 'unauthorized_network' || r === 'network_unknown'),
    })
  }

  if (result.ok && !result.duplicate) {
    await audit(event, {
      actorId: ctx.userId,
      action: `attendance.${body.action}`,
      entityType: 'attendance_event',
      entityId: result.event_id,
      metadata: { workDate: result.work_date, distanceM: result.distance_m, riskScore: risk.score },
    })
    recalculateSoon(event, [employee.id], result.work_date!, result.work_date!)
  }
  else if (!result.ok) {
    const reasons = result.reasons ?? []
    if (reasons.includes('location_spoofing_suspected') || reasons.includes('authenticator_counter_mismatch')) {
      await notify(await approverIds(employee.id, 'security.read'), {
        type: 'security.alert',
        titleAr: 'تنبيه أمني: محاولة حضور مشبوهة',
        titleEn: 'Security alert: suspicious attendance attempt',
        bodyAr: ctx.fullName,
        bodyEn: ctx.fullNameEn ?? ctx.fullName,
        data: { url: '/admin/security' },
      })
    }
    if (risk.score >= settings.risk_review_threshold) {
      await audit(event, { actorId: ctx.userId, action: 'security.location_risk', entityType: 'employee', entityId: employee.id, metadata: { score: risk.score, flags: risk.flags } })
    }
  }

  return {
    ok: result.ok,
    duplicate: result.duplicate ?? false,
    reasons: result.reasons ?? [],
    checks: result.checks ?? { geofence: true, network: true, webauthn: true },
    eventId: result.event_id ?? null,
    action: body.action,
    occurredAt: result.occurred_at ?? null,
    workDate: result.work_date ?? null,
    distanceM: result.distance_m ?? null,
  }
})
