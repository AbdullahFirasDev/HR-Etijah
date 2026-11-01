<script setup lang="ts">
import { passwordPolicy } from '#shared/schemas'
import { z } from 'zod'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const route = useRoute()
const tokenHash = computed(() => (typeof route.query.token_hash === 'string' ? route.query.token_hash : ''))
const state = reactive({ password: '' })
const done = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const errorText = useApiError()

async function submit() {
  loading.value = true
  error.value = null
  try {
    await useApi()('/api/auth/reset', { method: 'POST', body: { tokenHash: tokenHash.value, password: state.password } })
    done.value = true
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
    <h1 class="mb-3 text-xl font-bold">
      {{ t('auth.resetTitle') }}
    </h1>
    <UAlert v-if="!tokenHash" color="error" variant="subtle" :title="t('errors.invalid_or_expired_link')" />
    <UAlert v-else-if="done" color="success" variant="subtle" :title="t('auth.resetDone')" />
    <template v-else>
      <UAlert v-if="error" class="mb-4" color="error" variant="subtle" :title="error" />
      <UForm :schema="z.object({ password: passwordPolicy })" :state="state" class="space-y-4" @submit="submit">
        <UFormField :label="t('auth.newPassword')" name="password" required :help="t('auth.passwordRules')">
          <UInput v-model="state.password" type="password" autocomplete="new-password" dir="ltr" class="w-full" />
        </UFormField>
        <UButton type="submit" block :loading="loading" :label="t('common.save')" />
      </UForm>
    </template>
    <UButton to="/login" class="mt-3" block color="neutral" variant="ghost" :label="t('auth.backToLogin')" />
  </UCard>
</template>
