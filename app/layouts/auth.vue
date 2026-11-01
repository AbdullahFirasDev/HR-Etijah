<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-gradient-to-b from-primary-50 to-default dark:from-primary-950">
    <div class="flex justify-end p-3">
      <LanguageToggle />
    </div>
    <main class="flex flex-1 items-start justify-center px-4 pb-10 pt-4 sm:items-center">
      <div class="w-full max-w-sm">
        <div class="mb-6 flex justify-center">
          <AppLogo />
        </div>
        <slot />
        <p class="mt-6 text-center text-xs text-muted">
          {{ t('app.securityNote') }}
        </p>
      </div>
    </main>
  </div>
</template>
