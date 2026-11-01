<script setup lang="ts">
const { locale, toggle } = useLocaleSwitch()
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    icon="i-lucide-languages"
    :label="locale === 'ar' ? 'EN' : 'ع'"
    :aria-label="locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'"
    @click="toggle"
  />
</template>
