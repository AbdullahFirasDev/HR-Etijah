import type { FetchError } from 'ofetch'

let instance: typeof $fetch | null = null

/**
 * The single HTTP client: same-origin, CSRF header, session-expiry tracking, and global
 * handling of expired sessions. There is deliberately no retry/offline queue — attendance
 * must be verified online in real time.
 */
export function useApi(): typeof $fetch {
  if (instance) {
    return instance
  }
  instance = $fetch.create({
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'hr-app' },
    retry: 0,
    onResponse({ response }) {
      const expires = response.headers.get('x-session-expires')
      if (expires) {
        useAuth().noteExpiry(expires)
      }
    },
    onResponseError({ request, response }) {
      const url = typeof request === 'string' ? request : request.url
      if (response.status === 401 && !url.includes('/api/auth/')) {
        useAuth().handleSessionEnd(response._data?.data?.code === 'session_expired' ? 'expired' : 'unauthenticated')
      }
      if (response.status === 403 && response._data?.data?.code === 'password_change_required') {
        navigateTo('/auth/change-password')
      }
    },
  }) as typeof $fetch
  return instance
}

/** Stable machine-readable error code from an API error. */
export function apiErrorCode(error: unknown): string {
  const e = error as FetchError
  if (e?.name === 'FetchError' && !e.response) {
    return 'network_error'
  }
  return e?.data?.data?.code ?? e?.data?.statusMessage ?? 'generic'
}

/** Translated message for an API error. */
export function useApiError() {
  const { t, te } = useI18n()
  return (error: unknown) => {
    const code = apiErrorCode(error)
    return te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')
  }
}
