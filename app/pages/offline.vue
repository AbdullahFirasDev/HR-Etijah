<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const online = useOnline()
const auth = useAuth()
async function retry() {
  await auth.refresh()
  await navigateTo(auth.user.value ? (auth.user.value.employee ? '/' : '/admin') : '/login')
}
watch(online, (v) => {
  if (v) retry()
})
</script>

<template>
  <UCard class="text-center">
    <UIcon name="i-lucide-wifi-off" class="mx-auto mb-3 size-12 text-warning" />
    <h1 class="mb-2 text-xl font-bold">
      {{ t('offline.title') }}
    </h1>
    <p class="mb-4 text-sm text-muted">
      {{ t('offline.body') }}
    </p>
    <UButton block icon="i-lucide-refresh-cw" :label="t('common.retry')" @click="retry" />
  </UCard>
</template>
