import type { Permission } from '#shared/constants'

const PUBLIC = new Set(['/login', '/auth/forgot', '/auth/reset', '/offline'])

declare module '#app' {
  interface PageMeta {
    permission?: Permission | Permission[]
    employeeOnly?: boolean
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth()
  if (!auth.initialized.value) {
    await auth.refresh()
  }
  const user = auth.user.value

  if (PUBLIC.has(to.path)) {
    if (user && to.path === '/login') {
      return navigateTo(user.employee ? '/' : '/admin')
    }
    return
  }
  if (!user) {
    if (auth.offline.value) {
      return navigateTo('/offline')
    }
    return navigateTo({ path: '/login', query: { redirect: to.fullPath, ...(auth.endReason.value ? { reason: 'expired' } : {}) } })
  }
  if (user.mustChangePassword && to.path !== '/auth/change-password') {
    return navigateTo('/auth/change-password')
  }
  if (to.path === '/' && !user.employee) {
    return navigateTo('/admin')
  }
  if (to.meta.employeeOnly && !user.employee) {
    return navigateTo('/admin')
  }
  if (to.path.startsWith('/admin') && !auth.isAdmin.value) {
    return navigateTo('/')
  }
  const perm = to.meta.permission
  if (perm && !(Array.isArray(perm) ? perm.some(auth.can) : auth.can(perm))) {
    return navigateTo(to.path.startsWith('/admin') ? '/admin' : '/')
  }
})
