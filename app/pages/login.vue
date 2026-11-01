<script setup lang="ts">
import { loginSchema } from '#shared/schemas'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const auth = useAuth()
const route = useRoute()
const errorText = useApiError()
const { set: setLocale } = useLocaleSwitch()

const state = reactive({ email: '', password: '' })
const loading = ref(false)
const error = ref<string | null>(null)
const expired = computed(() => route.query.reason === 'expired')

async function submit() {
  error.value = null
  loading.value = true
  try {
    const r = await auth.login(state.email, state.password)
    await setLocale(r.locale, false)
    if (r.mustChangePassword) {
      return navigateTo('/auth/change-password')
    }
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//') ? route.query.redirect : null
    return navigateTo(redirect ?? (auth.user.value?.employee ? '/' : '/admin'))
  }
  catch (e) {
    error.value = errorText(e)
  }
  finally {
    loading.value = false
  }
}
useHead({ title: () => t('auth.login') })
</script>

<template>
  <UCard>
    <h1 class="mb-1 text-xl font-bold">
      {{ t('auth.welcome') }}
    </h1>
    <p class="mb-5 text-sm text-muted">
      {{ t('auth.loginHint') }}
    </p>
    <UAlert v-if="expired" class="mb-4" color="warning" variant="subtle" icon="i-lucide-timer-off" :title="t('auth.sessionExpired')" :description="t('auth.sessionExpiredBody')" />
    <UAlert v-if="error" class="mb-4" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" role="alert" />
    <UForm :schema="loginSchema" :state="state" class="space-y-4" @submit="submit">
      <UFormField :label="t('auth.email')" name="email" required>
        <UInput v-model="state.email" type="email" autocomplete="username" inputmode="email" dir="ltr" class="w-full" size="lg" icon="i-lucide-mail" />
      </UFormField>
      <UFormField :label="t('auth.password')" name="password" required>
        <UInput v-model="state.password" type="password" autocomplete="current-password" dir="ltr" class="w-full" size="lg" icon="i-lucide-lock" />
      </UFormField>
      <UButton type="submit" block size="lg" :loading="loading" :label="t('auth.login')" />
    </UForm>
    <div class="mt-4 text-center">
      <ULink to="/auth/forgot" class="text-sm">
        {{ t('auth.forgot') }}
      </ULink>
    </div>
  </UCard>
</template>
