<script setup lang="ts">
const props = defineProps<{ status: string, size?: 'sm' | 'md' | 'lg' }>()
const { t } = useI18n()
const colors: Record<string, 'success' | 'error' | 'info' | 'warning' | 'neutral' | 'primary'> = {
  present: 'success',
  in_progress: 'primary',
  absent: 'error',
  on_leave: 'info',
  holiday: 'info',
  day_off: 'neutral',
  missing_checkout: 'warning',
  scheduled: 'neutral',
  pending: 'warning',
  manager_approved: 'info',
  approved: 'success',
  rejected: 'error',
  cancelled: 'neutral',
  active: 'success',
  revoked: 'error',
  accepted: 'success',
}
</script>

<template>
  <UBadge :color="colors[props.status] ?? 'neutral'" variant="subtle" :size="size ?? 'md'">
    {{ t(`status.${props.status}`) }}
  </UBadge>
</template>
