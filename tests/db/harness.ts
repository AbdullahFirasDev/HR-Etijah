/**
 * In-process Postgres (PGlite + PostGIS) harness for database tests.
 *
 * It recreates the small part of the Supabase runtime the migrations depend on:
 *   - roles anon / authenticated / service_role (service_role has BYPASSRLS, as in Supabase)
 *   - auth.users and auth.uid() / auth.role() / auth.jwt(), reading `request.jwt.claims`
 *     exactly like Supabase's implementation
 * then applies every file in supabase/migrations in order. Tests impersonate users with
 * `asUser()` (SET LOCAL ROLE authenticated + JWT claims), which is how PostgREST executes
 * requests, so RLS policies and SECURITY DEFINER functions are exercised for real.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { postgis } from '@electric-sql/pglite-postgis'

const ROOT = resolve(import.meta.dirname, '../..')

const SUPABASE_SHIM = /* sql */ `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table auth.identities (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
`

export function migrationFiles(): string[] {
  const dir = join(ROOT, 'supabase', 'migrations')
  return readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => join(dir, f))
}

export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { postgis, btree_gist, pgcrypto } })
  await db.exec(SUPABASE_SHIM)
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, 'utf8'))
    }
    catch (error) {
      throw new Error(`Migration failed: ${file}\n${(error as Error).message}`)
    }
  }
  if (options.seed) {
    await db.exec(readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8'))
  }
  return db
}

type Executor = PGlite | Transaction

/** Run `fn` inside a transaction impersonating an authenticated user (PostgREST semantics). Always rolled back unless `commit`. */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
  opts: { role?: 'authenticated' | 'anon' | 'service_role', commit?: boolean, headers?: Record<string, string> } = {},
): Promise<T> {
  const role = opts.role ?? (userId ? 'authenticated' : 'anon')
  return db.transaction(async (tx) => {
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role })
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
    await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(opts.headers ?? {})])
    await tx.exec(`set local role ${role}`)
    try {
      const result = await fn(tx)
      if (!opts.commit) {
        await tx.rollback()
      }
      return result
    }
    catch (error) {
      if (!tx.closed) {
        await tx.rollback()
      }
      throw error
    }
  })
}

/** Run as the trusted backend (service_role JWT). */
export function asService<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>, opts: { commit?: boolean, actorId?: string } = {}) {
  return asUser(db, null, fn, {
    role: 'service_role',
    commit: opts.commit ?? true,
    headers: opts.actorId ? { 'x-actor-id': opts.actorId, 'x-client-ip': '10.0.0.1' } : {},
  })
}

export async function rows<T = Record<string, unknown>>(ex: Executor, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await ex.query<T>(sql, params)
  return res.rows
}

export async function one<T = Record<string, unknown>>(ex: Executor, sql: string, params: unknown[] = []): Promise<T> {
  const r = await rows<T>(ex, sql, params)
  if (r.length !== 1) {
    throw new Error(`Expected exactly one row, got ${r.length}: ${sql}`)
  }
  return r[0]!
}
