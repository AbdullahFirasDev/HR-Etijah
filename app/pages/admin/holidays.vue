<script setup lang="ts">
import type { FieldDef } from '~/components/ResourceManager.vue'

definePageMeta({ layout: 'admin', permission: 'holidays.manage' })
const { t } = useI18n()
const f = useFormat()

const fields = computed<FieldDef[]>(() => [
  { key: 'name_ar', label: t('fields.nameAr'), type: 'text', required: true },
  { key: 'name_en', label: t('fields.nameEn'), type: 'text', required: true, dir: 'ltr', column: false },
  { key: 'holiday_type', label: t('holidays.type'), type: 'select', items: [{ value: 'official', label: t('holidays.official') }, { value: 'company', label: t('holidays.company') }] },
  { key: 'start_date', label: t('common.from'), type: 'date', required: true, format: (v: string) => f.date(v, { day: 'numeric', month: 'short', year: 'numeric' }) },
  { key: 'end_date', label: t('common.to'), type: 'date', required: true, format: (v: string) => f.date(v, { day: 'numeric', month: 'short', year: 'numeric' }) },
  { key: 'is_recurring', label: t('holidays.recurring'), type: 'switch', help: t('holidays.recurringHint') },
])
</script>

<template>
  <AdminPage :title="t('admin.nav.holidays')">
    <p class="mb-4 text-sm text-muted">
      {{ t('holidays.hint') }}
    </p>
    <ResourceManager
      resource="holidays"
      :fields="fields"
      :defaults="{ name_ar: '', name_en: '', holiday_type: 'official', start_date: f.todayIso(), end_date: f.todayIso(), is_recurring: false }"
      :can-edit="true"
      :add-label="t('holidays.add')"
    />
  </AdminPage>
</template>
