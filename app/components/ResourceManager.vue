<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, resolveComponent } from 'vue'

export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'time' | 'date' | 'weekdays' | 'color'
  items?: Array<{ label: string, value: any }>
  required?: boolean
  help?: string
  column?: boolean
  /** false = display-only column, not part of the form */
  form?: boolean
  dir?: 'ltr' | 'rtl'
  format?: (value: any, row: any) => string
  min?: number
  max?: number
}

const props = defineProps<{
  resource: string
  fields: FieldDef[]
  defaults: Record<string, any>
  canEdit: boolean
  addLabel: string
  transform?: (row: any) => any
}>()
const emit = defineEmits<{ changed: [] }>()

/** Select items cannot use null values; this sentinel stands for NULL. */
const NONE = '__none__'
const { t } = useI18n()
const api = useApi()
const toast = useToast()
const errorText = useApiError()
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

const { data: rows, refresh, status } = await useAsyncData(`resource-${props.resource}`, () => api<any[]>(`/api/admin/resources/${props.resource}`), { server: false, default: () => [] })
defineExpose({ refresh, rows })

const formFields = computed(() => props.fields.filter(f => f.form !== false))
const weekdayLabels = computed(() => [1, 2, 3, 4, 5, 6, 7].map(d => ({ value: d, label: t(`weekdays.${d}`) })))

function display(f: FieldDef, row: any): string {
  const v = row[f.key]
  if (f.format) return f.format(v, row)
  if (f.type === 'switch') return v ? t('common.yes') : t('common.no')
  if (f.type === 'select') return f.items?.find(i => i.value === (v ?? NONE))?.label ?? (v ?? '—')
  if (f.type === 'weekdays') return (v ?? []).map((d: number) => t(`weekdaysShort.${d}`)).join(' ')
  if (f.type === 'time' && typeof v === 'string') return v.slice(0, 5)
  return v ?? '—'
}

const columns = computed<TableColumn<any>[]>(() => [
  ...props.fields.filter(f => f.column !== false).map(f => ({
    accessorKey: f.key,
    header: f.label,
    cell: ({ row }: any) => (f.type === 'switch'
      ? h(UBadge, { color: row.original[f.key] ? 'success' : 'neutral', variant: 'subtle' }, () => display(f, row.original))
      : h('span', { dir: f.dir }, display(f, row.original))),
  })),
  ...(props.canEdit
    ? [{
        id: 'actions',
        header: '',
        cell: ({ row }: any) => h('div', { class: 'flex justify-end gap-1' }, [
          h(UButton, { size: 'xs', color: 'neutral', variant: 'ghost', icon: 'i-lucide-pencil', 'aria-label': t('common.edit'), onClick: () => edit(row.original) }),
          h(UButton, { size: 'xs', color: 'error', variant: 'ghost', icon: 'i-lucide-trash-2', 'aria-label': t('common.delete'), onClick: () => remove(row.original) }),
        ]),
      }]
    : []),
])

const open = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const form = ref<Record<string, any>>({})

function create() {
  editingId.value = null
  form.value = structuredClone(toRaw(props.defaults))
  open.value = true
}
function edit(row: any) {
  editingId.value = row.id
  const v: Record<string, any> = {}
  for (const f of formFields.value) {
    v[f.key] = f.type === 'time' && typeof row[f.key] === 'string' ? row[f.key].slice(0, 5) : (f.type === 'select' && row[f.key] == null ? NONE : row[f.key])
  }
  form.value = { ...structuredClone(toRaw(props.defaults)), ...v }
  open.value = true
}
async function save() {
  saving.value = true
  try {
    const body = props.transform ? props.transform({ ...form.value }) : { ...form.value }
    for (const f of formFields.value) {
      if (f.type === 'number' && body[f.key] !== '' && body[f.key] != null) body[f.key] = Number(body[f.key])
      if (body[f.key] === NONE) body[f.key] = null
      if ((body[f.key] === '' || body[f.key] === undefined) && !f.required) body[f.key] = null
    }
    if (editingId.value) await api(`/api/admin/resources/${props.resource}/${editingId.value}`, { method: 'PUT', body })
    else await api(`/api/admin/resources/${props.resource}`, { method: 'POST', body })
    toast.add({ title: t('common.saved'), color: 'success' })
    open.value = false
    await refresh()
    emit('changed')
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
async function remove(row: any) {
  if (!confirm(t('common.confirmDelete'))) return
  try {
    await api(`/api/admin/resources/${props.resource}/${row.id}`, { method: 'DELETE' })
    toast.add({ title: t('common.deleted'), color: 'success' })
    await refresh()
    emit('changed')
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
function toggleDay(d: number, key: string) {
  const set = new Set<number>(form.value[key] ?? [])
  set.has(d) ? set.delete(d) : set.add(d)
  form.value[key] = [...set].sort()
}
</script>

<template>
  <div>
    <div v-if="canEdit" class="mb-3 flex justify-end">
      <UButton icon="i-lucide-plus" :label="addLabel" @click="create" />
    </div>
    <UTable :data="rows" :columns="columns" :loading="status === 'pending'" :empty="t('common.empty')" class="rounded-lg border border-default" />

    <UModal v-model:open="open" :title="editingId ? t('common.edit') : addLabel" :ui="{ content: 'sm:max-w-xl' }">
      <template #body>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField v-for="f in formFields" :key="f.key" :label="f.label" :required="f.required" :help="f.help" :class="['textarea', 'weekdays'].includes(f.type) ? 'sm:col-span-2' : ''">
            <USwitch v-if="f.type === 'switch'" v-model="form[f.key]" />
            <USelect v-else-if="f.type === 'select'" v-model="form[f.key]" :items="f.items ?? []" class="w-full" />
            <UTextarea v-else-if="f.type === 'textarea'" v-model="form[f.key]" class="w-full" />
            <div v-else-if="f.type === 'weekdays'" class="flex flex-wrap gap-1">
              <UButton v-for="d in weekdayLabels" :key="d.value" size="xs" :variant="(form[f.key] ?? []).includes(d.value) ? 'solid' : 'outline'" :label="d.label" @click="toggleDay(d.value, f.key)" />
            </div>
            <USelect v-else-if="f.type === 'color'" v-model="form[f.key]" :items="['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']" class="w-full" />
            <UInput v-else v-model="form[f.key]" :type="f.type" :dir="f.dir" :min="f.min" :max="f.max" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="open = false" />
          <UButton :loading="saving" :label="t('common.save')" @click="save" />
        </div>
      </template>
    </UModal>
  </div>
</template>
