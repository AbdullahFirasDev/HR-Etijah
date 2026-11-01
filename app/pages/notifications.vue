<script setup lang="ts">
const auth = useAuth()
definePageMeta({ layout: false })
// Resolved here (not in the template) so Nuxt turns it into a direct import.
const AdminPage = resolveComponent('AdminPage')
const { t, locale } = useI18n()
const f = useFormat()
const api = useApi()
const unread = useState('notifications.unread', () => 0)
const { data, refresh } = await useAsyncData('notifications', () => api<any>('/api/notifications'), { server: false })

async function markAll() {
  await api('/api/notifications/read', { method: 'POST', body: {} })
  unread.value = 0
  await refresh()
}
async function openItem(n: any) {
  if (!n.read_at) {
    await api('/api/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {})
    unread.value = Math.max(0, unread.value - 1)
  }
  const url = typeof n.data?.url === 'string' && n.data.url.startsWith('/') ? n.data.url : null
  if (url) await navigateTo(url)
  else await refresh()
}
</script>

<template>
  <NuxtLayout :name="auth.user.value?.employee ? 'default' : 'admin'">
    <component :is="auth.user.value?.employee ? 'div' : AdminPage" :title="t('nav.notifications')" class="space-y-4">
      <div class="flex items-center justify-between" :class="auth.user.value?.employee ? '' : 'mb-4'">
        <h1 v-if="auth.user.value?.employee" class="text-xl font-bold">
          {{ t('nav.notifications') }}
        </h1>
        <UButton v-if="data?.unread" size="sm" color="neutral" variant="outline" icon="i-lucide-check-check" :label="t('notifications.markAll')" @click="markAll" />
      </div>
      <UCard :ui="{ body: 'p-0' }">
        <p v-if="!data?.items?.length" class="p-6 text-center text-sm text-muted">
          {{ t('notifications.empty') }}
        </p>
        <ul class="divide-y divide-default">
          <li v-for="n in data?.items ?? []" :key="n.id">
            <button type="button" class="flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-elevated/50" @click="openItem(n)">
              <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="n.read_at ? 'bg-transparent' : 'bg-primary'" />
              <span class="min-w-0 flex-1">
                <span class="block font-medium">{{ locale === 'en' ? n.title_en : n.title_ar }}</span>
                <span v-if="n.body_ar || n.body_en" class="block text-sm text-muted">{{ locale === 'en' ? n.body_en : n.body_ar }}</span>
                <span class="block text-xs text-dimmed">{{ f.dateTime(n.created_at) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </UCard>
    </component>
  </NuxtLayout>
</template>
