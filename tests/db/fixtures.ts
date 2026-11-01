import type { PGlite, Transaction } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { asService, one } from './harness'

/** Fixed identifiers from supabase/seed.sql */
export const USERS = {
  owner: '00000000-0000-4000-a000-000000000001',
  hr: '00000000-0000-4000-a000-000000000002',
  manager: '00000000-0000-4000-a000-000000000003',
  ali: '00000000-0000-4000-a000-000000000004',
  sara: '00000000-0000-4000-a000-000000000005',
  night: '00000000-0000-4000-a000-000000000006',
} as const

export const EMPLOYEES = {
  hr: '10000000-0000-4000-a000-000000000002',
  manager: '10000000-0000-4000-a000-000000000003',
  ali: '10000000-0000-4000-a000-000000000004',
  sara: '10000000-0000-4000-a000-000000000005',
  night: '10000000-0000-4000-a000-000000000006',
} as const

export const OFFICE = { lat: 32.0259, lng: 44.3462 }
/** The seed's allow-listed office public IP (documentation range) */
export const OFFICE_IP = '203.0.113.10'
/** ~33 m north of the office centre (inside the 100 m fence) */
export const INSIDE = { lat: 32.0262, lng: 44.3462 }
/** ~220 m north of the office centre (outside the fence) */
export const OUTSIDE = { lat: 32.0279, lng: 44.3462 }

export async function addCredential(db: PGlite, employeeId: string, userId: string, status: 'active' | 'pending' = 'active'): Promise<string> {
  return asService(db, async (tx) => {
    const r = await one<{ id: string }>(tx, `
      insert into public.webauthn_credentials (employee_id, user_id, credential_id, public_key, status, approved_at)
      values ($1, $2, $3, '\\x00'::bytea, $4::public.credential_status, case when $4 = 'active' then now() end)
      returning id`, [employeeId, userId, randomUUID().replaceAll('-', ''), status])
    return r.id
  })
}

export async function createChallenge(
  db: PGlite,
  userId: string,
  action: string,
  opts: { consume?: boolean, expired?: boolean } = {},
): Promise<string> {
  return asService(db, async (tx) => {
    const r = await one<{ id: string }>(tx, `
      insert into public.webauthn_challenges (user_id, purpose, action, challenge, created_at, expires_at)
      values ($1, 'attendance', $2::public.attendance_event_type, $3,
              now() - case when $4 then interval '5 minutes' else interval '0' end,
              now() + case when $4 then interval '-1 minute' else interval '90 seconds' end)
      returning id`, [userId, action, randomUUID(), opts.expired ?? false])
    if (opts.consume ?? true) {
      await tx.query(`select public.consume_webauthn_challenge($1, $2, 'attendance', $3::public.attendance_event_type)`, [r.id, userId, action])
    }
    return r.id
  })
}

export interface SubmitOptions {
  employeeId: string
  userId: string
  action: 'check_in' | 'check_out' | 'break_start' | 'break_end'
  credentialId: string
  challengeId?: string
  webauthnVerified?: boolean
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
  positionAgeSeconds?: number
  ip?: string | null
  idempotencyKey?: string
  riskScore?: number
}

export interface SubmitResult {
  ok: boolean
  duplicate?: boolean
  reasons?: string[]
  event_id?: string
  session_id?: string
  work_date?: string
  distance_m?: number
  checks?: { geofence: boolean, network: boolean, webauthn: boolean }
}

export async function submit(db: PGlite, o: SubmitOptions): Promise<SubmitResult> {
  const challengeId = o.challengeId ?? await createChallenge(db, o.userId, o.action)
  return asService(db, async (tx: Transaction) => {
    const r = await one<{ r: SubmitResult }>(tx, `
      select public.record_attendance_event(
        p_employee_id => $1, p_event_type => $2::public.attendance_event_type, p_idempotency_key => $3,
        p_challenge_id => $4, p_credential_id => $5, p_webauthn_verified => $6,
        p_latitude => $7, p_longitude => $8, p_accuracy_m => $9,
        p_position_captured_at => now() - make_interval(secs => $10), p_client_ip => $11::inet,
        p_risk_score => $12) as r`, [
      o.employeeId, o.action, o.idempotencyKey ?? randomUUID(), challengeId, o.credentialId,
      o.webauthnVerified ?? true,
      o.lat === undefined ? INSIDE.lat : o.lat,
      o.lng === undefined ? INSIDE.lng : o.lng,
      o.accuracy === undefined ? 15 : o.accuracy,
      o.positionAgeSeconds ?? 2,
      o.ip === undefined ? OFFICE_IP : o.ip,
      o.riskScore ?? 0,
    ])
    return r.r
  })
}
