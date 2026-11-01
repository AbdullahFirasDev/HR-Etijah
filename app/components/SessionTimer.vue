<script setup lang="ts">
/**
 * Shows the time left in the 10-minute login session (per the server clock) and ends the
 * session locally the moment it expires. It never extends the session.
 */
const auth = useAuth()
const { t } = useI18n()
const toast = useToast()
const remaining = ref<number | null>(auth.remainingMs())
let warned = false
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(async () => {
    remaining.value = auth.remainingMs()
    if (remaining.value === null) return
    if (remaining.value <= 60_000 && !warned && remaining.value > 0) {
      warned = true
      toast.add({ title: t('session.expiringTitle'), description: t('session.expiringBody'), color: 'warning', icon: 'i-lucide-timer' })
    }
    if (remaining.value <= 0) {
      clearInterval(timer)
      await auth.refresh() // confirm with the server, then leave
      if (!auth.user.value) {
        await navigateTo({ path: '/login', query: { reason: 'expired' } })
      }
    }
  }, 1000)
})
onBeforeUnmount(() => clearInterval(timer))

const label = computed(() => {
  if (remaining.value === null) return ''
  const s = Math.max(0, Math.floor(remaining.value / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
</script>

<template>
  <UTooltip v-if="remaining !== null" :text="t('session.tooltip')">
    <UBadge
      :color="remaining <= 60_000 ? 'error' : remaining <= 180_000 ? 'warning' : 'neutral'"
      variant="subtle"
      icon="i-lucide-timer"
      class="ltr-nums tabular-nums"
      :aria-label="t('session.remaining', { time: label })"
    >
      {{ label }}
    </UBadge>
  </UTooltip>
</template>
