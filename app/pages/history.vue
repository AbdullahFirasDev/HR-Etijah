<script setup lang="ts">
definePageMeta({ employeeOnly: true })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()
const toast = useToast()
const errorText = useApiError()

const range = reactive({ from: '', to: '' })
const { data, refresh, status } = await useAsyncData('me-history', () => api<any>('/api/me/history', { query: range.from ? { ...range } : {} }), { server: false })
watch(data, (d) => {
  if (d && !range.from) {
    range.from = d.from
    range.to = d.to
  }
})

const sessionsByDate = computed(() => {
  const m = new Map<string, any[]>()
  for (const s of data.value?.sessions ?? []) m.set(s.work_date, [...(m.get(s.work_date) ?? []), s])
  return m
})

// correction request
const typesForEmployee = ['add_interval', 'add_check_out', 'correct_check_in', 'correct_check_out', 'add_break'] as const
const modal = ref(false)
const saving = ref(false)
const form = reactive({ workDate: '', type: 'add_check_out' as (typeof typesForEmployee)[number], targetSessionId: '' as string | undefined, startTime: '', endTime: '', reason: '' })
const typeItems = computed(() => typesForEmployee.map(v => ({ value: v, label: t(`adjust.types.${v}`) })))
const daySessions = computed(() => (sessionsByDate.value.get(form.workDate) ?? []).map((s: any) => ({ value: s.id, label: `${f.time(s.check_in_at)} → ${f.time(s.check_out_at)}` })))
const needsSession = computed(() => form.type !== 'add_interval')
const needsStart = computed(() => ['add_interval', 'correct_check_in', 'add_break'].includes(form.type))
const needsEnd = computed(() => ['add_interval', 'add_check_out', 'correct_check_out', 'add_break'].includes(form.type))

function openRequest(date: string) {
  Object.assign(form, { workDate: date, type: sessionsByDate.value.get(date)?.length ? 'add_check_out' : 'add_interval', targetSessionId: sessionsByDate.value.get(date)?.[0]?.id, startTime: '', endTime: '', reason: '' })
  modal.value = true
}

/** Local wall-clock time on the work date (org timezone) → ISO instant with offset. */
function toInstant(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`)
  const offsetMin = (new Date(guess.toLocaleString('en-US', { timeZone: f.tz.value })).getTime() - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()) / 60000
  return new Date(guess.getTime() - offsetMin * 60000).toISOString()
}

async function submitRequest() {
  saving.value = true
  try {
    const r = await api<{ status: string }>('/api/adjustments', {
      method: 'POST',
      body: {
        employeeId: auth.user.value!.employee!.id,
        workDate: form.workDate,
        type: form.type,
        targetSessionId: needsSession.value ? form.targetSessionId : null,
        newStartAt: needsStart.value && form.startTime ? toInstant(form.workDate, form.startTime) : null,
        newEndAt: needsEnd.value && form.endTime ? toInstant(form.endTime < form.startTime && form.type === 'add_interval' ? nextDay(form.workDate) : form.workDate, form.endTime) : null,
        reason: form.reason,
      },
    })
    toast.add({ title: r.status === 'approved' ? t('adjust.applied') : t('adjust.submitted'), color: 'success' })
    modal.value = false
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
function nextDay(d: string) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">
        {{ t('history.title') }}
      </h1>
    </div>
    <UCard :ui="{ body: 'p-3' }">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField :label="t('common.from')">
          <UInput v-model="range.from" type="date" />
        </UFormField>
        <UFormField :label="t('common.to')">
          <UInput v-model="range.to" type="date" />
        </UFormField>
        <UButton icon="i-lucide-search" :label="t('common.apply')" :loading="status === 'pending'" @click="refresh()" />
      </div>
    </UCard>

    <div v-if="status === 'pending' && !data" class="space-y-2">
      <USkeleton v-for="i in 5" :key="i" class="h-20" />
    </div>
    <UCard v-for="d in data?.days ?? []" :key="d.date" :ui="{ body: 'p-4' }">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="font-semibold">
            {{ f.date(d.date, { weekday: 'long', day: 'numeric', month: 'long' }) }}
          </p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <StatusBadge :status="d.status" size="sm" />
            <UBadge v-if="d.lateMinutes" color="warning" variant="subtle" size="sm">
              {{ t('home.late', { m: d.lateMinutes }) }}
            </UBadge>
            <UBadge v-if="d.overtimeMinutes" color="success" variant="subtle" size="sm">
              +{{ f.duration(d.overtimeMinutes) }}
            </UBadge>
            <UBadge v-if="d.shortageMinutes" color="error" variant="subtle" size="sm">
              −{{ f.duration(d.shortageMinutes) }}
            </UBadge>
          </div>
        </div>
        <div class="text-end">
          <p class="font-bold tabular-nums">
            {{ f.duration(d.netMinutes) }}
          </p>
          <p class="text-xs text-muted">
            {{ t('history.of') }} {{ f.duration(d.requiredMinutes) }}
          </p>
        </div>
      </div>
      <ul v-if="sessionsByDate.get(d.date)?.length" class="mt-3 space-y-1 border-t border-default pt-2 text-sm">
        <li v-for="s in sessionsByDate.get(d.date)" :key="s.id" class="flex items-center justify-between">
          <span class="ltr-nums" style="direction: inherit">{{ f.time(s.check_in_at) }} → {{ f.time(s.check_out_at) }}</span>
          <span class="text-xs text-muted">
            <template v-if="s.breaks?.length">{{ t('history.breaks', { n: s.breaks.filter((b: any) => b.status !== 'voided').length }) }}</template>
            <UBadge v-if="s.closed_by === 'adjustment'" color="info" variant="outline" size="sm" class="ms-1">{{ t('history.corrected') }}</UBadge>
            <UBadge v-if="s.status === 'missing_checkout'" color="warning" variant="outline" size="sm" class="ms-1">{{ t('status.missing_checkout') }}</UBadge>
          </span>
        </li>
      </ul>
      <div class="mt-2 flex justify-end">
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-file-pen-line" :label="t('adjust.request')" @click="openRequest(d.date)" />
      </div>
    </UCard>

    <UCard v-if="data?.adjustments?.length">
      <template #header>
        <h2 class="font-bold">
          {{ t('adjust.myRequests') }}
        </h2>
      </template>
      <ul class="divide-y divide-default text-sm">
        <li v-for="a in data.adjustments" :key="a.id" class="flex items-center justify-between gap-2 py-2">
          <div>
            <p class="font-medium">
              {{ t(`adjust.types.${a.adjustment_type}`) }} — {{ f.date(a.work_date) }}
            </p>
            <p class="text-xs text-muted">
              {{ a.reason }}
            </p>
            <p v-if="a.review_note" class="text-xs text-muted">
              ↳ {{ a.review_note }}
            </p>
          </div>
          <StatusBadge :status="a.status" size="sm" />
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="modal" :title="t('adjust.request')" :description="f.date(form.workDate, { weekday: 'long', day: 'numeric', month: 'long' })">
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('adjust.type')">
            <USelect v-model="form.type" :items="typeItems" class="w-full" />
          </UFormField>
          <UFormField v-if="needsSession" :label="t('adjust.session')">
            <USelect v-model="form.targetSessionId" :items="daySessions" class="w-full" :placeholder="t('adjust.noSessions')" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField v-if="needsStart" :label="t('adjust.start')">
              <UInput v-model="form.startTime" type="time" />
            </UFormField>
            <UFormField v-if="needsEnd" :label="t('adjust.end')">
              <UInput v-model="form.endTime" type="time" />
            </UFormField>
          </div>
          <UFormField :label="t('adjust.reason')" required :help="t('adjust.reasonHelp')">
            <UTextarea v-model="form.reason" class="w-full" :rows="3" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="modal = false" />
          <UButton :loading="saving" :disabled="form.reason.trim().length < 5" :label="t('common.submit')" @click="submitRequest" />
        </div>
      </template>
    </UModal>
  </div>
</template>
