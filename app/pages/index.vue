<script setup lang="ts">
import type { AttendanceAction } from '#shared/constants'

definePageMeta({ employeeOnly: true })
const { t } = useI18n()
const f = useFormat()
const auth = useAuth()
const toast = useToast()
const api = useApi()
const flow = useAttendanceFlow()
const online = useOnline()

interface TodayResponse {
  employee: { code: string, jobTitle: string | null, department: { name_ar: string, name_en: string } | null, office: { name_ar: string, name_en: string } | null } | null
  serverTime: string
  timezone: string
  workDate: string
  state: { openSession: { checkInAt: string, workDate: string } | null, openBreak: { startedAt: string } | null, allowedActions: AttendanceAction[] }
  schedule: { startTime: string | null, endTime: string | null, requiredMinutes: number, isFlexible: boolean } | null
  today: { status: string, netMinutes: number, requiredMinutes: number, remainingMinutes: number, overtimeMinutes: number, shortageMinutes: number, lateMinutes: number, breakMinutes: number, firstCheckIn: string | null, lastCheckOut: string | null, isWorkingDay: boolean, isHoliday: boolean, leaveFraction: number } | null
  recent: Array<{ work_date: string, status: string, first_check_in: string | null, last_check_out: string | null, net_minutes: number, overtime_minutes: number, shortage_minutes: number, late_minutes: number }>
  geofences: Array<{ id: string, name: string, latitude: number, longitude: number, radius_m: number, max_accuracy_m: number }>
  device: { registered: boolean, pendingApproval: boolean }
}

const { data, refresh, status } = await useAsyncData('me-today', () => api<TodayResponse>('/api/me/today'), { server: false })
watch(() => data.value?.timezone, (tz) => {
  if (tz) f.tz.value = tz
}, { immediate: true })

// live clock + live working-time ticker
const now = ref(new Date())
const fetchedAt = ref(Date.now())
watch(data, () => (fetchedAt.value = Date.now()))
let tick: ReturnType<typeof setInterval> | undefined
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  tick = setInterval(() => (now.value = new Date()), 1000)
  poll = setInterval(async () => {
    try {
      data.value = await api<TodayResponse>('/api/me/today', { query: { passive: '1' } })
    }
    catch {}
  }, 60_000)
})
onBeforeUnmount(() => {
  clearInterval(tick)
  clearInterval(poll)
})

const working = computed(() => !!data.value?.state.openSession && !data.value?.state.openBreak)
const liveNet = computed(() => {
  const base = data.value?.today?.netMinutes ?? 0
  return working.value ? base + Math.max(0, Math.floor((now.value.getTime() - fetchedAt.value) / 60_000)) : base
})
const required = computed(() => data.value?.today?.requiredMinutes ?? 0)
const progress = computed(() => (required.value > 0 ? Math.min(100, Math.round((liveNet.value / required.value) * 100)) : 0))
const overtime = computed(() => Math.max(0, liveNet.value - required.value))

const primaryAction = computed<AttendanceAction>(() => (data.value?.state.openSession ? 'check_out' : 'check_in'))
const breakAction = computed<AttendanceAction | null>(() => {
  const s = data.value?.state
  if (!s?.openSession) return null
  return s.openBreak ? 'break_end' : 'break_start'
})
// Wait for a fix as precise as the configured limit (the server applies the same value).
// With several geofences the strictest limit is used, so whichever fence applies accepts it.
const targetAccuracy = computed(() => {
  const limits = (data.value?.geofences ?? []).map(g => g.max_accuracy_m).filter(n => n > 0)
  return limits.length ? Math.min(...limits) : 50
})

const statusLine = computed(() => {
  const s = data.value?.state
  if (s?.openBreak) return t('home.onBreakSince', { time: f.time(s.openBreak.startedAt) })
  if (s?.openSession) return t('home.workingSince', { time: f.time(s.openSession.checkInAt) })
  if (data.value?.today?.lastCheckOut) return t('home.checkedOutAt', { time: f.time(data.value.today.lastCheckOut) })
  return t('home.notCheckedIn')
})

const panelOpen = ref(false)
const currentAction = ref<AttendanceAction>('check_in')
async function start(action: AttendanceAction) {
  currentAction.value = action
  panelOpen.value = true
  const res = await flow.run(action, targetAccuracy.value)
  if (res?.ok) {
    toast.add({ title: t(`actions.done.${action}`), description: res.occurredAt ? f.time(res.occurredAt) : undefined, color: 'success', icon: 'i-lucide-circle-check' })
    if (navigator.vibrate) navigator.vibrate(60)
    await refresh()
    setTimeout(() => (panelOpen.value = false), 1600)
  }
}
const fixForMap = computed(() => (flow.fix.value ? { latitude: flow.fix.value.latitude, longitude: flow.fix.value.longitude, accuracy: flow.fix.value.accuracy } : null))
useHead({ title: () => t('nav.attendance') })
</script>

<template>
  <div class="space-y-4">
    <!-- clock + identity -->
    <UCard :ui="{ body: 'p-4 sm:p-5' }">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm text-muted">
            {{ f.longDate(now) }}
          </p>
          <p class="ltr-nums text-4xl font-bold tabular-nums text-highlighted" style="direction: ltr; text-align: start" aria-live="off">
            {{ f.clock(now) }}
          </p>
        </div>
        <div class="text-end">
          <p class="font-semibold">
            {{ auth.displayName.value }}
          </p>
          <p class="text-xs text-muted">
            {{ data?.employee?.jobTitle }}<template v-if="data?.employee?.department">
              · {{ f.label(data.employee.department) }}
            </template>
          </p>
          <UBadge v-if="data?.employee" color="neutral" variant="outline" size="sm" class="ltr-nums mt-1">
            {{ data.employee.code }}
          </UBadge>
        </div>
      </div>
    </UCard>

    <UAlert v-if="data && !data.device.registered" :color="data.device.pendingApproval ? 'info' : 'warning'" variant="subtle" icon="i-lucide-fingerprint"
            :title="data.device.pendingApproval ? t('home.devicePending') : t('home.noDevice')"
            :description="data.device.pendingApproval ? t('home.devicePendingBody') : t('home.noDeviceBody')"
            :actions="data.device.pendingApproval ? [] : [{ label: t('devices.register'), to: '/devices', color: 'warning' }]"
    />

    <!-- status + action -->
    <UCard :ui="{ body: 'p-5' }">
      <div v-if="status === 'pending' && !data" class="space-y-3">
        <USkeleton class="h-6 w-1/2" />
        <USkeleton class="h-16 w-full" />
      </div>
      <template v-else-if="data">
        <div class="mb-4 flex items-center justify-between gap-2">
          <div>
            <p class="text-sm text-muted">
              {{ t('home.status') }}
            </p>
            <p class="text-lg font-bold">
              {{ statusLine }}
            </p>
          </div>
          <StatusBadge v-if="data.today" :status="data.today.status" />
        </div>

        <UButton
          block
          size="xl"
          class="h-16 text-lg font-bold"
          :color="primaryAction === 'check_in' ? 'primary' : 'error'"
          :icon="primaryAction === 'check_in' ? 'i-lucide-log-in' : 'i-lucide-log-out'"
          :label="t(`actions.${primaryAction}`)"
          :disabled="!online || flow.running.value || !data.device.registered"
          :loading="flow.running.value && currentAction === primaryAction"
          @click="start(primaryAction)"
        />
        <UButton
          v-if="breakAction"
          block
          size="lg"
          class="mt-2"
          color="neutral"
          variant="outline"
          :icon="breakAction === 'break_start' ? 'i-lucide-coffee' : 'i-lucide-briefcase'"
          :label="t(`actions.${breakAction}`)"
          :disabled="!online || flow.running.value || !data.device.registered"
          :loading="flow.running.value && currentAction === breakAction"
          @click="start(breakAction)"
        />
        <p v-if="!online" class="mt-2 text-center text-sm font-medium text-warning" role="status">
          {{ t('reasons.offline') }}
        </p>
      </template>
    </UCard>

    <!-- verification panel -->
    <UCard v-if="panelOpen" :ui="{ body: 'p-4' }">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-bold">
          {{ t('verify.title') }} — {{ t(`actions.${currentAction}`) }}
        </h2>
        <UButton v-if="!flow.running.value" color="neutral" variant="ghost" icon="i-lucide-x" size="sm" :aria-label="t('common.close')" @click="panelOpen = false" />
      </div>
      <VerificationSteps :steps="flow.steps" :general="flow.generalReasons.value" />
      <div v-if="!flow.running.value && !flow.result.value?.ok" class="mt-3 flex gap-2">
        <UButton class="flex-1" icon="i-lucide-rotate-cw" :label="t('common.retry')" :disabled="!online" @click="start(currentAction)" />
      </div>
      <UAlert v-if="flow.result.value?.ok" class="mt-3" color="success" variant="solid" icon="i-lucide-circle-check" :title="t(`actions.done.${currentAction}`)" :description="flow.result.value.occurredAt ? f.time(flow.result.value.occurredAt) : ''" />
      <ClientOnly>
        <GeofenceMap v-if="data?.geofences.length && fixForMap" class="mt-3" :fences="data.geofences" :position="fixForMap" height="12rem" />
      </ClientOnly>
      <p class="mt-3 text-xs text-muted">
        {{ t('verify.biometricNote') }}
      </p>
    </UCard>

    <!-- today -->
    <UCard v-if="data?.today" :ui="{ body: 'p-5' }">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="font-bold">
          {{ t('home.today') }}
        </h2>
        <p v-if="data.schedule?.startTime" class="ltr-nums text-xs text-muted">
          {{ data.schedule.startTime.slice(0, 5) }} – {{ data.schedule.endTime?.slice(0, 5) }}
        </p>
      </div>
      <template v-if="data.today.isWorkingDay">
        <UProgress :model-value="progress" :color="progress >= 100 ? 'success' : 'primary'" size="lg" :aria-label="t('home.progress')" />
        <div class="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <p class="text-xs text-muted">
              {{ t('home.worked') }}
            </p>
            <p class="font-bold tabular-nums">
              {{ f.duration(liveNet) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted">
              {{ t('home.remaining') }}
            </p>
            <p class="font-bold tabular-nums">
              {{ f.duration(Math.max(0, required - liveNet)) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted">
              {{ overtime > 0 ? t('home.overtime') : t('home.required') }}
            </p>
            <p class="font-bold tabular-nums" :class="overtime > 0 ? 'text-success' : ''">
              {{ overtime > 0 ? `+${f.duration(overtime)}` : f.duration(required) }}
            </p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge v-if="data.today.lateMinutes > 0" color="warning" variant="subtle" icon="i-lucide-clock-alert">
            {{ t('home.late', { m: data.today.lateMinutes }) }}
          </UBadge>
          <UBadge v-if="data.today.breakMinutes > 0" color="neutral" variant="subtle" icon="i-lucide-coffee">
            {{ t('home.breakTaken', { d: f.duration(data.today.breakMinutes) }) }}
          </UBadge>
          <UBadge v-if="data.today.shortageMinutes > 0" color="error" variant="subtle" icon="i-lucide-trending-down">
            {{ t('home.shortage', { d: f.duration(data.today.shortageMinutes) }) }}
          </UBadge>
        </div>
      </template>
      <p v-else class="text-sm text-muted">
        {{ data.today.isHoliday ? t('home.holidayToday') : t('home.dayOff') }}
        <template v-if="liveNet > 0">
          — {{ t('home.worked') }}: {{ f.duration(liveNet) }}
        </template>
      </p>
    </UCard>

    <!-- recent -->
    <UCard v-if="data?.recent.length" :ui="{ body: 'p-0' }">
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-bold">
            {{ t('home.recent') }}
          </h2>
          <UButton to="/history" variant="link" size="sm" :label="t('common.viewAll')" />
        </div>
      </template>
      <ul class="divide-y divide-default">
        <li v-for="d in data.recent" :key="d.work_date" class="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p class="font-medium">
              {{ f.date(d.work_date) }}
            </p>
            <p class="ltr-nums text-xs text-muted" style="direction: inherit">
              {{ f.time(d.first_check_in) }} → {{ f.time(d.last_check_out) }}
            </p>
          </div>
          <div class="text-end">
            <StatusBadge :status="d.status" size="sm" />
            <p class="mt-0.5 text-xs tabular-nums text-muted">
              {{ f.duration(d.net_minutes) }}
              <span v-if="d.overtime_minutes" class="text-success">+{{ f.hm(d.overtime_minutes) }}</span>
              <span v-if="d.shortage_minutes" class="text-error">−{{ f.hm(d.shortage_minutes) }}</span>
            </p>
          </div>
        </li>
      </ul>
    </UCard>
  </div>
</template>
