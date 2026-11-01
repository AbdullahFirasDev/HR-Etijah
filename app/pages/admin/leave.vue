<script setup lang="ts">
import type { FieldDef } from '~/components/ResourceManager.vue'

definePageMeta({ layout: 'admin', permission: 'leave.read' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()
const toast = useToast()
const errorText = useApiError()

const tab = ref('requests')
const statusFilter = ref('open')
const { data, refresh, status } = await useAsyncData('admin-leave', () => api<any>('/api/leave', { query: statusFilter.value === 'all' ? {} : { status: statusFilter.value } }), { server: false, watch: [statusFilter] })

const reviewOpen = ref(false)
const reviewing = ref<any>(null)
const note = ref('')
const busy = ref(false)
function openReview(r: any) {
  reviewing.value = r
  note.value = ''
  reviewOpen.value = true
}
async function decide(approve: boolean) {
  busy.value = true
  try {
    const r = await api<{ status: string }>(`/api/leave/${reviewing.value.id}/review`, { method: 'POST', body: { approve, note: note.value || undefined } })
    toast.add({ title: t(`status.${r.status}`), color: 'success' })
    reviewOpen.value = false
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    busy.value = false
  }
}
async function cancelRequest(r: any) {
  if (!confirm(t('leave.confirmCancel'))) return
  try {
    await api(`/api/leave/${r.id}/cancel`, { method: 'POST', body: {} })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
const canDecide = (r: any) => auth.can('leave.approve') && ['pending', 'manager_approved'].includes(r.status) && one(r.employee)?.id !== auth.user.value?.employee?.id

// file on behalf
const { data: employees } = await useAsyncData('leave-emps', () => (auth.can('leave.manage') ? api<any>('/api/admin/employees') : Promise.resolve({ employees: [] })), { server: false })
const { data: types } = await useAsyncData('leave-types', () => api<any[]>('/api/admin/resources/leave-types'), { server: false, default: () => [] })
const fileOpen = ref(false)
const fileForm = reactive({ employeeId: '', leaveTypeId: '', startDate: f.todayIso(), endDate: f.todayIso(), isHalfDay: false, reason: '' })
async function fileLeave() {
  busy.value = true
  try {
    await api('/api/leave', { method: 'POST', body: { ...fileForm, reason: fileForm.reason || undefined } })
    toast.add({ title: t('leave.filed'), color: 'success' })
    fileOpen.value = false
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

const typeFields = computed<FieldDef[]>(() => [
  { key: 'code', label: t('fields.code'), type: 'text', required: true, dir: 'ltr' },
  { key: 'name_ar', label: t('fields.nameAr'), type: 'text', required: true },
  { key: 'name_en', label: t('fields.nameEn'), type: 'text', required: true, dir: 'ltr', column: false },
  { key: 'is_paid', label: t('leaveTypes.paid'), type: 'switch' },
  { key: 'annual_allowance_days', label: t('leaveTypes.allowance'), type: 'number', min: 0, max: 365 },
  { key: 'tracks_balance', label: t('leaveTypes.tracksBalance'), type: 'switch' },
  { key: 'allow_half_day', label: t('leaveTypes.halfDay'), type: 'switch', column: false },
  { key: 'excluded_from_absence', label: t('leaveTypes.notAbsence'), type: 'switch', column: false },
  { key: 'excluded_from_shortage', label: t('leaveTypes.notShortage'), type: 'switch', column: false },
  { key: 'color', label: t('leaveTypes.color'), type: 'color', column: false },
  { key: 'is_active', label: t('fields.active'), type: 'switch' },
])
</script>

<template>
  <AdminPage :title="t('admin.nav.leave')">
    <template #actions>
      <UButton v-if="auth.can('leave.manage')" icon="i-lucide-plus" :label="t('leave.fileOnBehalf')" @click="fileOpen = true" />
    </template>
    <UTabs v-model="tab" :items="[{ label: t('leave.requests'), value: 'requests' }, ...(auth.can('leave.manage') ? [{ label: t('leave.types'), value: 'types' }] : [])]" :content="false" class="mb-4" />

    <template v-if="tab === 'requests'">
      <div class="mb-3 flex items-center justify-between">
        <UTabs v-model="statusFilter" :items="['open', 'approved', 'rejected', 'cancelled', 'all'].map(s => ({ label: t(`leave.filter.${s}`), value: s }))" :content="false" size="xs" />
        <UBadge v-if="data" color="neutral" variant="subtle">
          {{ t(`leave.flow.${data.flow}`) }}
        </UBadge>
      </div>
      <UCard :ui="{ body: 'p-0' }">
        <div v-if="status === 'pending'" class="p-4">
          <USkeleton class="h-10" />
        </div>
        <p v-else-if="!data?.requests?.length" class="p-4 text-sm text-muted">
          {{ t('common.empty') }}
        </p>
        <ul class="divide-y divide-default">
          <li v-for="r in data?.requests ?? []" :key="r.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <p class="font-medium">
                {{ f.name(one(one(r.employee)?.profile)) }}
                <span class="text-xs text-muted" dir="ltr">({{ one(r.employee)?.employee_code }})</span>
              </p>
              <p class="text-sm">
                <UBadge :color="one(r.leave_type)?.color ?? 'primary'" variant="subtle" size="sm">
                  {{ f.label(one(r.leave_type)) }}
                </UBadge>
                {{ f.date(r.start_date) }} → {{ f.date(r.end_date) }} · {{ t('leave.days', { n: Number(r.days_count) }) }}
                <template v-if="r.is_half_day">
                  ({{ t('leave.halfDay') }})
                </template>
              </p>
              <p v-if="r.reason" class="text-xs text-muted">
                {{ r.reason }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <StatusBadge :status="r.status" size="sm" />
              <UButton v-if="canDecide(r)" size="xs" icon="i-lucide-gavel" :label="t('leave.review')" @click="openReview(r)" />
              <UButton v-if="auth.can('leave.manage') && ['pending', 'manager_approved', 'approved'].includes(r.status)" size="xs" color="neutral" variant="ghost" icon="i-lucide-ban" :aria-label="t('common.cancel')" @click="cancelRequest(r)" />
            </div>
          </li>
        </ul>
      </UCard>
    </template>

    <ResourceManager v-else resource="leave-types" :fields="typeFields" :can-edit="true" :add-label="t('leaveTypes.add')"
                     :defaults="{ code: '', name_ar: '', name_en: '', is_paid: true, annual_allowance_days: 0, tracks_balance: true, allow_half_day: true, excluded_from_absence: true, excluded_from_shortage: true, color: 'primary', is_active: true }"
    />

    <UModal v-model:open="reviewOpen" :title="t('leave.review')">
      <template #body>
        <div v-if="reviewing" class="space-y-3 text-sm">
          <p><b>{{ f.name(one(one(reviewing.employee)?.profile)) }}</b> — {{ f.label(one(reviewing.leave_type)) }}</p>
          <p>{{ f.date(reviewing.start_date) }} → {{ f.date(reviewing.end_date) }} ({{ t('leave.days', { n: Number(reviewing.days_count) }) }})</p>
          <UFormField :label="t('leave.note')">
            <UTextarea v-model="note" class="w-full" :rows="2" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="error" variant="soft" :loading="busy" icon="i-lucide-x" :label="t('common.reject')" @click="decide(false)" />
          <UButton color="success" :loading="busy" icon="i-lucide-check" :label="t('common.approve')" @click="decide(true)" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="fileOpen" :title="t('leave.fileOnBehalf')">
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('fields.name')" required>
            <USelectMenu v-model="fileForm.employeeId" value-key="value" :items="(employees?.employees ?? []).map((e: any) => ({ value: e.id, label: `${f.name(one(e.profile))} (${e.employee_code})` }))" class="w-full" />
          </UFormField>
          <UFormField :label="t('leave.type')" required>
            <USelect v-model="fileForm.leaveTypeId" :items="types.filter(x => x.is_active).map(x => ({ value: x.id, label: f.label(x) }))" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="t('common.from')">
              <UInput v-model="fileForm.startDate" type="date" />
            </UFormField>
            <UFormField :label="t('common.to')">
              <UInput v-model="fileForm.endDate" type="date" :disabled="fileForm.isHalfDay" />
            </UFormField>
          </div>
          <USwitch v-model="fileForm.isHalfDay" :label="t('leave.halfDay')" @update:model-value="(v: boolean) => v && (fileForm.endDate = fileForm.startDate)" />
          <UFormField :label="t('leave.reason')">
            <UTextarea v-model="fileForm.reason" class="w-full" :rows="2" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="fileOpen = false" />
          <UButton :loading="busy" :disabled="!fileForm.employeeId || !fileForm.leaveTypeId" :label="t('common.submit')" @click="fileLeave" />
        </div>
      </template>
    </UModal>
  </AdminPage>
</template>
