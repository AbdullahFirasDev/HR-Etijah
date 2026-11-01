<script setup lang="ts">
import { forgotPasswordSchema } from '#shared/schemas'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const state = reactive({ email: '' })
const sent = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const errorText = useApiError()

async function submit() {
  loading.value = true
  error.value = null
  try {
    await useApi()('/api/auth/forgot', { method: 'POST', body: state })
    sent.value = true
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
      {{ t('auth.forgot') }}
    </h1>
    <UAlert v-if="sent" color="success" variant="subtle" icon="i-lucide-mail-check" :title="t('auth.resetSent')" class="mt-3" />
    <template v-else>
      <p class="mb-4 text-sm text-muted">
        {{ t('auth.forgotHint') }}
      </p>
      <UAlert v-if="error" class="mb-4" color="error" variant="subtle" :title="error" />
      <UForm :schema="forgotPasswordSchema" :state="state" class="space-y-4" @submit="submit">
        <UFormField :label="t('auth.email')" name="email" required>
          <UInput v-model="state.email" type="email" dir="ltr" class="w-full" />
        </UFormField>
        <UButton type="submit" block :loading="loading" :label="t('auth.sendReset')" />
      </UForm>
    </template>
    <UButton to="/login" class="mt-3" block color="neutral" variant="ghost" :label="t('auth.backToLogin')" />
  </UCard>
</template>
