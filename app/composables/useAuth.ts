import type { Permission, RoleKey, RoleScope } from '#shared/constants'

export interface SessionUser {
  id: string
  email: string
  fullName: string
  fullNameEn: string | null
  locale: 'ar' | 'en'
  role: RoleKey
  scope: RoleScope
  permissions: Permission[]
  employee: { id: string, departmentId: string | null, officeId: string | null, employeeCode: string, status: string } | null
  mustChangePassword: boolean
}

interface SessionResponse {
  authenticated: boolean
  reason?: string | null
  user?: SessionUser
  session?: { expiresAt: string, absoluteExpiresAt: string, serverTime: string }
}

const ADMIN_PERMISSIONS: Permission[] = ['employees.read', 'attendance.read', 'reports.view', 'settings.manage', 'devices.manage', 'security.read', 'leave.approve']

export function useAuth() {
  const user = useState<SessionUser | null>('auth.user', () => null)
  const initialized = useState('auth.initialized', () => false)
  const offline = useState('auth.offline', () => false)
  const expiresAt = useState<number | null>('auth.expiresAt', () => null)
  const absoluteExpiresAt = useState<number | null>('auth.absoluteExpiresAt', () => null)
  const clockSkew = useState('auth.skew', () => 0) // server time − client time (ms)
  const endReason = useState<string | null>('auth.endReason', () => null)

  const can = (p: Permission) => !!user.value && (user.value.role === 'owner' || user.value.permissions.includes(p))
  const isAdmin = computed(() => !!user.value && (user.value.role !== 'employee' || ADMIN_PERMISSIONS.some(can)))
  const displayName = computed(() => {
    if (!user.value) return ''
    const { locale } = useNuxtApp().$i18n
    return locale.value === 'en' ? (user.value.fullNameEn || user.value.fullName) : user.value.fullName
  })

  function applySession(r: SessionResponse) {
    if (r.authenticated && r.user && r.session) {
      user.value = r.user
      clockSkew.value = Date.parse(r.session.serverTime) - Date.now()
      expiresAt.value = Date.parse(r.session.expiresAt)
      absoluteExpiresAt.value = Date.parse(r.session.absoluteExpiresAt)
      endReason.value = null
    }
    else {
      user.value = null
      expiresAt.value = null
      absoluteExpiresAt.value = null
      if (r.reason) endReason.value = r.reason
    }
  }

  async function refresh(): Promise<void> {
    try {
      applySession(await useApi()<SessionResponse>('/api/auth/session'))
      offline.value = false
    }
    catch (e) {
      if (apiErrorCode(e) === 'network_error') offline.value = true
      user.value = null
    }
    finally {
      initialized.value = true
    }
  }

  async function login(email: string, password: string) {
    const r = await useApi()<{ mustChangePassword: boolean, locale: 'ar' | 'en' }>('/api/auth/login', { method: 'POST', body: { email, password } })
    await refresh()
    return r
  }

  async function logout() {
    try {
      await useApi()('/api/auth/logout', { method: 'POST' })
    }
    finally {
      applySession({ authenticated: false })
      await navigateTo('/login')
    }
  }

  function noteExpiry(iso: string) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t)) expiresAt.value = t
  }

  function handleSessionEnd(reason: 'expired' | 'unauthenticated') {
    if (!user.value) return
    applySession({ authenticated: false, reason })
    const route = useRoute()
    navigateTo({ path: '/login', query: { reason, redirect: route.fullPath } })
  }

  /** Milliseconds left in the session per the server clock. */
  function remainingMs(): number | null {
    if (!expiresAt.value) return null
    return expiresAt.value - (Date.now() + clockSkew.value)
  }

  return { user, initialized, offline, expiresAt, absoluteExpiresAt, endReason, can, isAdmin, displayName, refresh, login, logout, noteExpiry, handleSessionEnd, remainingMs }
}
