<script setup lang="ts">
/** Standard admin page frame: navbar with title + session/notifications, scrollable body. */
defineProps<{ title: string, id?: string }>()
const auth = useAuth()
</script>

<template>
  <UDashboardPanel :id="id ?? title">
    <template #header>
      <UDashboardNavbar :title="title">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <slot name="actions" />
          <SessionTimer />
          <NotificationBell />
          <LanguageToggle />
          <UTooltip :text="auth.displayName.value">
            <UAvatar :alt="auth.displayName.value" size="sm" />
          </UTooltip>
        </template>
      </UDashboardNavbar>
      <slot name="toolbar" />
    </template>
    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
