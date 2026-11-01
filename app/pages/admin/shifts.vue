<script setup lang="ts">
import type { FieldDef } from '~/components/ResourceManager.vue'

definePageMeta({ layout: 'admin', permission: 'schedules.manage' })
const { t } = useI18n()
const f = useFormat()

const fields = computed<FieldDef[]>(() => [
  { key: 'code', label: t('fields.code'), type: 'text', required: true, dir: 'ltr' },
  { key: 'name_ar', label: t('fields.nameAr'), type: 'text', required: true },
  { key: 'name_en', label: t('fields.nameEn'), type: 'text', required: true, dir: 'ltr', column: false },
  { key: 'start_time', label: t('shifts.start'), type: 'time', required: true, dir: 'ltr' },
  { key: 'end_time', label: t('shifts.end'), type: 'time', required: true, dir: 'ltr', help: t('shifts.overnightHint') },
  { key: 'required_minutes', label: t('shifts.requiredMinutes'), type: 'number', required: true, min: 0, max: 1440, format: (v: number) => f.duration(v) },
  { key: 'grace_minutes', label: t('shifts.grace'), type: 'number', min: 0, max: 240 },
  { key: 'early_leave_grace_minutes', label: t('shifts.earlyGrace'), type: 'number', min: 0, max: 240, column: false },
  { key: 'break_minutes', label: t('shifts.break'), type: 'number', min: 0, max: 480 },
  { key: 'paid_break_minutes', label: t('shifts.paidBreak'), type: 'number', min: 0, max: 480 },
  { key: 'working_days', label: t('shifts.workingDays'), type: 'weekdays' },
  { key: 'weekly_required_minutes', label: t('shifts.weeklyRequired'), type: 'number', min: 0, max: 10080, column: false, help: t('shifts.weeklyHint') },
  { key: 'is_flexible', label: t('shifts.flexible'), type: 'switch' },
  { key: 'flex_earliest_start', label: t('shifts.flexStart'), type: 'time', dir: 'ltr', column: false },
  { key: 'flex_latest_end', label: t('shifts.flexEnd'), type: 'time', dir: 'ltr', column: false },
  { key: 'overtime_eligible', label: t('shifts.overtimeEligible'), type: 'switch' },
  { key: 'count_before_shift', label: t('shifts.countBefore'), type: 'switch', column: false },
  { key: 'count_after_shift', label: t('shifts.countAfter'), type: 'switch', column: false },
  { key: 'is_active', label: t('fields.active'), type: 'switch' },
])
const defaults = {
  code: '', name_ar: '', name_en: '', start_time: '08:00', end_time: '16:00', required_minutes: 480, grace_minutes: 10, early_leave_grace_minutes: 0,
  break_minutes: 30, paid_break_minutes: 30, working_days: [7, 1, 2, 3, 4], weekly_required_minutes: null, is_flexible: false,
  flex_earliest_start: null, flex_latest_end: null, overtime_eligible: true, count_before_shift: false, count_after_shift: true, is_active: true,
}
</script>

<template>
  <AdminPage :title="t('admin.nav.shifts')">
    <UAlert class="mb-4" color="info" variant="subtle" icon="i-lucide-info" :title="t('shifts.formulaTitle')" :description="t('shifts.formula')" />
    <ResourceManager resource="shifts" :fields="fields" :defaults="defaults" :can-edit="true" :add-label="t('shifts.add')" />
  </AdminPage>
</template>
