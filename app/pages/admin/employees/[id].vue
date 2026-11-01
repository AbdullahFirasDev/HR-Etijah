<script setup lang="ts">
import { ROLE_KEYS } from '#shared/constants'

definePageMeta({ layout: 'admin', permission: 'employees.read' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()
const toast = useToast()
const errorText = useApiError()
const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, refresh } = await useAsyncData(`employee-${id.value}`, () => api<any>(`/api/admin/employees/${id.value}`), { server: false })
const { data: departments } = await useAsyncData('departments-list', () => api<any[]>('/api/admin/resources/departments'), { server: false, default: () => [] })
const { data: offices } = await useAsyncData('offices-list', () => api<any[]>('/api/admin/resources/offices'), { server: false, default: () => [] })
const { data: shifts } = await useAsyncData('shifts-list', () => api<any[]>('/api/admin/resources/shifts'), { server: false, default: () => [] })

const canManage = computed(() => auth.can('employees.manage'))
const NONE = '__none__'
const form = ref<any>({})
watch(data, (d) => {
  if (!d) return
  form.value = {
    fullName: d.profile.full_name,
    fullNameEn: d.profile.full_name_en ?? '',
    phone: d.profile.phone ?? '',
    isActive: d.profile.is_active,
    role: one(d.profile.role)?.key,
    employeeCode: d.employee?.employee_code,
    departmentId: d.employee?.department_id ?? NONE,
    officeId: d.employee?.office_id ?? NONE,
    jobTitle: d.employee?.job_title ?? '',
    hireDate: d.employee?.hire_date ?? '',
    terminationDate: d.employee?.termination_date ?? '',
    status: d.employee?.status ?? 'active',
    managedDepartmentIds: d.managedDepartmentIds,
  }
}, { immediate: true })

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const v = form.value
    const body: Record<string, any> = {
      fullName: v.fullName,
      fullNameEn: v.fullNameEn || null,
      phone: v.phone || null,
      isActive: v.isActive,
      role: v.role,
      managedDepartmentIds: v.role === 'department_manager' ? v.managedDepartmentIds : [],
    }
    if (data.value?.employee) {
      Object.assign(body, {
        employeeCode: v.employeeCode,
        departmentId: v.departmentId === NONE ? null : v.departmentId,
        officeId: v.officeId === NONE ? null : v.officeId,
        jobTitle: v.jobTitle || null,
        hireDate: v.hireDate || null,
        terminationDate: v.terminationDate || null,
        status: v.status,
      })
    }
    await api(`/api/admin/employees/${id.value}`, { method: 'PATCH', body })
    toast.add({ title: t('common.saved'), color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

const pwOpen = ref(false)
const newPassword = ref('')
async function resetPassword() {
  try {
    await api(`/api/admin/employees/${id.value}/password`, { method: 'POST', body: { password: newPassword.value } })
    toast.add({ title: t('employees.passwordReset'), color: 'success' })
    pwOpen.value = false
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}

// ---- schedules
const schedOpen = ref(false)
const sched = ref<any>({})
function newSchedule() {
  sched.value = { id: null, shiftId: shifts.value[0]?.id ?? NONE, effectiveFrom: f.todayIso(), effectiveTo: '', requiredMinutes: '', graceMinutes: '', startTime: '', endTime: '', overtimeEligible: NONE, notes: '' }
  schedOpen.value = true
}
function editSchedule(s: any) {
  sched.value = { id: s.id, shiftId: s.shift_id ?? NONE, effectiveFrom: s.effective_from, effectiveTo: s.effective_to ?? '', requiredMinutes: s.required_minutes ?? '', graceMinutes: s.grace_minutes ?? '', startTime: s.start_time?.slice(0, 5) ?? '', endTime: s.end_time?.slice(0, 5) ?? '', overtimeEligible: s.overtime_eligible === null ? NONE : String(s.overtime_eligible), notes: s.notes ?? '' }
  schedOpen.value = true
}
async function saveSchedule() {
  const s = sched.value
  const body = {
    employeeId: data.value.employee.id,
    shiftId: s.shiftId === NONE ? null : s.shiftId,
    effectiveFrom: s.effectiveFrom,
    effectiveTo: s.effectiveTo || null,
    requiredMinutes: s.requiredMinutes === '' ? null : Number(s.requiredMinutes),
    graceMinutes: s.graceMinutes === '' ? null : Number(s.graceMinutes),
    startTime: s.startTime || null,
    endTime: s.endTime || null,
    overtimeEligible: s.overtimeEligible === NONE ? null : s.overtimeEligible === 'true',
    notes: s.notes || null,
  }
  try {
    if (s.id) await api(`/api/admin/schedules/${s.id}`, { method: 'PUT', body })
    else await api('/api/admin/schedules', { method: 'POST', body })
    toast.add({ title: t('common.saved'), color: 'success' })
    schedOpen.value = false
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
async function deleteSchedule(sid: string) {
  if (!confirm(t('common.confirmDelete'))) return
  try {
    await api(`/api/admin/schedules/${sid}`, { method: 'DELETE' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}

// ---- balances
async function saveBalance(b: any, allocated: number) {
  try {
    await api('/api/admin/leave/balances', { method: 'PUT', body: { employeeId: data.value.employee.id, leaveTypeId: b.leave_type_id, year: new Date().getUTCFullYear(), allocatedDays: Number(allocated), carriedOverDays: Number(b.carried_over_days) } })
    toast.add({ title: t('common.saved'), color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
const roleItems = computed(() => ROLE_KEYS.filter(r => auth.user.value?.role === 'owner' || (r !== 'owner' && r !== 'hr_manager')).map(r => ({ value: r, label: t(`roles.${r}`) })))
const opt = (list: any[]) => [{ value: NONE, label: '—' }, ...list.map(x => ({ value: x.id, label: f.label(x) }))]
</script>

<template>
  <AdminPage :title="data ? f.name(data.profile) : t('admin.nav.employees')">
    <template #actions>
      <UButton to="/admin/employees" color="neutral" variant="ghost" icon="i-lucide-arrow-right" class="rtl:rotate-0 ltr:rotate-180" :aria-label="t('common.back')" />
    </template>
    <div v-if="data" class="grid gap-4 xl:grid-cols-3">
      <UCard class="xl:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-bold">
              {{ t('employees.profile') }}
            </h2>
            <span class="text-xs text-muted" dir="ltr">{{ data.profile.email }}</span>
          </div>
        </template>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('fields.nameAr')">
            <UInput v-model="form.fullName" :disabled="!canManage" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.nameEn')">
            <UInput v-model="form.fullNameEn" :disabled="!canManage" dir="ltr" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.phone')">
            <UInput v-model="form.phone" :disabled="!canManage" dir="ltr" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.role')">
            <USelect v-model="form.role" :items="roleItems" :disabled="!canManage || id === auth.user.value?.id" class="w-full" />
          </UFormField>
          <template v-if="data.employee">
            <UFormField :label="t('fields.code')">
              <UInput v-model="form.employeeCode" :disabled="!canManage" dir="ltr" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.jobTitle')">
              <UInput v-model="form.jobTitle" :disabled="!canManage" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.department')">
              <USelect v-model="form.departmentId" :items="opt(departments)" :disabled="!canManage" class="w-full" />
            </UFormField>
            <UFormField :label="t('location.office')">
              <USelect v-model="form.officeId" :items="opt(offices)" :disabled="!canManage" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.hireDate')">
              <UInput v-model="form.hireDate" type="date" :disabled="!canManage" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.terminationDate')">
              <UInput v-model="form.terminationDate" type="date" :disabled="!canManage" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.status')">
              <USelect v-model="form.status" :items="['active', 'suspended', 'terminated'].map(s => ({ value: s, label: t(`employeeStatus.${s}`) }))" :disabled="!canManage" class="w-full" />
            </UFormField>
          </template>
          <UFormField v-if="form.role === 'department_manager'" :label="t('employees.managedDepartments')" class="sm:col-span-2">
            <USelectMenu v-model="form.managedDepartmentIds" multiple value-key="value" :items="departments.map(d => ({ value: d.id, label: f.label(d) }))" :disabled="!canManage" class="w-full" />
          </UFormField>
          <USwitch v-model="form.isActive" :disabled="!canManage" :label="t('employees.accountActive')" class="sm:col-span-2" />
        </div>
        <div v-if="canManage" class="mt-4 flex flex-wrap gap-2">
          <UButton :loading="saving" icon="i-lucide-save" :label="t('common.save')" @click="save" />
          <UButton color="neutral" variant="outline" icon="i-lucide-key-round" :label="t('employees.resetPassword')" @click="pwOpen = true" />
        </div>
      </UCard>

      <div class="space-y-4">
        <UCard v-if="data.employee" :ui="{ body: 'p-0' }">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-bold">
                {{ t('employees.schedules') }}
              </h2>
              <UButton v-if="auth.can('schedules.manage')" size="xs" icon="i-lucide-plus" :label="t('common.add')" @click="newSchedule" />
            </div>
          </template>
          <p v-if="!data.schedules.length" class="p-4 text-sm text-muted">
            {{ t('employees.noSchedule') }}
          </p>
          <ul class="divide-y divide-default">
            <li v-for="s in data.schedules" :key="s.id" class="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div>
                <p class="font-medium">
                  {{ s.shift ? f.label(s.shift) : t('employees.customSchedule') }}
                  <span class="ltr-nums text-xs text-muted">{{ (s.start_time ?? s.shift?.start_time)?.slice(0, 5) }}–{{ (s.end_time ?? s.shift?.end_time)?.slice(0, 5) }}</span>
                </p>
                <p class="text-xs text-muted">
                  {{ f.date(s.effective_from, { day: 'numeric', month: 'short', year: 'numeric' }) }} → {{ s.effective_to ? f.date(s.effective_to, { day: 'numeric', month: 'short', year: 'numeric' }) : t('employees.openEnded') }}
                </p>
              </div>
              <div v-if="auth.can('schedules.manage')" class="flex">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t('common.edit')" @click="editSchedule(s)" />
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('common.delete')" @click="deleteSchedule(s.id)" />
              </div>
            </li>
          </ul>
        </UCard>

        <UCard v-if="data.employee" :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="font-bold">
              {{ t('employees.balances') }}
            </h2>
          </template>
          <ul class="divide-y divide-default">
            <li v-for="b in data.balances.filter((x: any) => x.tracks_balance)" :key="b.leave_type_id" class="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>{{ f.label(b) }} <span class="text-xs text-muted">({{ t('leave.remaining', { n: Number(b.remaining_days) }) }})</span></span>
              <UInput v-if="auth.can('leave.manage')" :model-value="Number(b.allocated_days)" type="number" size="xs" class="w-20" @change="(e: Event) => saveBalance(b, Number((e.target as HTMLInputElement).value))" />
              <span v-else>{{ Number(b.allocated_days) }}</span>
            </li>
          </ul>
        </UCard>

        <UCard v-if="data.employee" :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="font-bold">
              {{ t('admin.nav.devices') }}
            </h2>
          </template>
          <p v-if="!data.devices.length" class="p-4 text-sm text-muted">
            {{ t('devices.none') }}
          </p>
          <ul class="divide-y divide-default">
            <li v-for="d in data.devices" :key="d.id" class="flex items-center justify-between px-4 py-2 text-sm">
              <span>{{ one(d.device)?.label }} <span class="text-xs text-muted">{{ d.authenticator_name }}</span></span>
              <StatusBadge :status="d.status" size="sm" />
            </li>
          </ul>
        </UCard>
      </div>
    </div>

    <UModal v-model:open="pwOpen" :title="t('employees.resetPassword')" :description="t('employees.resetPasswordHelp')">
      <template #body>
        <UFormField :label="t('auth.newPassword')" :help="t('auth.passwordRules')">
          <UInput v-model="newPassword" dir="ltr" class="w-full font-mono" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="pwOpen = false" />
          <UButton :disabled="newPassword.length < 10" :label="t('common.save')" @click="resetPassword" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="schedOpen" :title="t('employees.schedule')" :ui="{ content: 'sm:max-w-xl' }">
      <template #body>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('employees.shift')" class="sm:col-span-2">
            <USelect v-model="sched.shiftId" :items="[{ value: NONE, label: t('employees.customSchedule') }, ...shifts.map(s => ({ value: s.id, label: `${f.label(s)} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})` }))]" class="w-full" />
          </UFormField>
          <UFormField :label="t('employees.effectiveFrom')" required>
            <UInput v-model="sched.effectiveFrom" type="date" class="w-full" />
          </UFormField>
          <UFormField :label="t('employees.effectiveTo')">
            <UInput v-model="sched.effectiveTo" type="date" class="w-full" />
          </UFormField>
          <p class="text-xs text-muted sm:col-span-2">
            {{ t('employees.overrideHint') }}
          </p>
          <UFormField :label="t('shifts.start')">
            <UInput v-model="sched.startTime" type="time" class="w-full" />
          </UFormField>
          <UFormField :label="t('shifts.end')">
            <UInput v-model="sched.endTime" type="time" class="w-full" />
          </UFormField>
          <UFormField :label="t('shifts.requiredMinutes')">
            <UInput v-model="sched.requiredMinutes" type="number" min="0" max="1440" class="w-full" />
          </UFormField>
          <UFormField :label="t('shifts.grace')">
            <UInput v-model="sched.graceMinutes" type="number" min="0" max="240" class="w-full" />
          </UFormField>
          <UFormField :label="t('shifts.overtimeEligible')">
            <USelect v-model="sched.overtimeEligible" :items="[{ value: NONE, label: t('employees.inherit') }, { value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }]" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.notes')" class="sm:col-span-2">
            <UInput v-model="sched.notes" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="schedOpen = false" />
          <UButton :label="t('common.save')" @click="saveSchedule" />
        </div>
      </template>
    </UModal>
  </AdminPage>
</template>
