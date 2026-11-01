<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'

definePageMeta({ layout: 'admin', permission: 'reports.view' })
const { t, locale } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()
const toast = useToast()
const errorText = useApiError()

const type = ref<'daily' | 'weekly' | 'monthly'>('monthly')
const today = f.todayIso()
const filters = reactive({ from: `${today.slice(0, 7)}-01`, to: today, departmentId: 'all', employeeId: 'all' })
const { data: departments } = await useAsyncData('departments-list', () => api<any[]>('/api/admin/resources/departments'), { server: false, default: () => [] })
const { data: people } = await useAsyncData('report-people', () => api<any>('/api/admin/employees').catch(() => ({ employees: [] })), { server: false })

const report = ref<any>(null)
const loading = ref(false)
function query() {
  return {
    from: filters.from,
    to: filters.to,
    ...(filters.departmentId !== 'all' ? { departmentId: filters.departmentId } : {}),
    ...(filters.employeeId !== 'all' ? { employeeId: filters.employeeId } : {}),
  }
}
async function run() {
  loading.value = true
  try {
    report.value = await api(`/api/admin/reports/${type.value}`, { query: query() })
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    loading.value = false
  }
}
onMounted(run)
watch(type, run)

function exportUrl(format: 'xlsx' | 'pdf') {
  return `/api/reports/export?${new URLSearchParams({ type: type.value, format, lang: locale.value, ...query() })}`
}

const pct = (v: number) => h('span', { class: v >= 95 ? 'text-success' : v >= 85 ? 'text-warning' : 'text-error' }, `${v}%`)
const columns = computed<TableColumn<any>[]>(() => {
  const who: TableColumn<any>[] = [
    { id: 'code', header: t('fields.code'), cell: ({ row }) => h('span', { dir: 'ltr', class: 'font-mono' }, row.original.code) },
    { id: 'name', header: t('fields.name'), cell: ({ row }) => f.name(row.original) },
    { id: 'dept', header: t('fields.department'), cell: ({ row }) => f.label({ name_ar: row.original.departmentAr, name_en: row.original.departmentEn }) },
  ]
  if (type.value === 'daily') {
    return [...who,
      { id: 'date', header: t('fields.date'), cell: ({ row }) => f.date(row.original.date) },
      { id: 'status', header: t('fields.status'), cell: ({ row }) => t(`status.${row.original.status}`) },
      { id: 'in', header: t('attendanceAdmin.in'), cell: ({ row }) => f.time(row.original.checkIn) },
      { id: 'out', header: t('attendanceAdmin.out'), cell: ({ row }) => f.time(row.original.checkOut) },
      { id: 'net', header: t('home.worked'), cell: ({ row }) => f.hm(row.original.netMinutes) },
      { id: 'brk', header: t('reports.break'), cell: ({ row }) => f.hm(row.original.breakMinutes) },
      { id: 'late', header: t('dashboard.late'), cell: ({ row }) => f.hm(row.original.lateMinutes) },
      { id: 'ot', header: t('reports.overtime'), cell: ({ row }) => f.hm(row.original.overtimeMinutes) },
      { id: 'short', header: t('reports.missing'), cell: ({ row }) => f.hm(row.original.shortageMinutes) },
    ]
  }
  return [...who,
    { id: 'period', header: t('reports.period'), cell: ({ row }) => (type.value === 'weekly' ? `${f.date(row.original.from)} → ${f.date(row.original.to)}` : row.original.period) },
    { id: 'net', header: t('reports.totalHours'), cell: ({ row }) => f.hm(row.original.netMinutes) },
    { id: 'req', header: t('reports.requiredHours'), cell: ({ row }) => f.hm(row.original.requiredMinutes) },
    { id: 'ot', header: t('reports.overtime'), cell: ({ row }) => f.hm(row.original.overtimeMinutes) },
    { id: 'short', header: t('reports.shortage'), cell: ({ row }) => f.hm(row.original.shortageMinutes) },
    ...(type.value === 'monthly' ? [{ id: 'late', header: t('reports.lateArrivals'), cell: ({ row }: any) => row.original.lateCount }] : []),
    { id: 'abs', header: t('reports.absenceDays'), cell: ({ row }) => row.original.absenceDays },
    { id: 'leave', header: t('reports.leaveDays'), cell: ({ row }) => row.original.leaveDays },
    ...(type.value === 'monthly' ? [{ id: 'pct', header: t('reports.attendanceRate'), cell: ({ row }: any) => pct(row.original.attendancePercentage) }] : []),
  ]
})
const empItems = computed(() => [{ value: 'all', label: t('common.all') }, ...((people.value?.employees ?? []).map((e: any) => ({ value: e.id, label: `${f.name(one(e.profile))} (${e.employee_code})` })))])
</script>

<template>
  <AdminPage :title="t('admin.nav.reports')">
    <UTabs v-model="type" :items="[{ label: t('reports.daily'), value: 'daily' }, { label: t('reports.weekly'), value: 'weekly' }, { label: t('reports.monthly'), value: 'monthly' }]" :content="false" class="mb-4" />
    <div class="mb-4 flex flex-wrap items-end gap-2">
      <UFormField :label="t('common.from')">
        <UInput v-model="filters.from" type="date" />
      </UFormField>
      <UFormField :label="t('common.to')">
        <UInput v-model="filters.to" type="date" />
      </UFormField>
      <UFormField :label="t('fields.department')">
        <USelect v-model="filters.departmentId" :items="[{ value: 'all', label: t('common.all') }, ...departments.map(d => ({ value: d.id, label: f.label(d) }))]" class="w-44" />
      </UFormField>
      <UFormField :label="t('fields.name')">
        <USelectMenu v-model="filters.employeeId" value-key="value" :items="empItems" class="w-56" />
      </UFormField>
      <UButton icon="i-lucide-play" :loading="loading" :label="t('reports.run')" @click="run" />
      <template v-if="auth.can('reports.export')">
        <UButton :to="exportUrl('xlsx')" external target="_blank" color="neutral" variant="outline" icon="i-lucide-file-spreadsheet" :label="t('reports.excel')" />
        <UButton :to="exportUrl('pdf')" external target="_blank" color="neutral" variant="outline" icon="i-lucide-file-text" :label="t('reports.pdf')" />
      </template>
    </div>

    <div v-if="report" class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard :label="t('reports.totalHours')" :value="f.duration(report.totals.netMinutes)" icon="i-lucide-clock" />
      <StatCard :label="t('reports.requiredHours')" :value="f.duration(report.totals.requiredMinutes)" icon="i-lucide-target" color="neutral" />
      <StatCard :label="t('reports.overtime')" :value="f.duration(report.totals.overtimeMinutes)" icon="i-lucide-trending-up" color="success" />
      <StatCard :label="t('reports.shortage')" :value="f.duration(report.totals.shortageMinutes)" icon="i-lucide-trending-down" color="error" />
    </div>
    <p v-if="report" class="mb-2 text-xs text-muted">
      {{ t('reports.basis', { basis: t(`policy.options.${report.basis}`) }) }} · {{ t('reports.employees', { n: report.employees }) }} · {{ report.timezone }}
    </p>
    <UTable :data="report?.items ?? []" :columns="columns" :loading="loading" :empty="t('common.empty')" class="rounded-lg border border-default" />
  </AdminPage>
</template>
