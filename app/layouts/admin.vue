<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import type { Permission } from '#shared/constants'

const auth = useAuth()
const { t, locale } = useI18n()
const open = ref(false)

interface Item extends NavigationMenuItem { perm?: Permission | Permission[] }
const allowed = (i: Item) => !i.perm || (Array.isArray(i.perm) ? i.perm.some(auth.can) : auth.can(i.perm))

const groups = computed<NavigationMenuItem[][]>(() => {
  const main: Item[] = [
    { label: t('admin.nav.dashboard'), icon: 'i-lucide-layout-dashboard', to: '/admin', exact: true, perm: ['attendance.read', 'reports.view'] },
    { label: t('admin.nav.attendance'), icon: 'i-lucide-clipboard-check', to: '/admin/attendance', perm: 'attendance.read' },
    { label: t('admin.nav.employees'), icon: 'i-lucide-users', to: '/admin/employees', perm: 'employees.read' },
    { label: t('admin.nav.leave'), icon: 'i-lucide-plane', to: '/admin/leave', perm: 'leave.read' },
    { label: t('admin.nav.reports'), icon: 'i-lucide-chart-column', to: '/admin/reports', perm: 'reports.view' },
    { label: t('admin.nav.devices'), icon: 'i-lucide-smartphone', to: '/admin/devices', perm: 'devices.manage' },
    { label: t('admin.nav.security'), icon: 'i-lucide-shield-alert', to: '/admin/security', perm: ['security.read', 'audit.read'] },
  ]
  const config: Item[] = [
    { label: t('admin.nav.departments'), icon: 'i-lucide-building-2', to: '/admin/departments', perm: 'employees.read' },
    { label: t('admin.nav.shifts'), icon: 'i-lucide-clock', to: '/admin/shifts', perm: 'schedules.manage' },
    { label: t('admin.nav.holidays'), icon: 'i-lucide-calendar-heart', to: '/admin/holidays', perm: 'holidays.manage' },
    { label: t('admin.nav.location'), icon: 'i-lucide-map-pin', to: '/admin/settings/location', perm: 'settings.manage' },
    { label: t('admin.nav.network'), icon: 'i-lucide-network', to: '/admin/settings/network', perm: 'settings.manage' },
    { label: t('admin.nav.policy'), icon: 'i-lucide-sliders-horizontal', to: '/admin/settings/policy', perm: 'settings.manage' },
    { label: t('admin.nav.roles'), icon: 'i-lucide-key-round', to: '/admin/settings/roles', perm: 'roles.manage' },
  ]
  const strip = (i: Item): NavigationMenuItem => ({ label: i.label, icon: i.icon, to: i.to, exact: i.exact, onSelect: () => (open.value = false) })
  return [main.filter(allowed).map(strip), config.filter(allowed).map(strip)]
})
</script>

<template>
  <UDashboardGroup unit="rem" storage="local">
    <UDashboardSidebar
      v-model:open="open"
      collapsible
      resizable
      :side="locale === 'ar' ? 'right' : 'left'"
      class="bg-elevated/30"
      :ui="{ footer: 'border-t border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink to="/admin" class="flex items-center">
          <AppLogo :compact="collapsed" />
        </NuxtLink>
      </template>
      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="groups[0]" orientation="vertical" tooltip popover />
        <p v-if="!collapsed && groups[1]?.length" class="mt-4 px-2.5 text-xs font-semibold uppercase text-dimmed">
          {{ t('admin.nav.configuration') }}
        </p>
        <UNavigationMenu :collapsed="collapsed" :items="groups[1]" orientation="vertical" tooltip popover />
      </template>
      <template #footer="{ collapsed }">
        <div class="flex w-full flex-col gap-1">
          <UButton v-if="auth.user.value?.employee" to="/" color="neutral" variant="ghost" icon="i-lucide-fingerprint" :label="collapsed ? undefined : t('nav.myAttendance')" block class="justify-start" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-log-out" :label="collapsed ? undefined : t('auth.logout')" block class="justify-start" @click="auth.logout()" />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
