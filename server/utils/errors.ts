import { createError, type H3Error } from 'h3'

/** API error with a stable machine-readable `code` (translated by the client). */
export function apiError(statusCode: number, code: string, data: Record<string, unknown> = {}): H3Error {
  return createError({ statusCode, statusMessage: code, message: code, data: { code, ...data } })
}

interface PgLikeError {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const SAFE_TOKEN = /^[a-z][a-z0-9_]{2,60}$/

/**
 * Map a PostgREST / Postgres error to an HTTP error without leaking internals.
 * Our SECURITY DEFINER functions raise snake_case tokens (e.g. "self_approval_forbidden"),
 * which are safe to return; anything else becomes a generic code.
 */
export function dbError(error: PgLikeError, fallback = 'database_error'): H3Error {
  const msg = (error.message ?? '').trim()
  const token = SAFE_TOKEN.test(msg) ? msg : null
  switch (error.code) {
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return apiError(401, 'session_expired') // Supabase JWT expired/invalid
    case '42501':
      return apiError(403, token ?? 'forbidden')
    case 'P0002':
    case 'PGRST116':
      return apiError(404, token ?? 'not_found')
    case '22023':
    case '22P02':
    case '23514':
    case '23502':
      return apiError(422, token ?? 'invalid_input')
    case 'P0001':
      return apiError(409, token ?? 'conflict')
    case '23P01':
      return apiError(409, token ?? 'overlap')
    case '23505':
      return apiError(409, 'duplicate')
    case '23503':
      return apiError(409, 'in_use')
    default:
      console.error('[db]', error.code, msg, error.details ?? '')
      return apiError(500, fallback)
  }
}

/** Unwrap a supabase-js result or throw a mapped API error. */
export function unwrap<R extends { data: unknown, error: PgLikeError | null }>(result: R, fallback?: string): NonNullable<R['data']> {
  if (result.error) {
    throw dbError(result.error, fallback)
  }
  return result.data as NonNullable<R['data']>
}
