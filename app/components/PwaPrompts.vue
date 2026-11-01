<script setup lang="ts">
const { $pwa } = useNuxtApp()
const { t } = useI18n()
const dismissedInstall = useCookie<boolean>('hr_install_dismissed', { maxAge: 60 * 60 * 24 * 30, sameSite: 'strict' })
</script>

<template>
  <div v-if="$pwa" class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
    <UAlert
      v-if="$pwa.needRefresh"
      class="pointer-events-auto max-w-md shadow-lg"
      color="primary"
      variant="solid"
      icon="i-lucide-refresh-cw"
      :title="t('pwa.updateTitle')"
      :description="t('pwa.updateBody')"
      :actions="[
        { label: t('pwa.reload'), color: 'neutral', variant: 'solid', onClick: () => $pwa?.updateServiceWorker() },
        { label: t('common.later'), color: 'neutral', variant: 'ghost', onClick: () => $pwa?.cancelPrompt() },
      ]"
    />
    <UAlert
      v-else-if="$pwa.showInstallPrompt && !dismissedInstall && !$pwa.isPWAInstalled"
      class="pointer-events-auto max-w-md shadow-lg"
      color="neutral"
      variant="outline"
      icon="i-lucide-download"
      :title="t('pwa.installTitle')"
      :description="t('pwa.installBody')"
      :actions="[
        { label: t('pwa.install'), color: 'primary', onClick: () => $pwa?.install() },
        { label: t('common.notNow'), color: 'neutral', variant: 'ghost', onClick: () => { dismissedInstall = true; $pwa?.cancelInstall() } },
      ]"
    />
  </div>
</template>
