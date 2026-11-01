<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: ['security.read', 'audit.read'] })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()

const tab = ref(auth.can('security.read') ? 'attempts' : 'audit')
const outcome = ref<'all' | 'rejected' | 'accepted' | 'risk'>('rejected')
const { data: attempts, refresh: refreshAttempts, status: aStatus } = await useAsyncData('sec-attempts', () => (auth.can('security.read')
  ? api<any[]>('/api/admin/security/attempts', { query: outcome.value === 'all' ? {} : outcome.value === 'risk' ? { minRisk: 40 } : { outcome: outcome.value } })
  : Promise.resolve([])), { server: false, default: () => [], watch: [outcome] })
const auditFilter = ref('')
const { data: audit, refresh: refreshAudit, status: lStatus } = await useAsyncData('sec-audit', () => (auth.can('audit.read')
  ? api<any[]>('/api/admin/security/audit', { query: auditFilter.value ? { action: auditFilter.value } : {} })
  : Promise.resolve([])), { server: false, default: () => [] })
const expanded = ref<number | null>(null)
</script>

<template>
  <AdminPage :title="t('admin.nav.security')">
    <UTabs v-model="tab" :items="[...(auth.can('security.read') ? [{ label: t('security.attempts'), value: 'attempts' }] : []), ...(auth.can('audit.read') ? [{ label: t('security.audit'), value: 'audit' }] : [])]" :content="false" class="mb-4" />

    <template v-if="tab === 'attempts'">
      <div class="mb-3 flex items-center justify-between gap-2">
        <UTabs v-model="outcome" :items="['rejected', 'risk', 'accepted', 'all'].map(s => ({ label: t(`security.filter.${s}`), value: s }))" :content="false" size="xs" />
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="aStatus === 'pending'" :aria-label="t('common.refresh')" @click="refreshAttempts()" />
      </div>
      <UCard :ui="{ body: 'p-0' }">
        <p v-if="!attempts.length" class="p-4 text-sm text-muted">
          {{ t('common.empty') }}
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-elevated/60 text-xs text-muted">
              <tr>
                <th class="p-2 text-start">{{ t('fields.date') }}</th>
                <th class="p-2 text-start">{{ t('fields.name') }}</th>
                <th class="p-2">{{ t('security.action') }}</th>
                <th class="p-2">{{ t('verify.location') }}</th>
                <th class="p-2">{{ t('verify.network') }}</th>
                <th class="p-2">{{ t('verify.biometric') }}</th>
                <th class="p-2">{{ t('security.risk') }}</th>
                <th class="p-2 text-start">{{ t('security.reasons') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in attempts" :key="a.id" class="border-t border-default">
                <td class="ltr-nums whitespace-nowrap p-2 text-xs">{{ f.dateTime(a.occurred_at) }}</td>
                <td class="p-2">{{ f.name(one(one(a.employee)?.profile)) }}</td>
                <td class="p-2 text-center">{{ t(`actions.${a.action}`) }}</td>
                <td class="p-2 text-center">
                  <UIcon :name="a.geofence_passed ? 'i-lucide-check' : 'i-lucide-x'" :class="a.geofence_passed ? 'text-success' : 'text-error'" />
                  <span v-if="a.distance_m != null" class="ltr-nums block text-xs text-muted">{{ Math.round(a.distance_m) }}m ±{{ Math.round(a.accuracy_m ?? 0) }}</span>
                </td>
                <td class="p-2 text-center">
                  <UIcon :name="a.network_passed ? 'i-lucide-check' : 'i-lucide-x'" :class="a.network_passed ? 'text-success' : 'text-error'" />
                  <span class="block font-mono text-xs text-muted" dir="ltr">{{ a.client_ip }}</span>
                </td>
                <td class="p-2 text-center">
                  <UIcon :name="a.webauthn_passed ? 'i-lucide-check' : 'i-lucide-x'" :class="a.webauthn_passed ? 'text-success' : 'text-error'" />
                </td>
                <td class="p-2 text-center">
                  <UBadge :color="a.risk_score >= 80 ? 'error' : a.risk_score >= 40 ? 'warning' : 'neutral'" variant="subtle" size="sm">{{ a.risk_score }}</UBadge>
                  <span v-if="a.risk_flags?.length" class="block text-xs text-muted">{{ a.risk_flags.map((x: string) => t(`riskFlags.${x}`)).join('، ') }}</span>
                </td>
                <td class="p-2 text-xs">{{ (a.failure_reasons ?? []).map((r: string) => t(`reasons.${r}`)).join('، ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </template>

    <template v-else>
      <div class="mb-3 flex items-center gap-2">
        <UInput v-model="auditFilter" icon="i-lucide-search" :placeholder="t('security.actionPrefix')" dir="ltr" class="w-64" @keyup.enter="refreshAudit()" />
        <UButton icon="i-lucide-search" :loading="lStatus === 'pending'" :label="t('common.apply')" @click="refreshAudit()" />
      </div>
      <UCard :ui="{ body: 'p-0' }">
        <p v-if="!audit.length" class="p-4 text-sm text-muted">
          {{ t('common.empty') }}
        </p>
        <ul class="divide-y divide-default text-sm">
          <li v-for="l in audit" :key="l.id" class="px-4 py-2">
            <button type="button" class="flex w-full flex-wrap items-center justify-between gap-2 text-start" @click="expanded = expanded === l.id ? null : l.id">
              <span>
                <code class="rounded bg-elevated px-1 text-xs" dir="ltr">{{ l.action }}</code>
                <span class="ms-1">{{ l.entity_type }}</span>
                <span class="text-muted"> — {{ l.actor ? f.name(l.actor) : t('security.system') }}</span>
              </span>
              <span class="ltr-nums text-xs text-muted">{{ l.ip ?? '' }} · {{ f.dateTime(l.occurred_at) }}</span>
            </button>
            <p v-if="l.reason" class="text-xs">
              {{ t('adjust.reason') }}: {{ l.reason }}
            </p>
            <pre v-if="expanded === l.id" class="mt-2 max-h-80 overflow-auto rounded bg-elevated p-2 text-xs" dir="ltr">{{ JSON.stringify({ old: l.old_data, new: l.new_data, metadata: l.metadata }, null, 2) }}</pre>
          </li>
        </ul>
      </UCard>
    </template>
  </AdminPage>
</template>
