/**
 * Row Level Security, data isolation and authorisation inside workflow functions.
 * Each query runs as `authenticated` with the user's JWT claims (PostgREST semantics).
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createTestDatabase, one, rows } from './harness'
import { addCredential, EMPLOYEES, submit, USERS } from './fixtures'

let db: PGlite
let aliSession: string

beforeAll(async () => {
  db = await createTestDatabase({ seed: true })
  const aliCred = await addCredential(db, EMPLOYEES.ali, USERS.ali)
  const saraCred = await addCredential(db, EMPLOYEES.sara, USERS.sara)
  const a = await submit(db, { employeeId: EMPLOYEES.ali, userId: USERS.ali, credentialId: aliCred, action: 'check_in' })
  const s = await submit(db, { employeeId: EMPLOYEES.sara, userId: USERS.sara, credentialId: saraCred, action: 'check_in' })
  expect(a.ok && s.ok).toBe(true)
  aliSession = a.session_id!
})
afterAll(async () => {
  await db?.close()
})

const visibleEmployees = (user: string, table: string) =>
  asUser(db, user, tx => rows<{ employee_id: string }>(tx, `select distinct employee_id from public.${table} order by 1`))
    .then(r => r.map(x => x.employee_id))

describe('employee data isolation', () => {
  it('an employee sees only their own attendance', async () => {
    for (const table of ['attendance_events', 'attendance_sessions', 'verification_attempts']) {
      expect(await visibleEmployees(USERS.ali, table)).toEqual([EMPLOYEES.ali])
      expect(await visibleEmployees(USERS.sara, table)).toEqual([EMPLOYEES.sara])
    }
  })

  it('an employee cannot read other employees or profiles', async () => {
    const emps = await asUser(db, USERS.ali, tx => rows<{ id: string }>(tx, `select id from public.employees`))
    expect(emps.map(e => e.id)).toEqual([EMPLOYEES.ali])
    const profiles = await asUser(db, USERS.ali, tx => rows<{ id: string }>(tx, `select id from public.profiles`))
    expect(profiles.map(p => p.id)).toEqual([USERS.ali])
  })

  it('a department manager sees their department only', async () => {
    const seen = await visibleEmployees(USERS.manager, 'attendance_events')
    expect(seen).toContain(EMPLOYEES.ali)
    expect(seen).not.toContain(EMPLOYEES.sara)
    const emps = await asUser(db, USERS.manager, tx => rows<{ id: string }>(tx, `select id from public.employees order by 1`))
    expect(emps.map(e => e.id).sort()).toEqual([EMPLOYEES.manager, EMPLOYEES.ali, EMPLOYEES.night].sort())
  })

  it('a department manager cannot see security verification logs of their staff', async () => {
    expect(await visibleEmployees(USERS.manager, 'verification_attempts')).toEqual([])
  })

  it('HR sees the whole organisation', async () => {
    const seen = await visibleEmployees(USERS.hr, 'attendance_events')
    expect(seen).toEqual(expect.arrayContaining([EMPLOYEES.ali, EMPLOYEES.sara]))
  })

  it('anon sees nothing', async () => {
    await expect(asUser(db, null, tx => tx.query(`select * from public.employees`))).rejects.toThrow(/permission denied/)
  })

  it('the allowed network list is hidden from employees', async () => {
    const r = await asUser(db, USERS.ali, tx => rows(tx, `select * from public.allowed_networks`))
    expect(r).toEqual([])
    const hr = await asUser(db, USERS.hr, tx => rows(tx, `select * from public.allowed_networks`))
    expect(hr.length).toBeGreaterThan(0)
  })
})

describe('column and verb restrictions', () => {
  it('an employee can change their locale but not their role', async () => {
    await asUser(db, USERS.ali, tx => tx.query(`update public.profiles set locale = 'en' where id = $1`, [USERS.ali]))
    await expect(asUser(db, USERS.ali, tx => tx.query(`update public.profiles set role_id = 1 where id = $1`, [USERS.ali])))
      .rejects.toThrow(/permission denied/)
  })

  it('an employee cannot modify configuration', async () => {
    const r = await asUser(db, USERS.ali, tx => tx.query(`update public.geofences set radius_m = 5000`))
    expect(r.affectedRows).toBe(0)
    await expect(asUser(db, USERS.ali, tx => tx.query(`insert into public.allowed_networks (label, cidr) values ('home', '0.0.0.0/0')`)))
      .rejects.toThrow(/row-level security/)
  })

  it('a department manager cannot edit departments, HR can (and it is audited)', async () => {
    const m = await asUser(db, USERS.manager, tx => tx.query(`update public.departments set name_en = 'Ops' where code = 'OPS'`))
    expect(m.affectedRows).toBe(0)
    await asUser(db, USERS.hr, tx => tx.query(`update public.departments set name_en = 'Operations Dept' where code = 'OPS'`), { commit: true })
    const log = await one<{ actor_id: string, action: string }>(db,
      `select actor_id, action from public.audit_logs where entity_type = 'departments' order by id desc limit 1`)
    expect(log).toEqual({ actor_id: USERS.hr, action: 'update' })
  })

  it('only owners may grant privileged roles; nobody may change their own role', async () => {
    await expect(asUser(db, USERS.hr, tx => tx.query(`select public.set_user_role($1, 'owner')`, [USERS.ali]))).rejects.toThrow(/forbidden/)
    await expect(asUser(db, USERS.manager, tx => tx.query(`select public.set_user_role($1, 'department_manager')`, [USERS.ali]))).rejects.toThrow(/forbidden/)
    await expect(asUser(db, USERS.owner, tx => tx.query(`select public.set_user_role($1, 'employee')`, [USERS.owner]))).rejects.toThrow(/cannot_change_own_role/)
    const ok = await asUser(db, USERS.hr, tx => one<{ r: { role: string } }>(tx, `select public.set_user_role($1, 'department_manager') as r`, [USERS.sara]))
    expect(ok.r.role).toBe('department_manager')
  })
})

describe('attendance adjustments', () => {
  it('requires a reason', async () => {
    await expect(asUser(db, USERS.ali, tx => tx.query(
      `select public.request_attendance_adjustment($1, current_date, 'add_check_out', $2, null, null, now(), 'no')`,
      [EMPLOYEES.ali, aliSession]))).rejects.toThrow(/reason_required/)
  })

  it('an employee may request a correction for themselves but not for others', async () => {
    await expect(asUser(db, USERS.ali, tx => tx.query(
      `select public.request_attendance_adjustment($1, current_date, 'add_interval', null, null, now() - interval '3 hours', now() - interval '2 hours', 'Forgot to check in')`,
      [EMPLOYEES.sara]))).rejects.toThrow(/forbidden/)
  })

  it('cannot be approved by the employee, nor by a manager without attendance.adjust; HR applies it', async () => {
    const { id } = await asUser(db, USERS.ali, tx => one<{ id: string }>(tx,
      `select public.request_attendance_adjustment($1, (select work_date from public.attendance_sessions where id = $2), 'add_check_out', $2, null, null, now(), 'Phone battery died at end of day') as id`,
      [EMPLOYEES.ali, aliSession]), { commit: true })
    await expect(asUser(db, USERS.ali, tx => tx.query(`select public.review_attendance_adjustment($1, true, null)`, [id]))).rejects.toThrow(/forbidden/)
    await expect(asUser(db, USERS.manager, tx => tx.query(`select public.review_attendance_adjustment($1, true, null)`, [id]))).rejects.toThrow(/forbidden/)
    const r = await asUser(db, USERS.hr, tx => one<{ r: { status: string } }>(tx, `select public.review_attendance_adjustment($1, true, 'ok') as r`, [id]), { commit: true })
    expect(r.r.status).toBe('approved')
    const s = await one<{ status: string, closed_by: string }>(db, `select status, closed_by from public.attendance_sessions where id = $1`, [aliSession])
    expect(s).toEqual({ status: 'closed', closed_by: 'adjustment' })
    // the original check-in event is untouched; a new adjustment-sourced event was appended
    const ev = await rows<{ source: string }>(db, `select source from public.attendance_events where session_id = $1 order by occurred_at`, [aliSession])
    expect(ev.map(e => e.source)).toEqual(['employee', 'adjustment'])
  })

  it('HR cannot approve corrections to their own attendance', async () => {
    const { id } = await asUser(db, USERS.hr, tx => one<{ id: string }>(tx,
      `select public.request_attendance_adjustment($1, current_date - 1, 'add_interval', null, null, now() - interval '30 hours', now() - interval '26 hours', 'Worked at client site') as id`,
      [EMPLOYEES.hr]), { commit: true })
    await expect(asUser(db, USERS.hr, tx => tx.query(`select public.review_attendance_adjustment($1, true, null)`, [id]))).rejects.toThrow(/self_approval_forbidden/)
  })

  it('locked payroll periods refuse new corrections', async () => {
    await asUser(db, USERS.hr, tx => tx.query(`select public.set_period_lock(2025, 12, true)`), { commit: true })
    await expect(asUser(db, USERS.ali, tx => tx.query(
      `select public.request_attendance_adjustment($1, '2025-12-10', 'add_interval', null, null, '2025-12-10 05:00Z', '2025-12-10 13:00Z', 'Forgot to check in')`,
      [EMPLOYEES.ali]))).rejects.toThrow(/period_locked/)
    await expect(asUser(db, USERS.manager, tx => tx.query(`select public.set_period_lock(2025, 11, true)`))).rejects.toThrow(/forbidden/)
  })
})

describe('leave approvals', () => {
  const createLeave = (employeeId: string, start: string, end: string, days: number, code = 'annual') =>
    asService(db, tx => one<{ id: string }>(tx, `
      insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, reason)
      values ($1, (select id from public.leave_types where code = $5), $2, $3, $4, 'Family matter') returning id`,
    [employeeId, start, end, days, code]))

  it('a department manager approves leave in their department only', async () => {
    const aliLeave = await createLeave(EMPLOYEES.ali, '2026-11-15', '2026-11-16', 2)
    const saraLeave = await createLeave(EMPLOYEES.sara, '2026-11-15', '2026-11-16', 2)
    const r = await asUser(db, USERS.manager, tx => one<{ r: { status: string } }>(tx, `select public.review_leave_request($1, true, null) as r`, [aliLeave.id]), { commit: true })
    expect(r.r.status).toBe('approved')
    await expect(asUser(db, USERS.manager, tx => tx.query(`select public.review_leave_request($1, true, null)`, [saraLeave.id]))).rejects.toThrow(/forbidden/)
  })

  it('an employee cannot approve their own leave', async () => {
    const own = await createLeave(EMPLOYEES.ali, '2026-12-01', '2026-12-01', 1)
    await expect(asUser(db, USERS.ali, tx => tx.query(`select public.review_leave_request($1, true, null)`, [own.id]))).rejects.toThrow(/forbidden/)
  })

  it('refuses approval beyond the remaining balance', async () => {
    const big = await createLeave(EMPLOYEES.night, '2026-12-10', '2026-12-31', 40)
    await expect(asUser(db, USERS.hr, tx => tx.query(`select public.review_leave_request($1, true, null)`, [big.id]))).rejects.toThrow(/insufficient_leave_balance/)
  })

  it('prevents overlapping leave requests', async () => {
    await expect(createLeave(EMPLOYEES.ali, '2026-11-16', '2026-11-17', 2)).rejects.toThrow(/leave_requests_no_overlap/)
  })

  it('two-step flow: manager approval is intermediate, HR approval is final', async () => {
    await asService(db, tx => tx.query(`update public.org_settings set leave_approval_flow = 'two_step' where id = 1`))
    const req = await createLeave(EMPLOYEES.ali, '2026-12-20', '2026-12-21', 2)
    const m = await asUser(db, USERS.manager, tx => one<{ r: { status: string } }>(tx, `select public.review_leave_request($1, true, null) as r`, [req.id]), { commit: true })
    expect(m.r.status).toBe('manager_approved')
    const h = await asUser(db, USERS.hr, tx => one<{ r: { status: string } }>(tx, `select public.review_leave_request($1, true, null) as r`, [req.id]), { commit: true })
    expect(h.r.status).toBe('approved')
  })

  it('reports balances only to permitted readers', async () => {
    const own = await asUser(db, USERS.ali, tx => rows<{ code: string, used_days: string }>(tx, `select code, used_days from public.leave_balances_for($1, 2026)`, [EMPLOYEES.ali]))
    expect(own.find(b => b.code === 'annual')?.used_days).toBe('4.0')
    await expect(asUser(db, USERS.sara, tx => tx.query(`select * from public.leave_balances_for($1, 2026)`, [EMPLOYEES.ali]))).rejects.toThrow(/forbidden/)
  })
})

describe('device approval', () => {
  it('employees cannot activate their own device; HR can; limits apply', async () => {
    const pending = await addCredential(db, EMPLOYEES.ali, USERS.ali, 'pending')
    await expect(asUser(db, USERS.ali, tx => tx.query(`select public.set_credential_status($1, 'active', null)`, [pending]))).rejects.toThrow(/forbidden/)
    const ok = await asUser(db, USERS.hr, tx => one<{ r: { status: string } }>(tx, `select public.set_credential_status($1, 'active', null) as r`, [pending]), { commit: true })
    expect(ok.r.status).toBe('active')
    const third = await addCredential(db, EMPLOYEES.ali, USERS.ali, 'pending')
    await expect(asUser(db, USERS.hr, tx => tx.query(`select public.set_credential_status($1, 'active', null)`, [third]))).rejects.toThrow(/device_limit_reached/)
  })

  it('employees can revoke their own device', async () => {
    const cred = await addCredential(db, EMPLOYEES.sara, USERS.sara)
    const r = await asUser(db, USERS.sara, tx => one<{ r: { status: string } }>(tx, `select public.set_credential_status($1, 'revoked', 'lost phone') as r`, [cred]), { commit: true })
    expect(r.r.status).toBe('revoked')
  })
})
