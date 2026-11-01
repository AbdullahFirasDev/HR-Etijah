/**
 * public.rate_limit_hit(): shared rate-limit counters for serverless deployments
 * (NUXT_RATE_LIMIT_STORE=database) — atomic counting, windows, and backend-only access.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createTestDatabase, one } from './harness'
import { USERS } from './fixtures'

let db: PGlite

beforeAll(async () => {
  db = await createTestDatabase({ seed: true })
})
afterAll(async () => {
  await db?.close()
})

const hit = (key: string, windowSeconds = 900) =>
  asService(db, tx => one<{ n: number }>(tx, `select public.rate_limit_hit($1, $2) as n`, [key, windowSeconds])).then(r => r.n)

describe('rate_limit_hit', () => {
  it('counts hits per key within the window', async () => {
    expect(await hit('login-email:ali@etijah.local')).toBe(1)
    expect(await hit('login-email:ali@etijah.local')).toBe(2)
    expect(await hit('login-email:ali@etijah.local')).toBe(3)
    expect(await hit('login-email:sara@etijah.local')).toBe(1)
  })

  it('starts a new window once the previous one expired', async () => {
    await hit('login-ip:169.224.96.169')
    await hit('login-ip:169.224.96.169')
    await asService(db, tx => tx.query(`update public.rate_limit_counters set expires_at = now() - interval '1 second' where key = $1`, ['login-ip:169.224.96.169']))
    expect(await hit('login-ip:169.224.96.169')).toBe(1)
  })

  it('rejects invalid windows', async () => {
    await expect(hit('x', 0)).rejects.toThrow(/invalid rate-limit window/)
    await expect(hit('x', 86_401)).rejects.toThrow(/invalid rate-limit window/)
  })

  it('is backend-only: no access for employees or anonymous callers', async () => {
    for (const user of [USERS.ali, null]) {
      await expect(asUser(db, user, tx => tx.query(`select public.rate_limit_hit('login-email:x', 60)`))).rejects.toThrow(/permission denied/)
      await expect(asUser(db, user, tx => tx.query(`select * from public.rate_limit_counters`))).rejects.toThrow(/permission denied/)
    }
  })
})
