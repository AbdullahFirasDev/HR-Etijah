import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDatabase, rows } from './harness'

describe('migrations', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createTestDatabase()
  })
  afterAll(async () => {
    await db?.close()
  })

  it('apply cleanly and enable RLS on every public table', async () => {
    const missing = await rows<{ tablename: string }>(db, `
      select c.relname as tablename
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(missing).toEqual([])
  })

  it('installs PostGIS in the extensions schema, not public', async () => {
    const ext = await rows<{ extname: string, nspname: string }>(db, `
      select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
       where e.extname in ('postgis', 'btree_gist') order by 1`)
    expect(ext).toEqual([
      { extname: 'btree_gist', nspname: 'extensions' },
      { extname: 'postgis', nspname: 'extensions' },
    ])
  })

  it('grants nothing to anon on public tables', async () => {
    const grants = await rows(db, `
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`)
    expect(grants).toEqual([])
  })
})

describe('development seed', () => {
  it('loads on top of the migrations', async () => {
    const db = await createTestDatabase({ seed: true })
    const [{ count }] = await rows<{ count: number }>(db, 'select count(*)::int as count from public.employees')
    expect(count).toBe(5)
    await db.close()
  })
})
