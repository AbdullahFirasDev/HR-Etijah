<script setup lang="ts">
import type { FieldDef } from '~/components/ResourceManager.vue'

definePageMeta({ layout: 'admin', permission: 'settings.manage' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const toast = useToast()
const errorText = useApiError()
const geo = useGeo()

const { data: offices, refresh: refreshOffices } = await useAsyncData('offices', () => api<any[]>('/api/admin/resources/offices'), { server: false, default: () => [] })
const { data: fences, refresh } = await useAsyncData('geofences', () => api<any[]>('/api/admin/resources/geofences'), { server: false, default: () => [] })

const selectedId = ref<string | null>(null)
const form = reactive({ id: null as string | null, office_id: '', name: '', latitude: 32.0259, longitude: 44.3462, radius_m: 100, max_accuracy_m: 50, is_active: true })
watch(fences, (list) => {
  if (!selectedId.value && list?.length) select(list[0])
}, { immediate: true })

function select(g: any) {
  selectedId.value = g.id
  Object.assign(form, { id: g.id, office_id: g.office_id, name: g.name, latitude: g.latitude, longitude: g.longitude, radius_m: g.radius_m, max_accuracy_m: g.max_accuracy_m, is_active: g.is_active })
}
function newFence() {
  selectedId.value = null
  Object.assign(form, { id: null, office_id: offices.value[0]?.id ?? '', name: '', radius_m: 100, max_accuracy_m: 50, is_active: true })
}
const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const body = { office_id: form.office_id, name: form.name, latitude: Number(form.latitude), longitude: Number(form.longitude), radius_m: Number(form.radius_m), max_accuracy_m: Number(form.max_accuracy_m), is_active: form.is_active }
    const row = form.id
      ? await api<any>(`/api/admin/resources/geofences/${form.id}`, { method: 'PUT', body })
      : await api<any>('/api/admin/resources/geofences', { method: 'POST', body })
    toast.add({ title: t('common.saved'), color: 'success' })
    await refresh()
    select(row)
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
async function remove() {
  if (!form.id || !confirm(t('common.confirmDelete'))) return
  try {
    await api(`/api/admin/resources/geofences/${form.id}`, { method: 'DELETE' })
    selectedId.value = null
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
const locating = ref(false)
async function useMyLocation() {
  locating.value = true
  try {
    const fix = await geo.read(20, 15_000)
    form.latitude = Number(fix.latitude.toFixed(7))
    form.longitude = Number(fix.longitude.toFixed(7))
    toast.add({ title: t('location.located', { a: Math.round(fix.accuracy) }), color: 'info' })
  }
  catch (e: any) {
    toast.add({ title: t(`reasons.${e?.code ?? 'location_unavailable'}`), color: 'error' })
  }
  finally {
    locating.value = false
  }
}
const preview = computed(() => [{ name: form.name, latitude: Number(form.latitude), longitude: Number(form.longitude), radius_m: Number(form.radius_m) }])
const officeItems = computed(() => offices.value.map(o => ({ value: o.id, label: f.label(o) })))

const officeFields = computed<FieldDef[]>(() => [
  { key: 'name_ar', label: t('fields.nameAr'), type: 'text', required: true },
  { key: 'name_en', label: t('fields.nameEn'), type: 'text', required: true, dir: 'ltr' },
  { key: 'address', label: t('fields.address'), type: 'text' },
  { key: 'timezone', label: t('fields.timezone'), type: 'text', dir: 'ltr' },
  { key: 'is_active', label: t('fields.active'), type: 'switch' },
])
</script>

<template>
  <AdminPage :title="t('admin.nav.location')">
    <div class="grid gap-4 lg:grid-cols-3">
      <div class="space-y-4 lg:col-span-2">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-bold">
                {{ t('location.map') }}
              </h2>
              <div class="flex flex-wrap gap-1">
                <UButton v-for="g in fences" :key="g.id" size="xs" :variant="selectedId === g.id ? 'solid' : 'outline'" :label="g.name" @click="select(g)" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" :label="t('location.add')" @click="newFence" />
              </div>
            </div>
          </template>
          <ClientOnly>
            <GeofenceMap :fences="preview" editable height="26rem" @move="(lat, lng) => { form.latitude = lat; form.longitude = lng }" />
          </ClientOnly>
          <p class="mt-2 text-xs text-muted">
            {{ t('location.mapHint') }}
          </p>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <h2 class="font-bold">
            {{ form.id ? t('location.edit') : t('location.add') }}
          </h2>
        </template>
        <div class="space-y-3">
          <UFormField :label="t('location.office')" required>
            <USelect v-model="form.office_id" :items="officeItems" class="w-full" />
          </UFormField>
          <UFormField :label="t('fields.name')" required>
            <UInput v-model="form.name" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-2">
            <UFormField :label="t('location.lat')">
              <UInput v-model.number="form.latitude" type="number" step="0.0000001" dir="ltr" />
            </UFormField>
            <UFormField :label="t('location.lng')">
              <UInput v-model.number="form.longitude" type="number" step="0.0000001" dir="ltr" />
            </UFormField>
          </div>
          <UButton block color="neutral" variant="outline" icon="i-lucide-locate-fixed" :loading="locating" :label="t('location.useMine')" @click="useMyLocation" />
          <UFormField :label="t('location.radius', { m: form.radius_m })" :help="t('location.radiusHelp')">
            <USlider v-model="form.radius_m" :min="10" :max="1000" :step="5" />
          </UFormField>
          <UFormField :label="t('location.accuracy', { m: form.max_accuracy_m })" :help="t('location.accuracyHelp')">
            <USlider v-model="form.max_accuracy_m" :min="5" :max="200" :step="5" />
          </UFormField>
          <USwitch v-model="form.is_active" :label="t('fields.active')" />
          <div class="flex gap-2">
            <UButton class="flex-1" :loading="saving" :disabled="!form.office_id || !form.name" :label="t('common.save')" @click="save" />
            <UButton v-if="form.id" color="error" variant="soft" icon="i-lucide-trash-2" :aria-label="t('common.delete')" @click="remove" />
          </div>
          <UAlert color="neutral" variant="subtle" icon="i-lucide-info" :description="t('location.serverNote')" />
        </div>
      </UCard>
    </div>

    <UCard class="mt-4">
      <template #header>
        <h2 class="font-bold">
          {{ t('location.offices') }}
        </h2>
      </template>
      <ResourceManager resource="offices" :fields="officeFields" :defaults="{ name_ar: '', name_en: '', address: '', timezone: 'Asia/Baghdad', is_active: true }" :can-edit="true" :add-label="t('location.addOffice')" @changed="refreshOffices" />
    </UCard>
  </AdminPage>
</template>
