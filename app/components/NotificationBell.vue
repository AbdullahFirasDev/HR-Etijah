<script setup lang="ts">
const { t } = useI18n()
const api = useApi()
const unread = useState('notifications.unread', () => 0)

async function poll() {
  try {
    // passive: polling must never extend the login session
    const r = await api<{ unread: number }>('/api/notifications', { query: { passive: '1' } })
    unread.value = r.unread
  }
  catch {}
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll()
  timer = setInterval(poll, 60_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <UChip :show="unread > 0" :text="unread > 9 ? '9+' : unread" color="error" size="lg" inset>
    <UButton to="/notifications" color="neutral" variant="ghost" icon="i-lucide-bell" :aria-label="t('nav.notifications')" />
  </UChip>
</template>
