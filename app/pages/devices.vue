<script setup lang="ts">
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'

definePageMeta({ employeeOnly: true })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const toast = useToast()
const errorText = useApiError()

const { data, refresh } = await useAsyncData('me-devices', () => api<any>('/api/me/devices'), { server: false })
const supported = ref(true)
const platformAvailable = ref<boolean | null>(null)
onMounted(async () => {
  supported.value = browserSupportsWebAuthn()
  try {
    platformAvailable.value = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  }
  catch {
    platformAvailable.value = false
  }
})

function guessLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  return t('devices.thisDevice')
}
const label = ref('')
onMounted(() => (label.value = guessLabel()))
const busy = ref(false)

async function register() {
  busy.value = true
  try {
    const { challengeId, options } = await api<any>('/api/webauthn/register/options', { method: 'POST', body: { label: label.value } })
    let response
    try {
      response = await startRegistration({ optionsJSON: options })
    }
    catch (e: any) {
      toast.add({ title: e?.name === 'InvalidStateError' ? t('devices.alreadyRegistered') : t('reasons.biometric_cancelled'), color: 'warning' })
      return
    }
    const r = await api<{ status: string }>('/api/webauthn/register/verify', { method: 'POST', body: { challengeId, label: label.value, response } })
    toast.add({ title: r.status === 'active' ? t('devices.registered') : t('devices.registeredPending'), color: 'success', icon: 'i-lucide-fingerprint' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

async function revoke(id: string) {
  try {
    await api(`/api/me/devices/${id}`, { method: 'DELETE' })
    toast.add({ title: t('devices.revoked'), color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">
      {{ t('devices.title') }}
    </h1>

    <UCard>
      <div class="space-y-3">
        <p class="text-sm">
          {{ t('devices.explain') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UBadge v-for="m in ['faceId', 'touchId', 'android', 'windowsHello', 'pin']" :key="m" color="neutral" variant="subtle" icon="i-lucide-scan-face">
            {{ t(`devices.methods.${m}`) }}
          </UBadge>
        </div>
        <UAlert color="info" variant="subtle" icon="i-lucide-shield-check" :title="t('devices.privacyTitle')" :description="t('devices.privacyBody')" />
        <UAlert v-if="!supported" color="error" variant="subtle" :title="t('devices.unsupported')" />
        <UAlert v-else-if="platformAvailable === false" color="warning" variant="subtle" :title="t('devices.noPlatform')" />
        <div class="flex flex-wrap items-end gap-2">
          <UFormField :label="t('devices.label')" class="min-w-48 flex-1">
            <UInput v-model="label" maxlength="80" class="w-full" />
          </UFormField>
          <UButton icon="i-lucide-fingerprint" :label="t('devices.register')" :loading="busy" :disabled="!supported || !label.trim()" @click="register" />
        </div>
        <p v-if="data?.requireApproval" class="text-xs text-muted">
          {{ t('devices.approvalNote', { max: data.maxDevices }) }}
        </p>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0' }">
      <template #header>
        <h2 class="font-bold">
          {{ t('devices.mine') }}
        </h2>
      </template>
      <p v-if="!data?.devices?.length" class="p-4 text-sm text-muted">
        {{ t('devices.none') }}
      </p>
      <ul class="divide-y divide-default">
        <li v-for="d in data?.devices ?? []" :key="d.id" class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="flex min-w-0 items-center gap-3">
            <UIcon :name="d.device?.platform === 'iOS' || d.device?.platform === 'Android' ? 'i-lucide-smartphone' : 'i-lucide-laptop'" class="size-6 text-muted" />
            <div class="min-w-0">
              <p class="truncate font-medium">
                {{ d.device?.label ?? '—' }}
                <span v-if="d.authenticator_name" class="text-xs text-muted">· {{ d.authenticator_name }}</span>
              </p>
              <p class="text-xs text-muted">
                {{ t('devices.added', { date: f.dateTime(d.created_at) }) }}
                <template v-if="d.last_used_at">
                  · {{ t('devices.lastUsed', { date: f.dateTime(d.last_used_at) }) }}
                </template>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <StatusBadge :status="d.status" size="sm" />
            <UButton v-if="d.status !== 'revoked'" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('devices.revoke')" @click="revoke(d.id)" />
          </div>
        </li>
      </ul>
    </UCard>
  </div>
</template>
