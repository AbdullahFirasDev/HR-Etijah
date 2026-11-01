<script setup lang="ts">
const auth = useAuth()
const { t } = useI18n()
const route = useRoute()

const tabs = computed(() => [
  { to: '/', icon: 'i-lucide-fingerprint', label: t('nav.attendance') },
  { to: '/history', icon: 'i-lucide-calendar-days', label: t('nav.history') },
  { to: '/leave', icon: 'i-lucide-plane', label: t('nav.leave') },
  { to: '/reports', icon: 'i-lucide-chart-column', label: t('nav.reports') },
  { to: '/profile', icon: 'i-lucide-user-round', label: t('nav.profile') },
])
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
</script>

<template>
  <div class="min-h-dvh bg-muted/40">
    <header class="safe-top sticky top-0 z-40 border-b border-default bg-default/90 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-2xl items-center justify-between gap-2 px-4">
        <NuxtLink to="/" class="min-w-0">
          <AppLogo compact class="sm:hidden" />
          <AppLogo class="hidden sm:flex" />
        </NuxtLink>
        <div class="flex items-center gap-1">
          <SessionTimer />
          <UButton v-if="auth.isAdmin.value" to="/admin" color="neutral" variant="ghost" icon="i-lucide-layout-dashboard" :aria-label="t('nav.admin')" />
          <NotificationBell />
          <LanguageToggle />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-2xl px-4 pb-28 pt-4">
      <slot />
    </main>

    <nav class="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-default bg-default/95 backdrop-blur" :aria-label="t('nav.main')">
      <ul class="mx-auto grid max-w-2xl grid-cols-5">
        <li v-for="tab in tabs" :key="tab.to">
          <NuxtLink
            :to="tab.to"
            class="flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors"
            :class="isActive(tab.to) ? 'text-primary' : 'text-muted hover:text-default'"
            :aria-current="isActive(tab.to) ? 'page' : undefined"
          >
            <UIcon :name="tab.icon" class="size-6" />
            {{ tab.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
