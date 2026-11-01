<script setup lang="ts">
import type { FieldDef } from '~/components/ResourceManager.vue'

definePageMeta({ layout: 'admin', permission: 'settings.manage' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()

const { data: offices } = await useAsyncData('offices-net', () => api<any[]>('/api/admin/resources/offices'), { server: false, default: () => [] })
const test = ref<any>(null)
const testing = ref(false)
async function runTest() {
  testing.value = true
  try {
    test.value = await api('/api/admin/networks/test')
  }
  finally {
    testing.value = false
  }
}
onMounted(runTest)

const fields = computed<FieldDef[]>(() => [
  { key: 'label', label: t('fields.name'), type: 'text', required: true },
  { key: 'cidr', label: t('network.cidr'), type: 'text', required: true, dir: 'ltr', help: t('network.cidrHelp') },
  { key: 'office_id', label: t('location.office'), type: 'select', items: [{ value: '__none__', label: t('network.allOffices') }, ...offices.value.map(o => ({ value: o.id, label: f.label(o) }))] },
  { key: 'is_active', label: t('fields.active'), type: 'switch' },
])
const toast = useToast()
async function copyIp() {
  if (!test.value?.ip) return
  await navigator.clipboard?.writeText(`${test.value.ip}/${test.value.ip.includes(':') ? 128 : 32}`)
  toast.add({ title: t('network.copied'), color: 'success' })
}
</script>

<template>
  <AdminPage :title="t('admin.nav.network')">
    <div class="grid gap-4 lg:grid-cols-3">
      <div class="lg:col-span-2">
        <ResourceManager resource="networks" :fields="fields" :defaults="{ label: '', cidr: '', office_id: '__none__', is_active: true }" :can-edit="true" :add-label="t('network.add')" @changed="runTest" />
      </div>
      <div class="space-y-4">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-bold">
                {{ t('network.testTitle') }}
              </h2>
              <UButton size="xs" icon="i-lucide-refresh-cw" color="neutral" variant="ghost" :loading="testing" :aria-label="t('common.retry')" @click="runTest" />
            </div>
          </template>
          <div v-if="test" class="space-y-2 text-sm">
            <p>{{ t('network.observed') }}: <code class="font-mono" dir="ltr">{{ test.ip ?? '—' }}</code></p>
            <p class="text-xs text-muted">
              {{ t('network.source') }}: <code dir="ltr">{{ test.source }}</code> · {{ t('network.mode') }}: <code dir="ltr">{{ test.trustProxyMode }}</code>
            </p>
            <UAlert v-if="test.loopbackOverride" color="info" variant="subtle" icon="i-lucide-flask-conical" :title="t('network.overrideTitle')" :description="t('network.overrideHelp', { ip: test.ip })" />
            <UAlert v-else-if="test.loopbackPeer" color="warning" variant="subtle" icon="i-lucide-monitor" :title="t('network.loopbackTitle')" :description="test.allowed ? t('network.loopbackAllowedHelp', { label: test.matches.map((m: any) => m.label).join(', ') }) : t('network.loopbackHelp')" />
            <UAlert :color="test.allowed ? 'success' : 'error'" variant="subtle" :icon="test.allowed ? 'i-lucide-check' : 'i-lucide-x'" :title="test.allowed ? t('network.allowed', { label: test.matches.map((m: any) => m.label).join(', ') }) : t('network.notAllowed')" />
            <UButton v-if="test.ip && !test.allowed && (!test.loopbackPeer || test.loopbackOverride)" size="xs" variant="outline" :label="t('network.copyIp')" icon="i-lucide-copy" @click="copyIp" />
          </div>
        </UCard>
        <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('network.limitsTitle')">
          <template #description>
            <ul class="list-disc space-y-1 ps-4 text-sm">
              <li>{{ t('network.limit1') }}</li>
              <li>{{ t('network.limit2') }}</li>
              <li>{{ t('network.limit3') }}</li>
              <li>{{ t('network.limit4') }}</li>
            </ul>
          </template>
        </UAlert>
      </div>
    </div>
  </AdminPage>
</template>
