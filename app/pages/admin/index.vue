<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: ['attendance.read', 'reports.view'] })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()

const { data, refresh } = await useAsyncData('admin-dashboard', () => api<any>('/api/admin/dashboard'), { server: false })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(async () => {
    try {
      data.value = await api('/api/admin/dashboard', { query: { passive: '1' } })
    }
    catch {}
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

const s = computed(() => data.value?.stats)
const hours = (m: number) => Math.round((m / 60) * 10) / 10

const dailyOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { top: 0 },
  grid: { left: 40, right: 40, top: 36, bottom: 28 },
  xAxis: { type: 'category', data: (data.value?.dailyTrend ?? []).map((d: any) => d.date.slice(5)) },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    { name: t('dashboard.present'), type: 'bar', stack: 'd', data: (data.value?.dailyTrend ?? []).map((d: any) => d.present), itemStyle: { color: '#16a34a' } },
    { name: t('dashboard.onLeave'), type: 'bar', stack: 'd', data: (data.value?.dailyTrend ?? []).map((d: any) => d.leave), itemStyle: { color: '#0ea5e9' } },
    { name: t('dashboard.absent'), type: 'bar', stack: 'd', data: (data.value?.dailyTrend ?? []).map((d: any) => d.absent), itemStyle: { color: '#dc2626' } },
    { name: t('dashboard.late'), type: 'line', data: (data.value?.dailyTrend ?? []).map((d: any) => d.late), itemStyle: { color: '#f59e0b' }, smooth: true },
  ],
}))
const monthOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { top: 0 },
  grid: { left: 40, right: 40, top: 36, bottom: 28 },
  xAxis: { type: 'category', data: (data.value?.monthTrend ?? []).map((m: any) => m.key) },
  yAxis: { type: 'value', name: t('units.h') },
  series: [
    { name: t('dashboard.overtimeHours'), type: 'bar', data: (data.value?.monthTrend ?? []).map((m: any) => hours(m.overtimeMinutes)), itemStyle: { color: '#16a34a' } },
    { name: t('dashboard.shortageHours'), type: 'bar', data: (data.value?.monthTrend ?? []).map((m: any) => hours(m.shortageMinutes)), itemStyle: { color: '#dc2626' } },
  ],
}))
const deptOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 40, top: 20, bottom: 50 },
  xAxis: { type: 'category', data: (data.value?.departments ?? []).map((d: any) => f.label({ name_ar: d.nameAr, name_en: d.nameEn })), axisLabel: { interval: 0, rotate: 20 } },
  yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
  series: [{ name: t('dashboard.attendanceRate'), type: 'bar', data: (data.value?.departments ?? []).map((d: any) => d.attendancePercentage), itemStyle: { color: '#0866b2' } }],
}))
</script>

<template>
  <AdminPage :title="t('admin.nav.dashboard')">
    <template #actions>
      <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :aria-label="t('common.refresh')" @click="refresh()" />
    </template>

    <div v-if="!data" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <USkeleton v-for="i in 8" :key="i" class="h-24" />
    </div>
    <div v-else class="space-y-4">
      <p class="text-sm text-muted">
        {{ t('dashboard.asOf', { time: f.time(data.generatedAt) }) }} — {{ f.date(data.today, { weekday: 'long', day: 'numeric', month: 'long' }) }}
      </p>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard :label="t('dashboard.totalEmployees')" :value="s.totalEmployees" icon="i-lucide-users" color="neutral" to="/admin/employees" />
        <StatCard :label="t('dashboard.presentNow')" :value="s.present" icon="i-lucide-user-check" color="success" :hint="t('dashboard.checkedInToday', { n: s.checkedInToday })" />
        <StatCard :label="t('dashboard.onBreak')" :value="s.onBreak" icon="i-lucide-coffee" color="info" />
        <StatCard :label="t('dashboard.absentNow')" :value="s.absent" icon="i-lucide-user-x" color="error" />
        <StatCard :label="t('dashboard.lateToday')" :value="s.late" icon="i-lucide-clock-alert" color="warning" />
        <StatCard :label="t('dashboard.hoursToday')" :value="f.duration(s.netMinutesToday)" icon="i-lucide-clock" />
        <StatCard :label="t('dashboard.overtimeToday')" :value="f.duration(s.overtimeMinutesToday)" icon="i-lucide-trending-up" color="success" />
        <StatCard v-if="auth.can('security.read')" :label="t('dashboard.rejected24h')" :value="s.rejected24h" icon="i-lucide-shield-alert" color="error" to="/admin/security" />
      </div>

      <div v-if="data.pending.leave || data.pending.adjustments || data.pending.devices" class="flex flex-wrap gap-2">
        <UButton v-if="data.pending.leave" to="/admin/leave" color="warning" variant="soft" icon="i-lucide-plane" :label="t('dashboard.pendingLeave', { n: data.pending.leave })" />
        <UButton v-if="data.pending.adjustments" to="/admin/attendance?tab=adjustments" color="warning" variant="soft" icon="i-lucide-file-pen-line" :label="t('dashboard.pendingAdjustments', { n: data.pending.adjustments })" />
        <UButton v-if="data.pending.devices" to="/admin/devices" color="warning" variant="soft" icon="i-lucide-smartphone" :label="t('dashboard.pendingDevices', { n: data.pending.devices })" />
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <UCard class="xl:col-span-2">
          <template #header>
            <h2 class="font-bold">
              {{ t('dashboard.dailyTrend') }}
            </h2>
          </template>
          <ClientOnly><EChart :option="dailyOption" :label="t('dashboard.dailyTrend')" /></ClientOnly>
        </UCard>
        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="font-bold">
              {{ t('dashboard.liveActivity') }}
            </h2>
          </template>
          <p v-if="!data.activity.length" class="p-4 text-sm text-muted">
            {{ t('common.empty') }}
          </p>
          <ul class="max-h-80 divide-y divide-default overflow-y-auto">
            <li v-for="a in data.activity" :key="a.id" class="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span class="min-w-0 truncate">
                <UIcon :name="a.event_type === 'check_in' ? 'i-lucide-log-in' : a.event_type === 'check_out' ? 'i-lucide-log-out' : 'i-lucide-coffee'" class="me-1 size-4 align-middle text-muted" />
                {{ f.name(a) }} — {{ t(`actions.${a.event_type}`) }}
                <UBadge v-if="a.source === 'adjustment'" size="sm" variant="outline" color="info">{{ t('history.corrected') }}</UBadge>
              </span>
              <span class="ltr-nums shrink-0 text-xs text-muted">{{ f.time(a.occurred_at) }}</span>
            </li>
          </ul>
        </UCard>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <UCard>
          <template #header>
            <h2 class="font-bold">
              {{ t('dashboard.monthTrend') }}
            </h2>
          </template>
          <ClientOnly><EChart :option="monthOption" height="16rem" :label="t('dashboard.monthTrend')" /></ClientOnly>
          <div class="mt-2 flex flex-wrap gap-2 text-xs text-muted">
            <span v-for="m in data.monthTrend" :key="m.key">{{ m.key }}: {{ m.attendancePercentage ?? '—' }}%</span>
          </div>
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-bold">
              {{ t('dashboard.departments') }}
            </h2>
          </template>
          <ClientOnly><EChart :option="deptOption" height="16rem" :label="t('dashboard.departments')" /></ClientOnly>
          <table class="mt-2 w-full text-sm">
            <thead class="text-xs text-muted">
              <tr>
                <th class="text-start">
                  {{ t('fields.department') }}
                </th>
                <th>{{ t('dashboard.late') }}</th>
                <th>{{ t('reports.overtime') }}</th>
                <th>{{ t('reports.shortage') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in data.departments" :key="d.id ?? 'none'" class="border-t border-default text-center">
                <td class="py-1 text-start">
                  {{ f.label({ name_ar: d.nameAr, name_en: d.nameEn }) }}
                </td>
                <td>{{ d.late }}</td>
                <td>{{ f.hm(d.overtime) }}</td>
                <td>{{ f.hm(d.shortage) }}</td>
              </tr>
            </tbody>
          </table>
        </UCard>
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="font-bold">
              {{ t('dashboard.lateList') }}
            </h2>
          </template>
          <p v-if="!data.lateList.length" class="p-4 text-sm text-muted">
            {{ t('common.empty') }}
          </p>
          <ul class="divide-y divide-default">
            <li v-for="l in data.lateList" :key="l.id" class="flex justify-between px-4 py-2 text-sm">
              <span>{{ f.name(l) }}</span><span class="text-warning">{{ t('home.late', { m: l.minutes }) }}</span>
            </li>
          </ul>
        </UCard>
        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="font-bold">
              {{ t('dashboard.absentList') }}
            </h2>
          </template>
          <p v-if="!data.absentList.length" class="p-4 text-sm text-muted">
            {{ t('common.empty') }}
          </p>
          <ul class="divide-y divide-default">
            <li v-for="a in data.absentList" :key="a.id" class="px-4 py-2 text-sm">
              {{ f.name(a) }}
            </li>
          </ul>
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-bold">
              {{ t('dashboard.geofence') }}
            </h2>
          </template>
          <ClientOnly><GeofenceMap :fences="data.geofences" height="14rem" /></ClientOnly>
        </UCard>
      </div>

      <UCard v-if="auth.can('security.read')" :ui="{ body: 'p-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-bold">
              {{ t('dashboard.securityEvents') }}
            </h2>
            <UButton to="/admin/security" variant="link" size="sm" :label="t('common.viewAll')" />
          </div>
        </template>
        <p v-if="!data.security.length" class="p-4 text-sm text-muted">
          {{ t('common.empty') }}
        </p>
        <ul class="divide-y divide-default">
          <li v-for="e in data.security" :key="e.id" class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
            <span>
              <StatusBadge :status="e.outcome" size="sm" />
              {{ f.name(e) }} — {{ t(`actions.${e.action}`) }}
              <span class="text-xs text-muted">{{ (e.failure_reasons ?? []).map((r: string) => t(`reasons.${r}`)).join('، ') }}</span>
            </span>
            <span class="ltr-nums text-xs text-muted">{{ e.client_ip }} · {{ t('security.risk') }} {{ e.risk_score }} · {{ f.dateTime(e.occurred_at) }}</span>
          </li>
        </ul>
      </UCard>
    </div>
  </AdminPage>
</template>
