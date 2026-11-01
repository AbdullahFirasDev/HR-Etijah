<script setup lang="ts">
import { ar, en } from '@nuxt/ui/locale'

const { locale, locales } = useI18n()
const uiLocale = computed(() => (locale.value === 'en' ? en : ar))
const dir = computed(() => (locales.value.find(l => typeof l !== 'string' && l.code === locale.value) as { dir?: 'rtl' | 'ltr' } | undefined)?.dir ?? 'rtl')

useHead({
  htmlAttrs: { lang: computed(() => (locale.value === 'en' ? 'en' : 'ar')), dir },
})
</script>

<template>
  <UApp :locale="uiLocale" :toaster="{ position: 'top-center' }">
    <NuxtLoadingIndicator color="var(--ui-primary)" />
    <OfflineBanner />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <PwaPrompts />
  </UApp>
</template>
