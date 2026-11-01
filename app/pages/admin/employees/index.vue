<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, resolveComponent } from 'vue'
import { ROLE_KEYS } from '#shared/constants'

definePageMeta({ layout: 'admin', permission: 'employees.read' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const auth = useAuth()
const toast = useToast()
const errorText = useApiError()
const UBadge = resolveComponent('UBadge')
const NuxtLink = resolveComponent('NuxtLink')

const { data, refresh, status } = await useAsyncData('admin-employees', () => api<any>('/api/admin/employees'), { server: false })
const { data: departments } = await useAsyncData('departments-list', () => api<any[]>('/api/admin/resources/departments'), { server: false, default: () => [] })
const { data: offices } = await useAsyncData('offices-list', () => api<any[]>('/api/admin/resources/offices'), { server: false, default: () => [] })
const { data: shifts } = await useAsyncData('shifts-list', () => api<any[]>('/api/admin/resources/shifts'), { server: false, default: () => [] })

const search = ref('')
const dept = ref<string>('all')
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = (data.value?.employees ?? []).map((e: any) => ({ ...e, profile: one(e.profile), department: one(e.department) }))
  return list.filter((e: any) => (dept.value === 'all' || e.department_id === dept.value)
    && (!q || [e.employee_code, e.profile?.full_name, e.profile?.full_name_en, e.profile?.email].some(x => x?.toLowerCase().includes(q))))
})
const deptItems = computed(() => [{ value: 'all', label: t('common.all') }, ...departments.value.map(d => ({ value: d.id, label: f.label(d) }))])

const columns = computed<TableColumn<any>[]>(() => [
  { accessorKey: 'employee_code', header: t('fields.code'), cell: ({ row }) => h('span', { dir: 'ltr', class: 'font-mono' }, row.original.employee_code) },
  { id: 'name', header: t('fields.name'), cell: ({ row }) => h(NuxtLink, { to: `/admin/employees/${row.original.profile.id}`, class: 'font-medium text-primary hover:underline' }, () => f.name(row.original.profile)) },
  { id: 'department', header: t('fields.department'), cell: ({ row }) => f.label(row.original.department) },
  { id: 'role', header: t('fields.role'), cell: ({ row }) => t(`roles.${one(row.original.profile.role)?.key}`) },
  { accessorKey: 'job_title', header: t('fields.jobTitle') },
  { id: 'devices', header: t('admin.nav.devices'), cell: ({ row }) => {
    const c = (row.original.credentials ?? []) as any[]
    const active = c.filter(x => x.status === 'active').length
    const pending = c.filter(x => x.status === 'pending').length
    return h(UBadge, { color: active ? 'success' : pending ? 'warning' : 'neutral', variant: 'subtle' }, () => pending ? `${active} + ${pending} ⏳` : String(active))
  } },
  { id: 'status', header: t('fields.status'), cell: ({ row }) => h(UBadge, { color: row.original.status === 'active' && row.original.profile.is_active ? 'success' : 'neutral', variant: 'subtle' }, () => t(`employeeStatus.${row.original.profile.is_active ? row.original.status : 'inactive'}`)) },
])

// --- create
const open = ref(false)
const saving = ref(false)
const blank = () => ({ email: '', fullName: '', fullNameEn: '', phone: '', role: 'employee' as (typeof ROLE_KEYS)[number], initialPassword: '', isEmployee: true, employeeCode: '', departmentId: '__none__', officeId: offices.value[0]?.id ?? '__none__', jobTitle: '', hireDate: f.todayIso(), shiftId: shifts.value.find(s => s.code === 'DAY')?.id ?? '__none__', managedDepartmentIds: [] as string[] })
const form = ref(blank())
const roleItems = computed(() => ROLE_KEYS.filter(r => auth.user.value?.role === 'owner' || (r !== 'owner' && r !== 'hr_manager')).map(r => ({ value: r, label: t(`roles.${r}`) })))
const noneItem = computed(() => ({ value: '__none__', label: '—' }))
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  form.value.initialPassword = `${Array.from(bytes, b => chars[b % chars.length]).join('')}a7K`
}
async function create() {
  saving.value = true
  try {
    const v = form.value
    const body = {
      ...v,
      fullNameEn: v.fullNameEn || undefined,
      phone: v.phone || undefined,
      jobTitle: v.jobTitle || undefined,
      employeeCode: v.isEmployee ? v.employeeCode : undefined,
      departmentId: v.departmentId === '__none__' ? null : v.departmentId,
      officeId: v.officeId === '__none__' ? null : v.officeId,
      shiftId: v.shiftId === '__none__' ? null : v.shiftId,
      hireDate: v.hireDate || null,
    }
    await api('/api/admin/employees', { method: 'POST', body })
    toast.add({ title: t('employees.created'), description: t('employees.createdBody'), color: 'success' })
    open.value = false
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <AdminPage :title="t('admin.nav.employees')">
    <template #actions>
      <UButton v-if="auth.can('employees.manage') && auth.user.value?.scope === 'organization'" icon="i-lucide-user-plus" :label="t('employees.add')" @click="form = blank(); generatePassword(); open = true" />
    </template>
    <div class="mb-3 flex flex-wrap gap-2">
      <UInput v-model="search" icon="i-lucide-search" :placeholder="t('common.search')" class="w-64" />
      <USelect v-model="dept" :items="deptItems" class="w-56" />
    </div>
    <UTable :data="rows" :columns="columns" :loading="status === 'pending'" :empty="t('common.empty')" class="rounded-lg border border-default" />

    <template v-if="data?.users?.length">
      <h2 class="mb-2 mt-6 font-bold">
        {{ t('employees.otherAccounts') }}
      </h2>
      <ul class="divide-y divide-default rounded-lg border border-default">
        <li v-for="u in data.users" :key="u.id" class="flex items-center justify-between px-4 py-2 text-sm">
          <NuxtLink :to="`/admin/employees/${u.id}`" class="font-medium text-primary hover:underline">
            {{ f.name(u) }}
          </NuxtLink>
          <span class="text-muted">{{ t(`roles.${one(u.role)?.key}`) }} · <span dir="ltr">{{ u.email }}</span></span>
        </li>
      </ul>
    </template>

    <UModal v-model:open="open" :title="t('employees.add')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('fields.nameAr')" required>
            <UInput v-model="form.fullName" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.nameEn')">
            <UInput v-model="form.fullNameEn" dir="ltr" class="w-full" />
          </UFormField>
          <UFormField :label="t('auth.email')" required>
            <UInput v-model="form.email" type="email" dir="ltr" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.phone')">
            <UInput v-model="form.phone" type="tel" dir="ltr" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.role')" required>
            <USelect v-model="form.role" :items="roleItems" class="w-full" />
          </UFormField>
          <UFormField :label="t('employees.initialPassword')" required :help="t('employees.initialPasswordHelp')">
            <UInput v-model="form.initialPassword" dir="ltr" class="w-full font-mono">
              <template #trailing>
                <UButton size="xs" color="neutral" variant="link" icon="i-lucide-dices" :aria-label="t('employees.generate')" @click="generatePassword" />
              </template>
            </UInput>
          </UFormField>
          <USwitch v-model="form.isEmployee" :label="t('employees.tracksAttendance')" class="sm:col-span-2" />
          <template v-if="form.isEmployee">
            <UFormField :label="t('fields.code')" required>
              <UInput v-model="form.employeeCode" dir="ltr" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.jobTitle')">
              <UInput v-model="form.jobTitle" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.department')">
              <USelect v-model="form.departmentId" :items="[noneItem, ...departments.map(d => ({ value: d.id, label: f.label(d) }))]" class="w-full" />
            </UFormField>
            <UFormField :label="t('location.office')">
              <USelect v-model="form.officeId" :items="[noneItem, ...offices.map(o => ({ value: o.id, label: f.label(o) }))]" class="w-full" />
            </UFormField>
            <UFormField :label="t('employees.shift')">
              <USelect v-model="form.shiftId" :items="[noneItem, ...shifts.map(s => ({ value: s.id, label: `${f.label(s)} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})` }))]" class="w-full" />
            </UFormField>
            <UFormField :label="t('fields.hireDate')">
              <UInput v-model="form.hireDate" type="date" class="w-full" />
            </UFormField>
          </template>
          <UFormField v-if="form.role === 'department_manager'" :label="t('employees.managedDepartments')" class="sm:col-span-2">
            <USelectMenu v-model="form.managedDepartmentIds" multiple value-key="value" :items="departments.map(d => ({ value: d.id, label: f.label(d) }))" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="open = false" />
          <UButton :loading="saving" :label="t('common.create')" @click="create" />
        </div>
      </template>
    </UModal>
  </AdminPage>
</template>
