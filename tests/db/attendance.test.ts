/**
 * record_attendance_event(): geofence (PostGIS), network allowlist, WebAuthn challenge
 * binding, state machine, idempotency and immutability — executed against real Postgres.
 */
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createTestDatabase, one, rows } from './harness'
import { addCredential, createChallenge, EMPLOYEES, INSIDE, OFFICE, OFFICE_IP, OUTSIDE, submit, USERS } from './fixtures'

let db: PGlite
let aliCred: string
let saraCred: string

beforeAll(async () => {
  db = await createTestDatabase({ seed: true })
  aliCred = await addCredential(db, EMPLOYEES.ali, USERS.ali)
  saraCred = await addCredential(db, EMPLOYEES.sara, USERS.sara)
})
afterAll(async () => {
  await db?.close()
})

const ali = () => ({ employeeId: EMPLOYEES.ali, userId: USERS.ali, credentialId: aliCred })
const sara = () => ({ employeeId: EMPLOYEES.sara, userId: USERS.sara, credentialId: saraCred })

describe('three-factor verification', () => {
  it('rejects a check-in outside the geofence and reports the PostGIS distance', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', ...{ lat: OUTSIDE.lat, lng: OUTSIDE.lng } })
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('outside_geofence')
    expect(r.checks?.geofence).toBe(false)
    expect(r.distance_m).toBeGreaterThan(200)
    expect(r.distance_m).toBeLessThan(240)
  })

  it('rejects insufficient GPS accuracy even inside the fence', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', accuracy: 75 })
    expect(r.ok).toBe(false)
    expect(r.reasons).toEqual(['gps_accuracy_insufficient'])
  })

  it('rejects a missing location reading', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', lat: null, lng: null, accuracy: null })
    expect(r.reasons).toContain('location_unavailable')
  })

  it('rejects a stale location reading', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', positionAgeSeconds: 300 })
    expect(r.reasons).toContain('location_stale')
  })

  it('rejects an IP outside the allowed networks', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', ip: '203.0.113.50' })
    expect(r.ok).toBe(false)
    expect(r.reasons).toEqual(['unauthorized_network'])
    expect(r.checks?.network).toBe(false)
  })

  it('does not allow loopback: a localhost request is not the office network', async () => {
    for (const ip of ['127.0.0.1', '::1']) {
      const r = await submit(db, { ...sara(), action: 'check_in', ip })
      expect(r.reasons).toEqual(['unauthorized_network'])
    }
  })

  it('rejects an unknown client IP', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', ip: null })
    expect(r.reasons).toEqual(['network_unknown'])
  })

  it('rejects when the WebAuthn assertion was not verified', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', webauthnVerified: false })
    expect(r.reasons).toContain('biometric_failed')
    expect(r.checks?.webauthn).toBe(false)
  })

  it('rejects a challenge that was never consumed (assertion not checked server-side)', async () => {
    const challengeId = await createChallenge(db, USERS.sara, 'check_in', { consume: false })
    const r = await submit(db, { ...sara(), action: 'check_in', challengeId })
    expect(r.reasons).toContain('challenge_invalid')
  })

  it('cannot consume an expired challenge', async () => {
    const challengeId = await createChallenge(db, USERS.sara, 'check_in', { consume: false, expired: true })
    const consumed = await asService(db, tx => one<{ c: string | null }>(tx,
      `select public.consume_webauthn_challenge($1, $2, 'attendance', 'check_in') as c`, [challengeId, USERS.sara]))
    expect(consumed.c).toBeNull()
  })

  it('consumes a challenge only once', async () => {
    const challengeId = await createChallenge(db, USERS.sara, 'check_in', { consume: false })
    const first = await asService(db, tx => one<{ c: string | null }>(tx,
      `select public.consume_webauthn_challenge($1, $2, 'attendance', 'check_in') as c`, [challengeId, USERS.sara]))
    const second = await asService(db, tx => one<{ c: string | null }>(tx,
      `select public.consume_webauthn_challenge($1, $2, 'attendance', 'check_in') as c`, [challengeId, USERS.sara]))
    expect(first.c).toBeTruthy()
    expect(second.c).toBeNull()
  })

  it('rejects a challenge issued for a different action', async () => {
    const challengeId = await createChallenge(db, USERS.sara, 'check_out')
    const r = await submit(db, { ...sara(), action: 'check_in', challengeId })
    expect(r.reasons).toContain('challenge_invalid')
  })

  it('rejects a challenge belonging to another user', async () => {
    const challengeId = await createChallenge(db, USERS.ali, 'check_in')
    const r = await submit(db, { ...sara(), action: 'check_in', challengeId })
    expect(r.reasons).toContain('challenge_invalid')
  })

  it('rejects a revoked / pending device', async () => {
    const pending = await addCredential(db, EMPLOYEES.sara, USERS.sara, 'pending')
    const r = await submit(db, { ...sara(), credentialId: pending, action: 'check_in' })
    expect(r.reasons).toContain('device_not_authorized')
  })

  it('blocks a high spoofing-risk score', async () => {
    const r = await submit(db, { ...sara(), action: 'check_in', riskScore: 95 })
    expect(r.reasons).toContain('location_spoofing_suspected')
  })

  it('logs every rejected attempt immutably', async () => {
    const r = await rows<{ outcome: string }>(db,
      `select outcome from public.verification_attempts where employee_id = $1`, [EMPLOYEES.sara])
    expect(r.length).toBeGreaterThanOrEqual(10)
    expect(r.every(a => a.outcome === 'rejected')).toBe(true)
    await expect(asService(db, tx => tx.query(`delete from public.verification_attempts where employee_id = $1`, [EMPLOYEES.sara])))
      .rejects.toThrow(/append-only/)
  })
})

describe('attendance state machine', () => {
  it('accepts a valid check-in with all three checks passing', async () => {
    const r = await submit(db, { ...ali(), action: 'check_in' })
    expect(r).toMatchObject({ ok: true, duplicate: false })
    expect(r.distance_m).toBeLessThan(50)
    const session = await one<{ status: string, check_in_event_id: string }>(db,
      `select status, check_in_event_id from public.attendance_sessions where id = $1`, [r.session_id])
    expect(session.status).toBe('open')
    expect(session.check_in_event_id).toBe(r.event_id)
  })

  it('rejects a duplicate check-in while a session is open', async () => {
    const r = await submit(db, { ...ali(), action: 'check_in' })
    expect(r.ok).toBe(false)
    expect(r.reasons).toEqual(['already_checked_in'])
  })

  it('is idempotent: the same key returns the original event without a second write', async () => {
    const key = randomUUID()
    const first = await submit(db, { ...ali(), action: 'break_start', idempotencyKey: key })
    expect(first.ok).toBe(true)
    const again = await submit(db, { ...ali(), action: 'break_start', idempotencyKey: key })
    expect(again).toMatchObject({ ok: true, duplicate: true, event_id: first.event_id })
    const count = await one<{ n: number }>(db,
      `select count(*)::int as n from public.attendance_events where employee_id = $1 and event_type = 'break_start'`, [EMPLOYEES.ali])
    expect(count.n).toBe(1)
  })

  it('refuses a second break while one is open, and a replayed challenge', async () => {
    const challengeId = await createChallenge(db, USERS.ali, 'break_start')
    const r = await submit(db, { ...ali(), action: 'break_start', challengeId })
    expect(r.reasons).toContain('break_already_started')
    // the same (already consumed) challenge can never be reused for an accepted event
    const used = await one<{ challenge_id: string }>(db,
      `select challenge_id from public.attendance_events where employee_id = $1 and event_type = 'break_start'`, [EMPLOYEES.ali])
    const replay = await submit(db, { ...ali(), action: 'break_start', challengeId: used.challenge_id })
    expect(replay.reasons).toEqual(expect.arrayContaining(['challenge_replayed']))
  })

  it('closes an open break automatically on check-out', async () => {
    const r = await submit(db, { ...ali(), action: 'check_out' })
    expect(r.ok).toBe(true)
    const brk = await one<{ status: string, end_event_id: string }>(db,
      `select status, end_event_id from public.breaks where employee_id = $1`, [EMPLOYEES.ali])
    expect(brk).toEqual({ status: 'closed', end_event_id: r.event_id })
    const s = await one<{ status: string }>(db, `select status from public.attendance_sessions where id = $1`, [r.session_id])
    expect(s.status).toBe('closed')
  })

  it('rejects check-out without an open check-in', async () => {
    const r = await submit(db, { ...ali(), action: 'check_out' })
    expect(r.reasons).toEqual(['not_checked_in'])
  })

  it('rejects break end without an active break', async () => {
    await submit(db, { ...ali(), action: 'check_in' })
    const r = await submit(db, { ...ali(), action: 'break_end' })
    expect(r.reasons).toEqual(['no_active_break'])
  })
})

describe('immutability and direct-access protection', () => {
  it('forbids UPDATE and DELETE of attendance events, even for the service role', async () => {
    await expect(asService(db, tx => tx.query(`update public.attendance_events set occurred_at = now() - interval '1 hour' where employee_id = $1`, [EMPLOYEES.ali])))
      .rejects.toThrow(/append-only/)
    await expect(asService(db, tx => tx.query(`delete from public.attendance_events where employee_id = $1`, [EMPLOYEES.ali])))
      .rejects.toThrow(/append-only/)
  })

  it('does not let an employee insert events or call the attendance function directly', async () => {
    await expect(asUser(db, USERS.ali, tx => tx.query(`
      insert into public.attendance_events (employee_id, event_type, work_date, source)
      values ($1, 'check_in', current_date, 'system')`, [EMPLOYEES.ali]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, USERS.ali, tx => tx.query(`
      select public.record_attendance_event($1, 'check_in', gen_random_uuid(), null, null, true, 0, 0, 1, now(), '127.0.0.1')`,
    [EMPLOYEES.ali]))).rejects.toThrow(/permission denied/)
  })

  it('rejects an employee-sourced event row that did not pass all checks (constraint)', async () => {
    await expect(asService(db, tx => tx.query(`
      insert into public.attendance_events (employee_id, event_type, work_date, source, geofence_passed, network_passed, webauthn_passed)
      values ($1, 'check_in', current_date, 'employee', true, false, true)`, [EMPLOYEES.sara]))).rejects.toThrow(/check constraint/)
  })

  it('hides WebAuthn challenges and app sessions from authenticated users', async () => {
    await expect(asUser(db, USERS.ali, tx => tx.query(`select * from public.webauthn_challenges`))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, USERS.ali, tx => tx.query(`select * from public.app_sessions`))).rejects.toThrow(/permission denied/)
  })
})

describe('missing check-out detection', () => {
  it('flags sessions open longer than the configured limit', async () => {
    await asService(db, async (tx) => {
      // Night employee: craft an old open session through an approved interval-free path
      await tx.query(`update public.org_settings set auto_close_after_hours = 4 where id = 1`)
    })
    const r = await submit(db, { employeeId: EMPLOYEES.night, userId: USERS.night, credentialId: await addCredential(db, EMPLOYEES.night, USERS.night), action: 'check_in' })
    expect(r.ok).toBe(true)
    // nothing to flag yet
    const none = await asService(db, tx => rows(tx, `select * from public.flag_missing_checkouts()`))
    expect(none).toEqual([])
  })

  it('flags a session left open past the limit, voids its open break and frees the employee to check in again', async () => {
    // A check-in 20 hours ago (system-sourced row: the only way to backdate in a test).
    await asService(db, async (tx) => {
      await tx.query(`
        with ev as (
          insert into public.attendance_events (id, employee_id, session_id, event_type, occurred_at, work_date, source)
          values ('aaaaaaaa-0000-4000-a000-000000000001', $1, 'bbbbbbbb-0000-4000-a000-000000000001', 'check_in', now() - interval '20 hours', current_date - 1, 'system')
          returning id)
        insert into public.attendance_sessions (id, employee_id, work_date, check_in_event_id, check_in_at, status)
        values ('bbbbbbbb-0000-4000-a000-000000000001', $1, current_date - 1, 'aaaaaaaa-0000-4000-a000-000000000001', now() - interval '20 hours', 'open')`, [EMPLOYEES.hr])
      await tx.query(`
        with ev as (
          insert into public.attendance_events (id, employee_id, session_id, event_type, occurred_at, work_date, source)
          values ('aaaaaaaa-0000-4000-a000-000000000002', $1, 'bbbbbbbb-0000-4000-a000-000000000001', 'break_start', now() - interval '19 hours', current_date - 1, 'system')
          returning id)
        insert into public.breaks (employee_id, session_id, start_event_id, started_at, status)
        values ($1, 'bbbbbbbb-0000-4000-a000-000000000001', 'aaaaaaaa-0000-4000-a000-000000000002', now() - interval '19 hours', 'open')`, [EMPLOYEES.hr])
    })
    const flagged = await asService(db, tx => rows<{ session_id: string, employee_id: string }>(tx, `select * from public.flag_missing_checkouts()`))
    expect(flagged).toEqual([expect.objectContaining({ session_id: 'bbbbbbbb-0000-4000-a000-000000000001', employee_id: EMPLOYEES.hr })])
    const s = await one<{ status: string, closed_by: string }>(db, `select status, closed_by from public.attendance_sessions where id = 'bbbbbbbb-0000-4000-a000-000000000001'`)
    expect(s).toEqual({ status: 'missing_checkout', closed_by: 'system' })
    const b = await one<{ status: string }>(db, `select status from public.breaks where session_id = 'bbbbbbbb-0000-4000-a000-000000000001'`)
    expect(b.status).toBe('voided')
    // the employee can check in again
    const hrCred = await addCredential(db, EMPLOYEES.hr, USERS.hr)
    const r = await submit(db, { employeeId: EMPLOYEES.hr, userId: USERS.hr, credentialId: hrCred, action: 'check_in' })
    expect(r.ok).toBe(true)
  })
})

describe('geofence distance is computed by PostGIS', () => {
  it('matches a known geodesic distance', async () => {
    const r = await one<{ d: number }>(db, `
      select extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint($2, $1), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint($4, $3), 4326)::extensions.geography) as d`,
    [OFFICE.lat, OFFICE.lng, INSIDE.lat, INSIDE.lng])
    expect(r.d).toBeGreaterThan(30)
    expect(r.d).toBeLessThan(36)
  })
})

describe('attendance_precheck (informational, mirrors the authoritative checks)', () => {
  const precheck = (lat: number | null, lng: number | null, acc: number | null, ip: string | null) =>
    asService(db, tx => one<{ r: any }>(tx, `select public.attendance_precheck($1, $2, $3, $4, $5::inet) as r`, [EMPLOYEES.sara, lat, lng, acc, ip]))
      .then(x => x.r)

  it('passes inside the fence on an allowed network', async () => {
    const r = await precheck(INSIDE.lat, INSIDE.lng, 10, OFFICE_IP)
    expect(r.location.passed).toBe(true)
    expect(r.network.passed).toBe(true)
  })

  it('rejects loopback and unknown IPs on the network step', async () => {
    expect((await precheck(INSIDE.lat, INSIDE.lng, 10, '::1')).network).toEqual({ passed: false, reasons: ['unauthorized_network'] })
    expect((await precheck(INSIDE.lat, INSIDE.lng, 10, '127.0.0.1')).network).toEqual({ passed: false, reasons: ['unauthorized_network'] })
    expect((await precheck(INSIDE.lat, INSIDE.lng, 10, null)).network).toEqual({ passed: false, reasons: ['network_unknown'] })
  })

  it('reports the same reasons as record_attendance_event', async () => {
    const r = await precheck(OUTSIDE.lat, OUTSIDE.lng, 80, '203.0.113.9')
    expect(r.location.reasons).toEqual(['outside_geofence', 'gps_accuracy_insufficient'])
    expect(r.network.reasons).toEqual(['unauthorized_network'])
  })

  it('is not callable by authenticated users', async () => {
    await expect(asUser(db, USERS.sara, tx => tx.query(`select public.attendance_precheck($1, 0, 0, 1, '127.0.0.1')`, [EMPLOYEES.sara])))
      .rejects.toThrow(/permission denied/)
  })
})

describe('250 m geofence: distance and GPS accuracy are independent checks (PostGIS)', () => {
  // Spherical destination point, independent of PostGIS, for building test positions.
  const R = 6_371_008.8
  const rad = (x: number) => (x * Math.PI) / 180
  const deg = (x: number) => (x * 180) / Math.PI
  const dest = (meters: number, bearing: number) => {
    const p1 = rad(OFFICE.lat)
    const l1 = rad(OFFICE.lng)
    const b = rad(bearing)
    const d = meters / R
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
    return { lat: deg(p2), lng: deg(l2) }
  }
  const precheck = (p: { lat: number, lng: number }, accuracy: number) =>
    asService(db, tx => one<{ r: any }>(tx, `select public.attendance_precheck($1, $2, $3, $4, '127.0.0.1') as r`, [EMPLOYEES.sara, p.lat, p.lng, accuracy])).then(x => x.r.location)

  beforeAll(async () => {
    await asService(db, tx => tx.query(`update public.geofences set radius_m = 250, max_accuracy_m = 50`))
  })
  afterAll(async () => {
    await asService(db, tx => tx.query(`update public.geofences set radius_m = 100, max_accuracy_m = 50`))
  })

  it.each([
    [0, 0], [120, 0], [200, 90], [245, 180], [249, 270],
  ])('accepts %i m from the centre (bearing %i°) with a ±10 m reading', async (meters, bearing) => {
    const l = await precheck(dest(meters, bearing), 10)
    expect(l.passed).toBe(true)
    expect(l.radius_m).toBe(250)
    expect(Math.abs(l.distance_m - meters)).toBeLessThan(2)
  })

  it.each([[251, 0], [260, 45], [400, 90]])('rejects %i m (bearing %i°) as outside the area — not as an accuracy problem', async (meters, bearing) => {
    const l = await precheck(dest(meters, bearing), 10)
    expect(l.passed).toBe(false)
    expect(l.reasons).toEqual(['outside_geofence'])
  })

  it('accepts accuracy exactly at the limit and rejects just above it, at any distance', async () => {
    expect((await precheck(dest(0, 0), 50)).passed).toBe(true)
    const centre = await precheck(dest(0, 0), 50.5)
    expect(centre).toMatchObject({ passed: false, reasons: ['gps_accuracy_insufficient'] })
    expect(centre.distance_m).toBeLessThan(1)
  })

  it('reports both reasons when the reading is both imprecise and outside', async () => {
    expect((await precheck(dest(300, 0), 180)).reasons).toEqual(['outside_geofence', 'gps_accuracy_insufficient'])
  })

  it('the authoritative submission applies the same 250 m radius and accuracy limit', async () => {
    const inside = dest(240, 90)
    const ok = await submit(db, { employeeId: EMPLOYEES.sara, userId: USERS.sara, credentialId: saraCred, action: 'check_in', lat: inside.lat, lng: inside.lng, accuracy: 30 })
    expect(ok.ok).toBe(true)
    expect(Math.abs((ok.distance_m ?? 0) - 240)).toBeLessThan(2)
    const imprecise = await submit(db, { employeeId: EMPLOYEES.sara, userId: USERS.sara, credentialId: saraCred, action: 'check_out', lat: inside.lat, lng: inside.lng, accuracy: 120 })
    expect(imprecise.reasons).toEqual(['gps_accuracy_insufficient'])
  })
})
