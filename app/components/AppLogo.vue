<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2.5">
    <img src="/icons/icon.svg" alt="" class="size-9 rounded-lg shadow-sm" width="36" height="36">
    <div v-if="!compact" class="leading-tight">
      <p class="font-bold text-highlighted">
        {{ t('app.name') }}
      </p>
      <p class="text-xs text-muted">
        {{ t('app.tagline') }}
      </p>
    </div>
  </div>
</template>
