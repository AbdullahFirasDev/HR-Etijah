<script setup lang="ts">
definePageMeta({ employeeOnly: true })
const { t, locale } = useI18n()
const f = useFormat()
const api = useApi()

const period = ref<'week' | 'month'>('month')
const ref_ = ref(f.todayIso())
const { data, status, refresh } = await useAsyncData('me-report', () => api<any>('/api/me/report', { query: { period: period.value, date: ref_.value } }), { server: false, watch: [period] })

const s = computed(() => data.value?.summary)
const chart = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 40, top: 20, bottom: 30 },
  xAxis: { type: 'category', data: (data.value?.days ?? []).map((d: any) => d.date.slice(8)) },
  yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${Math.round(v / 60)}h` } },
  series: [
    { name: t('home.worked'), type: 'bar', stack: 'a', data: (data.value?.days ?? []).map((d: any) => d.netMinutes), itemStyle: { color: '#0866b2' } },
    { name: t('home.required'), type: 'line', data: (data.value?.days ?? []).map((d: any) => d.requiredMinutes), itemStyle: { color: '#94a3b8' }, symbol: 'none', lineStyle: { type: 'dashed' } },
  ],
}))

function exportUrl(format: 'xlsx' | 'pdf') {
  const params = new URLSearchParams({ type: 'daily', format, lang: locale.value, from: data.value?.from ?? '', to: data.value?.to ?? '' })
  return `/api/reports/export?${params}`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-bold">
        {{ t('reports.mine') }}
      </h1>
      <UTabs v-model="period" :items="[{ label: t('reports.week'), value: 'week' }, { label: t('reports.month'), value: 'month' }]" :content="false" size="sm" />
    </div>
    <div class="flex items-end gap-2">
      <UFormField :label="t('reports.reference')">
        <UInput v-model="ref_" type="date" />
      </UFormField>
      <UButton icon="i-lucide-search" :loading="status === 'pending'" :label="t('common.apply')" @click="refresh()" />
    </div>

    <p v-if="data" class="text-sm text-muted">
      {{ f.date(data.from, { day: 'numeric', month: 'long' }) }} → {{ f.date(data.to, { day: 'numeric', month: 'long', year: 'numeric' }) }}
    </p>

    <div v-if="s" class="grid grid-cols-2 gap-3">
      <StatCard :label="t('reports.totalHours')" :value="f.duration(s.netMinutes)" icon="i-lucide-clock" />
      <StatCard :label="t('reports.requiredHours')" :value="f.duration(s.requiredMinutes)" icon="i-lucide-target" color="neutral" />
      <StatCard :label="t('reports.overtime')" :value="f.duration(s.overtimeMinutes)" icon="i-lucide-trending-up" color="success" />
      <StatCard :label="t('reports.shortage')" :value="f.duration(s.shortageMinutes)" icon="i-lucide-trending-down" color="error" />
      <StatCard :label="t('reports.lateArrivals')" :value="s.lateCount" icon="i-lucide-clock-alert" color="warning" />
      <StatCard :label="t('reports.absenceDays')" :value="s.absenceDays" icon="i-lucide-user-x" color="error" />
      <StatCard :label="t('reports.leaveDays')" :value="s.leaveDays" icon="i-lucide-plane" color="info" />
      <StatCard :label="t('reports.attendanceRate')" :value="`${s.attendancePercentage}%`" icon="i-lucide-percent" />
    </div>

    <UCard v-if="data?.days?.length">
      <ClientOnly>
        <EChart :option="chart" height="16rem" :label="t('reports.chartLabel')" />
      </ClientOnly>
    </UCard>

    <div v-if="data" class="flex gap-2">
      <UButton :to="exportUrl('xlsx')" external target="_blank" icon="i-lucide-file-spreadsheet" color="neutral" variant="outline" :label="t('reports.excel')" />
      <UButton :to="exportUrl('pdf')" external target="_blank" icon="i-lucide-file-text" color="neutral" variant="outline" :label="t('reports.pdf')" />
    </div>
  </div>
</template>
