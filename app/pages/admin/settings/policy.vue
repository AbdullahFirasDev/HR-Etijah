<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'settings.manage' })
const { t } = useI18n()
const api = useApi()
const toast = useToast()
const errorText = useApiError()

const { data } = await useAsyncData('org-settings', () => api<any>('/api/admin/settings'), { server: false })
const form = ref<Record<string, any>>({})
watch(data, (d) => {
  if (d) form.value = { ...d }
}, { immediate: true })

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const { id: _id, updated_at: _u, ...body } = form.value
    for (const k of Object.keys(body)) {
      if (typeof data.value?.[k] === 'number') body[k] = Number(body[k])
    }
    data.value = await api('/api/admin/settings', { method: 'PUT', body })
    toast.add({ title: t('policy.saved'), color: 'success' })
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
const weekdays = computed(() => [1, 2, 3, 4, 5, 6, 7].map(d => ({ value: d, label: t(`weekdays.${d}`) })))
function toggleDay(d: number) {
  const s = new Set<number>(form.value.default_working_days ?? [])
  s.has(d) ? s.delete(d) : s.add(d)
  form.value.default_working_days = [...s].sort()
}

const numberFields: Array<{ key: string, min: number, max: number, section: string }> = [
  { key: 'default_required_minutes', min: 0, max: 1440, section: 'work' },
  { key: 'max_location_age_seconds', min: 5, max: 600, section: 'verify' },
  { key: 'max_travel_speed_kmh', min: 20, max: 2000, section: 'verify' },
  { key: 'risk_review_threshold', min: 0, max: 100, section: 'verify' },
  { key: 'risk_block_threshold', min: 1, max: 100, section: 'verify' },
  { key: 'max_devices_per_employee', min: 1, max: 10, section: 'verify' },
  { key: 'auto_close_after_hours', min: 4, max: 36, section: 'calc' },
  { key: 'min_overtime_minutes', min: 0, max: 240, section: 'calc' },
  { key: 'max_daily_overtime_minutes', min: 0, max: 1440, section: 'calc' },
]
const switches: Array<{ key: string, section: string }> = [
  { key: 'require_device_approval', section: 'verify' },
  { key: 'allow_multiple_sessions', section: 'calc' },
  { key: 'absence_counts_as_shortage', section: 'calc' },
  { key: 'holiday_work_is_overtime', section: 'calc' },
  { key: 'allow_negative_leave_balance', section: 'leave' },
]
const selects = computed(() => [
  { key: 'missing_checkout_policy', section: 'calc', items: ['zero', 'scheduled_end'] },
  { key: 'late_counts_from', section: 'calc', items: ['shift_start', 'grace_end'] },
  { key: 'overtime_basis', section: 'calc', items: ['daily', 'weekly'] },
  { key: 'leave_approval_flow', section: 'leave', items: ['single', 'two_step'] },
].map(s => ({ ...s, items: s.items.map(v => ({ value: v, label: t(`policy.options.${v}`) })) })))
const sections = ['work', 'verify', 'calc', 'leave'] as const
</script>

<template>
  <AdminPage :title="t('admin.nav.policy')">
    <template #actions>
      <UButton :loading="saving" icon="i-lucide-save" :label="t('common.save')" @click="save" />
    </template>
    <div v-if="data" class="grid gap-4 xl:grid-cols-2">
      <UCard v-for="sec in sections" :key="sec">
        <template #header>
          <h2 class="font-bold">
            {{ t(`policy.sections.${sec}`) }}
          </h2>
        </template>
        <div class="grid gap-3 sm:grid-cols-2">
          <template v-if="sec === 'work'">
            <UFormField :label="t('policy.fields.org_name_ar')">
              <UInput v-model="form.org_name_ar" class="w-full" />
            </UFormField>
            <UFormField :label="t('policy.fields.org_name_en')">
              <UInput v-model="form.org_name_en" dir="ltr" class="w-full" />
            </UFormField>
            <UFormField :label="t('policy.fields.timezone')">
              <UInput v-model="form.timezone" dir="ltr" class="w-full" />
            </UFormField>
            <UFormField :label="t('policy.fields.week_start')">
              <USelect v-model="form.week_start" :items="weekdays" class="w-full" />
            </UFormField>
            <UFormField :label="t('policy.fields.default_working_days')" class="sm:col-span-2">
              <div class="flex flex-wrap gap-1">
                <UButton v-for="d in weekdays" :key="d.value" size="xs" :variant="(form.default_working_days ?? []).includes(d.value) ? 'solid' : 'outline'" :label="d.label" @click="toggleDay(d.value)" />
              </div>
            </UFormField>
          </template>
          <UFormField v-for="n in numberFields.filter(x => x.section === sec)" :key="n.key" :label="t(`policy.fields.${n.key}`)" :help="t(`policy.help.${n.key}`, '')">
            <UInput v-model.number="form[n.key]" type="number" :min="n.min" :max="n.max" class="w-full" />
          </UFormField>
          <UFormField v-for="s in selects.filter(x => x.section === sec)" :key="s.key" :label="t(`policy.fields.${s.key}`)">
            <USelect v-model="form[s.key]" :items="s.items" class="w-full" />
          </UFormField>
          <div v-for="s in switches.filter(x => x.section === sec)" :key="s.key" class="sm:col-span-2">
            <USwitch v-model="form[s.key]" :label="t(`policy.fields.${s.key}`)" :description="t(`policy.help.${s.key}`, '')" />
          </div>
        </div>
      </UCard>
    </div>
    <UAlert class="mt-4" color="info" variant="subtle" icon="i-lucide-info" :description="t('policy.recalcNote')" />
  </AdminPage>
</template>
