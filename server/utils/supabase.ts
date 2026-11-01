import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const

let service: SupabaseClient | null = null

/**
 * Service-role client (bypasses RLS). Server-only; never sent to the browser.
 * Pass `actor` so database audit triggers attribute the change to the acting user.
 */
export function serviceDb(actor?: { userId: string, ip?: string | null }): SupabaseClient {
  const c = serverConfig()
  if (!actor) {
    service ??= createClient(c.supabaseUrl, c.supabaseServiceRoleKey, { auth: noSession })
    return service
  }
  return createClient(c.supabaseUrl, c.supabaseServiceRoleKey, {
    auth: noSession,
    global: { headers: { 'x-actor-id': actor.userId, 'x-client-ip': actor.ip ?? '' } },
  })
}

/** Client acting AS the signed-in user: every query is filtered by Row Level Security. */
export function userDb(accessToken: string): SupabaseClient {
  const c = serverConfig()
  return createClient(c.supabaseUrl, c.supabaseAnonKey, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/** Unauthenticated client used for password sign-in / recovery flows. */
export function authDb(): SupabaseClient {
  const c = serverConfig()
  return createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: noSession })
}

/** Postgres bytea (hex "\x…") ⇄ bytes */
export function byteaToBytes(value: string): Uint8Array {
  const hex = value.startsWith('\\x') ? value.slice(2) : value
  return new Uint8Array(Buffer.from(hex, 'hex'))
}
export function bytesToBytea(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString('hex')}`
}
