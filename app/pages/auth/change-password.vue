<script setup lang="ts">
import { changePasswordSchema } from '#shared/schemas'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const auth = useAuth()
const toast = useToast()
const errorText = useApiError()
const state = reactive({ currentPassword: '', newPassword: '' })
const loading = ref(false)
const error = ref<string | null>(null)

async function submit() {
  loading.value = true
  error.value = null
  try {
    await useApi()('/api/auth/change-password', { method: 'POST', body: state })
    toast.add({ title: t('auth.passwordChanged'), color: 'success', icon: 'i-lucide-check' })
    await auth.refresh()
    await navigateTo(auth.user.value?.employee ? '/' : '/admin')
  }
  catch (e) {
    error.value = errorText(e)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard>
    <h1 class="mb-1 text-xl font-bold">
      {{ t('auth.changePassword') }}
    </h1>
    <p v-if="auth.user.value?.mustChangePassword" class="mb-4 text-sm text-muted">
      {{ t('auth.mustChange') }}
    </p>
    <UAlert v-if="error" class="mb-4" color="error" variant="subtle" :title="error" role="alert" />
    <UForm :schema="changePasswordSchema" :state="state" class="space-y-4" @submit="submit">
      <UFormField :label="t('auth.currentPassword')" name="currentPassword" required>
        <UInput v-model="state.currentPassword" type="password" autocomplete="current-password" dir="ltr" class="w-full" />
      </UFormField>
      <UFormField :label="t('auth.newPassword')" name="newPassword" required :help="t('auth.passwordRules')">
        <UInput v-model="state.newPassword" type="password" autocomplete="new-password" dir="ltr" class="w-full" />
      </UFormField>
      <UButton type="submit" block :loading="loading" :label="t('common.save')" />
    </UForm>
    <UButton class="mt-3" block color="neutral" variant="ghost" :label="t('auth.logout')" @click="auth.logout()" />
  </UCard>
</template>
