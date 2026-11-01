<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'devices.manage' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const toast = useToast()
const errorText = useApiError()

const filter = ref<'pending' | 'active' | 'revoked'>('pending')
const { data, refresh, status } = await useAsyncData('admin-devices', () => api<any[]>('/api/admin/devices', { query: { status: filter.value } }), { server: false, default: () => [], watch: [filter] })

async function setStatus(d: any, s: 'active' | 'revoked') {
  const reason = s === 'revoked' ? prompt(t('devicesAdmin.revokeReason')) ?? undefined : undefined
  if (s === 'revoked' && reason === undefined) return
  try {
    await api(`/api/admin/devices/${d.id}/status`, { method: 'POST', body: { status: s, reason } })
    toast.add({ title: s === 'active' ? t('devicesAdmin.approved') : t('devices.revoked'), color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
</script>

<template>
  <AdminPage :title="t('admin.nav.devices')">
    <UAlert class="mb-4" color="info" variant="subtle" icon="i-lucide-fingerprint" :title="t('devices.privacyTitle')" :description="t('devicesAdmin.explain')" />
    <UTabs v-model="filter" :items="['pending', 'active', 'revoked'].map(s => ({ label: t(`status.${s}`), value: s }))" :content="false" class="mb-3" size="sm" />
    <UCard :ui="{ body: 'p-0' }">
      <div v-if="status === 'pending'" class="p-4">
        <USkeleton class="h-10" />
      </div>
      <p v-else-if="!data.length" class="p-4 text-sm text-muted">
        {{ t('common.empty') }}
      </p>
      <ul class="divide-y divide-default">
        <li v-for="d in data" :key="d.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <p class="font-medium">
              {{ f.name(one(one(d.employee)?.profile)) }}
              <span class="text-xs text-muted" dir="ltr">({{ one(d.employee)?.employee_code }})</span>
            </p>
            <p class="text-sm">
              {{ one(d.device)?.label }} · {{ one(d.device)?.platform }}
              <span v-if="d.authenticator_name" class="text-muted">· {{ d.authenticator_name }}</span>
              <UBadge v-if="d.device_type === 'multiDevice'" size="sm" color="neutral" variant="outline" class="ms-1">{{ t('devicesAdmin.synced') }}</UBadge>
            </p>
            <p class="text-xs text-muted">
              {{ t('devices.added', { date: f.dateTime(d.created_at) }) }}
              <template v-if="d.last_used_at">
                · {{ t('devices.lastUsed', { date: f.dateTime(d.last_used_at) }) }}
              </template>
              <template v-if="d.revoke_reason">
                · {{ d.revoke_reason }}
              </template>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton v-if="d.status === 'pending'" size="xs" color="success" icon="i-lucide-check" :label="t('common.approve')" @click="setStatus(d, 'active')" />
            <UButton v-if="d.status !== 'revoked'" size="xs" color="error" variant="soft" icon="i-lucide-ban" :label="t('devices.revoke')" @click="setStatus(d, 'revoked')" />
          </div>
        </li>
      </ul>
    </UCard>
  </AdminPage>
</template>
