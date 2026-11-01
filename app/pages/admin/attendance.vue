<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, resolveComponent } from 'vue'

definePageMeta({ layout: 'admin', permission: 'attendance.read' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()
const toast = useToast()
const errorText = useApiError()
const route = useRoute()
const UButton = resolveComponent('UButton')
const StatusBadge = resolveComponent('StatusBadge')

const tab = ref(String(route.query.tab ?? 'daily'))
const tabs = computed(() => [
  { label: t('attendanceAdmin.daily'), value: 'daily', icon: 'i-lucide-calendar-days' },
  { label: t('attendanceAdmin.adjustments'), value: 'adjustments', icon: 'i-lucide-file-pen-line' },
  { label: t('attendanceAdmin.periods'), value: 'periods', icon: 'i-lucide-lock' },
])

// ---------------- daily records
const { data: departments } = await useAsyncData('departments-list', () => api<any[]>('/api/admin/resources/departments'), { server: false, default: () => [] })
const filters = reactive({ from: f.todayIso(), to: f.todayIso(), departmentId: 'all' })
const { data: report, status, refresh } = await useAsyncData('attendance-daily', () => api<any>('/api/admin/reports/daily', {
  query: { from: filters.from, to: filters.to, ...(filters.departmentId !== 'all' ? { departmentId: filters.departmentId } : {}) },
}), { server: false })
const dailyColumns = computed<TableColumn<any>[]>(() => [
  { accessorKey: 'date', header: t('fields.date'), cell: ({ row }) => f.date(row.original.date) },
  { id: 'name', header: t('fields.name'), cell: ({ row }) => f.name(row.original) },
  { id: 'status', header: t('fields.status'), cell: ({ row }) => h(StatusBadge, { status: row.original.status, size: 'sm' }) },
  { id: 'in', header: t('attendanceAdmin.in'), cell: ({ row }) => f.time(row.original.checkIn) },
  { id: 'out', header: t('attendanceAdmin.out'), cell: ({ row }) => f.time(row.original.checkOut) },
  { id: 'net', header: t('home.worked'), cell: ({ row }) => f.hm(row.original.netMinutes) },
  { id: 'late', header: t('dashboard.late'), cell: ({ row }) => row.original.lateMinutes ? h('span', { class: 'text-warning' }, f.hm(row.original.lateMinutes)) : '—' },
  { id: 'ot', header: t('reports.overtime'), cell: ({ row }) => row.original.overtimeMinutes ? h('span', { class: 'text-success' }, f.hm(row.original.overtimeMinutes)) : '—' },
  { id: 'short', header: t('reports.shortage'), cell: ({ row }) => row.original.shortageMinutes ? h('span', { class: 'text-error' }, f.hm(row.original.shortageMinutes)) : '—' },
  { id: 'actions', header: '', cell: ({ row }) => h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-search', 'aria-label': t('attendanceAdmin.details'), onClick: () => openDay(row.original) }) },
])

// ---------------- day details + correction
const dayOpen = ref(false)
const dayRow = ref<any>(null)
const day = ref<any>(null)
async function openDay(row: any) {
  dayRow.value = row
  day.value = null
  dayOpen.value = true
  day.value = await api('/api/admin/attendance/day', { query: { employeeId: row.employeeId, date: row.date } })
}
const adj = reactive({ type: 'add_interval', targetSessionId: '', targetBreakId: '', start: '', end: '', reason: '' })
const adjTypes = computed(() => ['add_interval', 'add_check_out', 'correct_check_in', 'correct_check_out', 'void_session', 'add_break', 'void_break'].map(v => ({ value: v, label: t(`adjust.types.${v}`) })))
const sessionItems = computed(() => (day.value?.sessions ?? []).filter((s: any) => s.status !== 'voided').map((s: any) => ({ value: s.id, label: `${f.time(s.check_in_at)} → ${f.time(s.check_out_at)} (${t(`sessionStatus.${s.status}`)})` })))
const breakItems = computed(() => (day.value?.sessions ?? []).flatMap((s: any) => (s.breaks ?? []).filter((b: any) => b.status !== 'voided').map((b: any) => ({ value: b.id, label: `${f.time(b.started_at)} → ${f.time(b.ended_at)}` }))))
function toInstant(date: string, time: string, nextDay = false): string {
  const d = nextDay ? new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : date
  const guess = new Date(`${d}T${time}:00Z`)
  const offset = (new Date(guess.toLocaleString('en-US', { timeZone: f.tz.value })).getTime() - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()) / 60000
  return new Date(guess.getTime() - offset * 60000).toISOString()
}
const savingAdj = ref(false)
async function submitAdjustment() {
  savingAdj.value = true
  try {
    const date = dayRow.value.date
    const r = await api<{ status: string }>('/api/adjustments', {
      method: 'POST',
      body: {
        employeeId: dayRow.value.employeeId,
        workDate: date,
        type: adj.type,
        targetSessionId: adj.type !== 'add_interval' && adj.type !== 'void_break' ? adj.targetSessionId || null : null,
        targetBreakId: adj.type === 'void_break' ? adj.targetBreakId || null : null,
        newStartAt: adj.start ? toInstant(date, adj.start) : null,
        newEndAt: adj.end ? toInstant(date, adj.end, !!adj.start && adj.end < adj.start) : null,
        reason: adj.reason,
      },
    })
    toast.add({ title: r.status === 'approved' ? t('adjust.applied') : t('adjust.submitted'), color: 'success' })
    Object.assign(adj, { reason: '', start: '', end: '' })
    await openDay(dayRow.value)
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    savingAdj.value = false
  }
}

// ---------------- adjustments review
const adjStatus = ref('pending')
const { data: adjustments, refresh: refreshAdj } = await useAsyncData('adjustments', () => api<any[]>('/api/adjustments', { query: { status: adjStatus.value } }), { server: false, default: () => [], watch: [adjStatus] })
async function review(a: any, approve: boolean) {
  const note = approve ? '' : (prompt(t('adjust.rejectNote')) ?? '')
  try {
    await api(`/api/adjustments/${a.id}/review`, { method: 'POST', body: { approve, note: note || undefined } })
    toast.add({ title: approve ? t('adjust.applied') : t('adjust.rejected'), color: 'success' })
    await refreshAdj()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}

// ---------------- periods
const { data: locks, refresh: refreshLocks } = await useAsyncData('period-locks', () => api<any[]>('/api/admin/periods'), { server: false, default: () => [] })
const lockForm = reactive({ month: f.todayIso().slice(0, 7) })
async function setLock(year: number, month: number, locked: boolean) {
  if (locked && !confirm(t('periods.confirmLock', { period: `${year}-${String(month).padStart(2, '0')}` }))) return
  try {
    await api('/api/admin/periods/lock', { method: 'POST', body: { year, month, locked } })
    await refreshLocks()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
const recalcBusy = ref(false)
async function recalc() {
  recalcBusy.value = true
  try {
    const r = await api<{ days: number }>('/api/admin/recalculate', { method: 'POST', body: { from: filters.from, to: filters.to } })
    toast.add({ title: t('attendanceAdmin.recalculated', { n: r.days }), color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    recalcBusy.value = false
  }
}
</script>

<template>
  <AdminPage :title="t('admin.nav.attendance')">
    <UTabs v-model="tab" :items="tabs" :content="false" class="mb-4" />

    <!-- DAILY -->
    <template v-if="tab === 'daily'">
      <div class="mb-3 flex flex-wrap items-end gap-2">
        <UFormField :label="t('common.from')">
          <UInput v-model="filters.from" type="date" />
        </UFormField>
        <UFormField :label="t('common.to')">
          <UInput v-model="filters.to" type="date" />
        </UFormField>
        <UFormField :label="t('fields.department')">
          <USelect v-model="filters.departmentId" :items="[{ value: 'all', label: t('common.all') }, ...departments.map(d => ({ value: d.id, label: f.label(d) }))]" class="w-48" />
        </UFormField>
        <UButton icon="i-lucide-search" :label="t('common.apply')" :loading="status === 'pending'" @click="refresh()" />
        <UButton v-if="auth.can('attendance.adjust')" color="neutral" variant="outline" icon="i-lucide-calculator" :loading="recalcBusy" :label="t('attendanceAdmin.recalculate')" @click="recalc" />
      </div>
      <UTable :data="report?.items ?? []" :columns="dailyColumns" :loading="status === 'pending'" :empty="t('common.empty')" class="rounded-lg border border-default" />
    </template>

    <!-- ADJUSTMENTS -->
    <template v-else-if="tab === 'adjustments'">
      <div class="mb-3">
        <UTabs v-model="adjStatus" :items="['pending', 'approved', 'rejected'].map(s => ({ label: t(`status.${s}`), value: s }))" :content="false" size="xs" />
      </div>
      <UCard :ui="{ body: 'p-0' }">
        <p v-if="!adjustments.length" class="p-4 text-sm text-muted">
          {{ t('common.empty') }}
        </p>
        <ul class="divide-y divide-default">
          <li v-for="a in adjustments" :key="a.id" class="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <p class="font-medium">
                {{ f.name(one(one(a.employee)?.profile)) }} — {{ t(`adjust.types.${a.adjustment_type}`) }}
              </p>
              <p class="text-sm text-muted">
                {{ f.date(a.work_date) }}
                <span v-if="a.new_start_at" class="ltr-nums">· {{ t('adjust.start') }} {{ f.time(a.new_start_at) }}</span>
                <span v-if="a.new_end_at" class="ltr-nums">· {{ t('adjust.end') }} {{ f.time(a.new_end_at) }}</span>
              </p>
              <p class="text-sm">
                <UIcon name="i-lucide-quote" class="size-3 text-muted" /> {{ a.reason }}
              </p>
              <p v-if="a.review_note" class="text-xs text-muted">
                ↳ {{ a.review_note }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <StatusBadge :status="a.status" size="sm" />
              <template v-if="a.status === 'pending' && auth.can('attendance.adjust')">
                <UButton size="xs" color="success" icon="i-lucide-check" :label="t('common.approve')" @click="review(a, true)" />
                <UButton size="xs" color="error" variant="soft" icon="i-lucide-x" :label="t('common.reject')" @click="review(a, false)" />
              </template>
            </div>
          </li>
        </ul>
      </UCard>
    </template>

    <!-- PERIODS -->
    <template v-else>
      <UCard>
        <p class="mb-3 text-sm text-muted">
          {{ t('periods.hint') }}
        </p>
        <div v-if="auth.can('attendance.lock')" class="mb-4 flex items-end gap-2">
          <UFormField :label="t('periods.month')">
            <UInput v-model="lockForm.month" type="month" />
          </UFormField>
          <UButton icon="i-lucide-lock" :label="t('periods.lock')" @click="setLock(Number(lockForm.month.slice(0, 4)), Number(lockForm.month.slice(5, 7)), true)" />
        </div>
        <ul class="divide-y divide-default">
          <li v-for="l in locks" :key="`${l.year}-${l.month}`" class="flex items-center justify-between py-2 text-sm">
            <span class="ltr-nums font-medium">{{ l.year }}-{{ String(l.month).padStart(2, '0') }}</span>
            <span class="text-xs text-muted">{{ f.dateTime(l.locked_at) }}</span>
            <UButton v-if="auth.can('attendance.lock')" size="xs" color="warning" variant="soft" icon="i-lucide-lock-open" :label="t('periods.unlock')" @click="setLock(l.year, l.month, false)" />
          </li>
          <li v-if="!locks.length" class="py-2 text-sm text-muted">
            {{ t('periods.none') }}
          </li>
        </ul>
      </UCard>
    </template>

    <USlideover v-model:open="dayOpen" :title="dayRow ? `${f.name(dayRow)} — ${f.date(dayRow.date, { weekday: 'long', day: 'numeric', month: 'long' })}` : ''" :ui="{ content: 'max-w-xl' }">
      <template #body>
        <div v-if="!day" class="space-y-2">
          <USkeleton v-for="i in 4" :key="i" class="h-12" />
        </div>
        <div v-else class="space-y-4">
          <div v-if="day.day" class="grid grid-cols-3 gap-2 text-center text-sm">
            <div class="rounded-lg bg-elevated p-2">
              <p class="text-xs text-muted">{{ t('home.worked') }}</p><p class="font-bold">{{ f.hm(day.day.net_minutes) }}</p>
            </div>
            <div class="rounded-lg bg-elevated p-2">
              <p class="text-xs text-muted">{{ t('reports.overtime') }}</p><p class="font-bold text-success">{{ f.hm(day.day.overtime_minutes) }}</p>
            </div>
            <div class="rounded-lg bg-elevated p-2">
              <p class="text-xs text-muted">{{ t('reports.shortage') }}</p><p class="font-bold text-error">{{ f.hm(day.day.shortage_minutes) }}</p>
            </div>
          </div>
          <p v-if="day.day?.details?.formula" class="font-mono text-xs text-muted" dir="ltr">
            {{ day.day.details.formula.net }} · {{ day.day.details.formula.overtime }} · {{ day.day.details.formula.shortage }}
          </p>

          <div>
            <h3 class="mb-1 font-semibold">
              {{ t('attendanceAdmin.events') }}
            </h3>
            <p class="mb-2 text-xs text-muted">
              {{ t('attendanceAdmin.immutable') }}
            </p>
            <ul class="divide-y divide-default rounded-lg border border-default text-sm">
              <li v-for="e in day.events" :key="e.id" class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {{ t(`actions.${e.event_type}`) }}
                  <UBadge v-if="e.source !== 'employee'" size="sm" color="info" variant="outline">{{ t(`eventSource.${e.source}`) }}</UBadge>
                </span>
                <span class="ltr-nums text-xs text-muted">
                  {{ f.time(e.occurred_at) }}
                  <template v-if="e.distance_m != null"> · {{ Math.round(e.distance_m) }}m</template>
                  <template v-if="e.accuracy_m != null"> · ±{{ Math.round(e.accuracy_m) }}m</template>
                  <template v-if="e.client_ip"> · {{ e.client_ip }}</template>
                  <template v-if="e.risk_score"> · {{ t('security.risk') }} {{ e.risk_score }}</template>
                </span>
              </li>
              <li v-if="!day.events.length" class="px-3 py-2 text-muted">
                {{ t('common.empty') }}
              </li>
            </ul>
          </div>

          <div v-if="day.adjustments.length">
            <h3 class="mb-1 font-semibold">
              {{ t('attendanceAdmin.adjustments') }}
            </h3>
            <ul class="space-y-1 text-sm">
              <li v-for="a in day.adjustments" :key="a.id" class="flex items-center justify-between gap-2">
                <span>{{ t(`adjust.types.${a.adjustment_type}`) }} — {{ a.reason }}</span>
                <StatusBadge :status="a.status" size="sm" />
              </li>
            </ul>
          </div>

          <UCard v-if="auth.can('attendance.adjust') || auth.can('attendance.request_adjustment')">
            <template #header>
              <h3 class="font-semibold">
                {{ t('adjust.newCorrection') }}
              </h3>
            </template>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField :label="t('adjust.type')" class="sm:col-span-2">
                <USelect v-model="adj.type" :items="adjTypes" class="w-full" />
              </UFormField>
              <UFormField v-if="!['add_interval', 'void_break'].includes(adj.type)" :label="t('adjust.session')" class="sm:col-span-2">
                <USelect v-model="adj.targetSessionId" :items="sessionItems" class="w-full" />
              </UFormField>
              <UFormField v-if="adj.type === 'void_break'" :label="t('adjust.break')" class="sm:col-span-2">
                <USelect v-model="adj.targetBreakId" :items="breakItems" class="w-full" />
              </UFormField>
              <UFormField v-if="['add_interval', 'correct_check_in', 'add_break'].includes(adj.type)" :label="t('adjust.start')">
                <UInput v-model="adj.start" type="time" />
              </UFormField>
              <UFormField v-if="['add_interval', 'add_check_out', 'correct_check_out', 'add_break'].includes(adj.type)" :label="t('adjust.end')">
                <UInput v-model="adj.end" type="time" />
              </UFormField>
              <UFormField :label="t('adjust.reason')" required class="sm:col-span-2" :help="t('adjust.reasonHelp')">
                <UTextarea v-model="adj.reason" :rows="2" class="w-full" />
              </UFormField>
            </div>
            <UButton class="mt-3" :loading="savingAdj" :disabled="adj.reason.trim().length < 5" :label="auth.can('attendance.adjust') ? t('adjust.apply') : t('adjust.request')" @click="submitAdjustment" />
            <p class="mt-2 text-xs text-muted">
              {{ t('adjust.auditNote') }}
            </p>
          </UCard>
        </div>
      </template>
    </USlideover>
  </AdminPage>
</template>
