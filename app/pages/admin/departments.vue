<script setup lang="ts">
import type { FieldDef } from '~/components/ResourceManager.vue'

definePageMeta({ layout: 'admin', permission: 'employees.read' })
const { t } = useI18n()
const f = useFormat()
const auth = useAuth()

const fields = computed<FieldDef[]>(() => [
  { key: 'code', label: t('fields.code'), type: 'text', required: true, dir: 'ltr' },
  { key: 'name_ar', label: t('fields.nameAr'), type: 'text', required: true },
  { key: 'name_en', label: t('fields.nameEn'), type: 'text', required: true, dir: 'ltr' },
  { key: 'is_active', label: t('fields.active'), type: 'switch' },
  { key: 'managers', label: t('departments.managers'), type: 'text', form: false, format: (v: any[]) => (v ?? []).map(m => f.name(one(m.profile))).join('، ') || '—' },
])
</script>

<template>
  <AdminPage :title="t('admin.nav.departments')">
    <p class="mb-4 text-sm text-muted">
      {{ t('departments.hint') }}
    </p>
    <ResourceManager
      resource="departments"
      :fields="fields"
      :defaults="{ code: '', name_ar: '', name_en: '', is_active: true }"
      :can-edit="auth.can('departments.manage')"
      :add-label="t('departments.add')"
    />
  </AdminPage>
</template>
