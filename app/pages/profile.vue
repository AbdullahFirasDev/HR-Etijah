<script setup lang="ts">
definePageMeta({ employeeOnly: true })
const { t } = useI18n()
const auth = useAuth()
const { locale, set } = useLocaleSwitch()
const toast = useToast()
const config = useRuntimeConfig()
const api = useApi()

const pushSupported = ref(false)
const pushEnabled = ref(false)
onMounted(async () => {
  pushSupported.value = 'serviceWorker' in navigator && 'PushManager' in window && !!config.public.vapidPublicKey
  if (pushSupported.value) {
    const reg = await navigator.serviceWorker.getRegistration()
    pushEnabled.value = !!(await reg?.pushManager.getSubscription())
  }
})

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function togglePush(on: boolean) {
  try {
    const reg = await navigator.serviceWorker.ready
    if (on) {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('denied')
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.public.vapidPublicKey as string) })
      await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() })
    }
    else {
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
    }
    pushEnabled.value = on
  }
  catch {
    pushEnabled.value = !on
    toast.add({ title: t('profile.pushFailed'), color: 'warning' })
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">
      {{ t('nav.profile') }}
    </h1>
    <UCard>
      <div class="flex items-center gap-3">
        <UAvatar :alt="auth.displayName.value" size="lg" />
        <div>
          <p class="font-semibold">
            {{ auth.displayName.value }}
          </p>
          <p class="text-sm text-muted" dir="ltr">
            {{ auth.user.value?.email }}
          </p>
          <UBadge class="mt-1" color="neutral" variant="subtle">
            {{ t(`roles.${auth.user.value?.role}`) }}
          </UBadge>
        </div>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0' }">
      <ul class="divide-y divide-default">
        <li class="flex items-center justify-between px-4 py-3">
          <span>{{ t('profile.language') }}</span>
          <UTabs :model-value="locale" :items="[{ label: 'العربية', value: 'ar' }, { label: 'English', value: 'en' }]" :content="false" size="xs" @update:model-value="(v: any) => set(v)" />
        </li>
        <li v-if="pushSupported" class="flex items-center justify-between px-4 py-3">
          <span>{{ t('profile.push') }}</span>
          <USwitch :model-value="pushEnabled" @update:model-value="togglePush" />
        </li>
        <li>
          <NuxtLink to="/devices" class="flex items-center justify-between px-4 py-3 hover:bg-elevated/50">
            <span class="flex items-center gap-2"><UIcon name="i-lucide-fingerprint" class="size-5" />{{ t('devices.title') }}</span>
            <UIcon name="i-lucide-chevron-left" class="size-4 rtl:rotate-0 ltr:rotate-180" />
          </NuxtLink>
        </li>
        <li>
          <NuxtLink to="/notifications" class="flex items-center justify-between px-4 py-3 hover:bg-elevated/50">
            <span class="flex items-center gap-2"><UIcon name="i-lucide-bell" class="size-5" />{{ t('nav.notifications') }}</span>
            <UIcon name="i-lucide-chevron-left" class="size-4 rtl:rotate-0 ltr:rotate-180" />
          </NuxtLink>
        </li>
        <li>
          <NuxtLink to="/auth/change-password" class="flex items-center justify-between px-4 py-3 hover:bg-elevated/50">
            <span class="flex items-center gap-2"><UIcon name="i-lucide-key-round" class="size-5" />{{ t('auth.changePassword') }}</span>
            <UIcon name="i-lucide-chevron-left" class="size-4 rtl:rotate-0 ltr:rotate-180" />
          </NuxtLink>
        </li>
      </ul>
    </UCard>
    <UButton block color="error" variant="soft" icon="i-lucide-log-out" :label="t('auth.logout')" @click="auth.logout()" />
    <p class="text-center text-xs text-muted">
      {{ t('profile.sessionNote') }}
    </p>
  </div>
</template>
