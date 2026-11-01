<script setup lang="ts">
definePageMeta({ employeeOnly: true })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const toast = useToast()
const errorText = useApiError()

const { data, refresh } = await useAsyncData('me-leave', () => api<any>('/api/me/leave'), { server: false })

const modal = ref(false)
const saving = ref(false)
const form = reactive({ leaveTypeId: '', startDate: '', endDate: '', isHalfDay: false, reason: '' })
const typeItems = computed(() => (data.value?.types ?? []).map((x: any) => ({ value: x.id, label: f.label(x) })))
const selectedType = computed(() => data.value?.types.find((x: any) => x.id === form.leaveTypeId))

function open() {
  const today = f.todayIso()
  Object.assign(form, { leaveTypeId: data.value?.types[0]?.id ?? '', startDate: today, endDate: today, isHalfDay: false, reason: '' })
  modal.value = true
}
watch(() => form.isHalfDay, (v) => {
  if (v) form.endDate = form.startDate
})

async function submit() {
  saving.value = true
  try {
    const r = await api<{ days_count: number }>('/api/leave', { method: 'POST', body: { ...form, reason: form.reason || undefined } })
    toast.add({ title: t('leave.submitted', { n: r.days_count }), color: 'success' })
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

async function cancel(id: string) {
  try {
    await api(`/api/leave/${id}/cancel`, { method: 'POST', body: {} })
    toast.add({ title: t('leave.cancelled'), color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
const canCancel = (r: any) => ['pending', 'manager_approved'].includes(r.status) || (r.status === 'approved' && r.start_date > f.todayIso())
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">
        {{ t('leave.title') }}
      </h1>
      <UButton icon="i-lucide-plus" :label="t('leave.new')" @click="open" />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <UCard v-for="b in (data?.balances ?? []).filter((b: any) => b.tracks_balance)" :key="b.leave_type_id" :ui="{ body: 'p-4' }">
        <p class="text-sm text-muted">
          {{ f.label(b) }}
        </p>
        <p class="text-2xl font-bold tabular-nums">
          {{ Number(b.remaining_days) }}
        </p>
        <p class="text-xs text-muted">
          {{ t('leave.balanceLine', { used: Number(b.used_days), total: Number(b.allocated_days) + Number(b.carried_over_days), pending: Number(b.pending_days) }) }}
        </p>
      </UCard>
    </div>

    <UCard :ui="{ body: 'p-0' }">
      <template #header>
        <h2 class="font-bold">
          {{ t('leave.history') }}
        </h2>
      </template>
      <p v-if="!data?.requests?.length" class="p-4 text-sm text-muted">
        {{ t('common.empty') }}
      </p>
      <ul class="divide-y divide-default">
        <li v-for="r in data?.requests ?? []" :key="r.id" class="flex items-start justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <p class="font-medium">
              {{ f.label(r.leave_type) }}
              <span class="text-sm text-muted">· {{ t('leave.days', { n: Number(r.days_count) }) }}</span>
            </p>
            <p class="text-sm text-muted">
              {{ f.date(r.start_date) }} → {{ f.date(r.end_date) }}<template v-if="r.is_half_day">
                ({{ t('leave.halfDay') }})
              </template>
            </p>
            <p v-if="r.review_note || r.manager_note" class="text-xs text-muted">
              ↳ {{ r.review_note || r.manager_note }}
            </p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <StatusBadge :status="r.status" size="sm" />
            <UButton v-if="canCancel(r)" size="xs" color="error" variant="ghost" :label="t('common.cancel')" @click="cancel(r.id)" />
          </div>
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="modal" :title="t('leave.new')">
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('leave.type')" required>
            <USelect v-model="form.leaveTypeId" :items="typeItems" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="t('common.from')" required>
              <UInput v-model="form.startDate" type="date" />
            </UFormField>
            <UFormField :label="t('common.to')" required>
              <UInput v-model="form.endDate" type="date" :disabled="form.isHalfDay" :min="form.startDate" />
            </UFormField>
          </div>
          <USwitch v-if="selectedType?.allow_half_day" v-model="form.isHalfDay" :label="t('leave.halfDay')" />
          <UFormField :label="t('leave.reason')">
            <UTextarea v-model="form.reason" class="w-full" :rows="3" />
          </UFormField>
          <p class="text-xs text-muted">
            {{ t('leave.countNote') }}
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="modal = false" />
          <UButton :loading="saving" :disabled="!form.leaveTypeId || !form.startDate || !form.endDate" :label="t('common.submit')" @click="submit" />
        </div>
      </template>
    </UModal>
  </div>
</template>
