<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'roles.manage' })
const { t } = useI18n()
const f = useFormat()
const api = useApi()
const toast = useToast()
const errorText = useApiError()

const { data, refresh } = await useAsyncData('roles', () => api<{ roles: any[], catalog: string[] }>('/api/admin/roles'), { server: false })
const edits = ref<Record<string, Set<string>>>({})
watch(data, (d) => {
  if (!d) return
  edits.value = Object.fromEntries(d.roles.map(r => [r.key, new Set<string>(r.permissions)]))
}, { immediate: true })

const editable = (key: string) => key !== 'owner'
function toggle(role: string, perm: string) {
  const s = edits.value[role]!
  s.has(perm) ? s.delete(perm) : s.add(perm)
}
async function save(role: string) {
  try {
    await api(`/api/admin/roles/${role}`, { method: 'PUT', body: { permissions: [...edits.value[role]!] } })
    toast.add({ title: t('common.saved'), color: 'success' })
    await refresh()
  }
  catch (e) {
    toast.add({ title: errorText(e), color: 'error' })
  }
}
</script>

<template>
  <AdminPage :title="t('admin.nav.roles')">
    <p class="mb-4 text-sm text-muted">
      {{ t('rolesPage.hint') }}
    </p>
    <div v-if="data" class="overflow-x-auto rounded-lg border border-default">
      <table class="w-full text-sm">
        <thead class="bg-elevated/60">
          <tr>
            <th class="p-2 text-start">
              {{ t('rolesPage.permission') }}
            </th>
            <th v-for="r in data.roles" :key="r.key" class="p-2 text-center">
              {{ f.label(r) }}
              <p class="text-xs font-normal text-muted">
                {{ t(`rolesPage.scope.${r.scope}`) }}
              </p>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in data.catalog" :key="p" class="border-t border-default">
            <td class="p-2">
              <p class="font-medium">
                {{ t(`permissions.${p}`) }}
              </p>
              <code class="text-xs text-muted" dir="ltr">{{ p }}</code>
            </td>
            <td v-for="r in data.roles" :key="r.key" class="p-2 text-center">
              <UCheckbox
                :model-value="r.key === 'owner' || edits[r.key]?.has(p)"
                :disabled="!editable(r.key) || (p === 'roles.manage' && r.key !== 'hr_manager')"
                class="inline-flex"
                :aria-label="`${f.label(r)} — ${p}`"
                @update:model-value="toggle(r.key, p)"
              />
            </td>
          </tr>
          <tr class="border-t border-default bg-elevated/30">
            <td class="p-2" />
            <td v-for="r in data.roles" :key="r.key" class="p-2 text-center">
              <UButton v-if="editable(r.key)" size="xs" :label="t('common.save')" @click="save(r.key)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <UAlert class="mt-4" color="neutral" variant="subtle" icon="i-lucide-database" :description="t('rolesPage.rlsNote')" />
  </AdminPage>
</template>
