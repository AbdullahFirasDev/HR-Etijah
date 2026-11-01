import { precheckSchema } from '#shared/schemas'

/**
 * Informational pre-check shown before the biometric prompt (steps 1 & 2 of the UI).
 * Nothing is recorded; /api/attendance/submit re-verifies everything authoritatively.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { employee: true })
  await rateLimit(event, 'precheck', ctx.userId, 30, 60)
  const body = await readValid(event, precheckSchema)
  const employee = ctx.employee!
  const ip = clientIp(event)

  const result = unwrap(await serviceDb().rpc('attendance_precheck', {
    p_employee_id: employee.id,
    p_latitude: body.location?.latitude ?? null,
    p_longitude: body.location?.longitude ?? null,
    p_accuracy_m: body.location?.accuracy ?? null,
    p_client_ip: ip,
  })) as { location: any, network: any }

  // Same freshness rule as the final submission (record_attendance_event), so an old fix is
  // reported here instead of passing the pre-check and failing later.
  const settings = await loadSettings()
  const location = { ...result.location, reasons: [...(result.location.reasons ?? [])] }
  if (body.location && body.location.ageMs > settings.max_location_age_seconds * 1000) {
    location.passed = false
    location.reasons.push('location_stale')
  }

  const fence = await decisionFence(employee.officeId, { name: location.geofence, radius: location.radius_m })
  logGeoDecision({
    stage: 'precheck',
    employeeCode: employee.employeeCode,
    action: body.action,
    device: body.location ? { latitude: body.location.latitude, longitude: body.location.longitude, accuracy: body.location.accuracy, ageMs: body.location.ageMs } : null,
    office: fence ? { name: fence.name, latitude: fence.latitude, longitude: fence.longitude } : null,
    distanceM: location.distance_m,
    radiusM: location.radius_m ?? fence?.radius_m,
    maxAccuracyM: location.max_accuracy_m ?? fence?.max_accuracy_m,
    passed: !!location.passed,
    reasons: location.reasons,
  })

  logNetworkDecision(event, {
    stage: 'precheck',
    employeeCode: employee.employeeCode,
    action: body.action,
    passed: !!result.network.passed,
    reasons: result.network.reasons ?? [],
  })

  const [state, creds] = await Promise.all([
    attendanceState(employee.id),
    serviceDb().from('webauthn_credentials').select('status').eq('employee_id', employee.id).neq('status', 'revoked'),
  ])
  const statuses = (creds.data ?? []).map(c => c.status)

  return {
    location,
    network: { ...result.network, ip },
    device: { registered: statuses.includes('active'), pendingApproval: !statuses.includes('active') && statuses.includes('pending') },
    state,
    actionAllowed: state.allowedActions.includes(body.action),
  }
})
