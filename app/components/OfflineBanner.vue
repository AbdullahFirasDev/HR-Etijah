<script setup lang="ts">
const online = useOnline()
const { t } = useI18n()
</script>

<template>
  <div
    v-if="!online"
    role="status"
    aria-live="assertive"
    class="safe-top sticky top-0 z-50 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-semibold text-inverted"
  >
    <UIcon name="i-lucide-wifi-off" class="size-4 shrink-0" />
    {{ t('offline.banner') }}
  </div>
</template>
