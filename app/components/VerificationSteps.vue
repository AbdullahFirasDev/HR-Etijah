<script setup lang="ts">
import type { StepState } from '~/composables/useAttendanceFlow'

interface Step { state: StepState, reasons: string[], detail: Record<string, any> }
const props = defineProps<{ steps: Record<'location' | 'network' | 'biometric', Step>, general: string[] }>()
const { t } = useI18n()

const items = computed(() => [
  { key: 'location', icon: 'i-lucide-map-pin', title: t('verify.location'), step: props.steps.location },
  { key: 'network', icon: 'i-lucide-network', title: t('verify.network'), step: props.steps.network },
  { key: 'biometric', icon: 'i-lucide-fingerprint', title: t('verify.biometric'), step: props.steps.biometric },
])

const stateIcon: Record<StepState, string> = {
  idle: 'i-lucide-circle-dashed',
  running: 'i-lucide-loader-circle',
  passed: 'i-lucide-circle-check',
  failed: 'i-lucide-circle-x',
}
const stateColor: Record<StepState, string> = {
  idle: 'text-dimmed',
  running: 'text-primary animate-spin',
  passed: 'text-success',
  failed: 'text-error',
}

/** Location failures carry the measured numbers (distance vs radius, accuracy vs limit). */
function reasonText(stepKey: string, reason: string, detail: Record<string, any>): string {
  if (stepKey !== 'location') return t(`reasons.${reason}`)
  const m = locationReasonMessage(reason, detail)
  return m.params ? t(m.key, m.params) : t(m.key)
}

function detailText(key: string, d: Record<string, any>): string | null {
  if (key === 'location') {
    const parts: string[] = []
    if (d.distance != null) parts.push(t('verify.distance', { d: Math.round(d.distance), r: d.radius }))
    if (d.accuracy != null) parts.push(t('verify.accuracy', { a: Math.round(d.accuracy), max: d.maxAccuracy ?? '—' }))
    return parts.join(' · ') || null
  }
  if (key === 'network' && d.ip) return t('verify.ip', { ip: d.ip })
  return null
}
</script>

<template>
  <ol class="space-y-2" :aria-label="t('verify.title')">
    <li
      v-for="(it, i) in items"
      :key="it.key"
      class="flex items-start gap-3 rounded-lg border p-3 transition-colors"
      :class="it.step.state === 'failed' ? 'border-error/40 bg-error/5' : it.step.state === 'passed' ? 'border-success/40 bg-success/5' : 'border-default'"
    >
      <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated">
        <UIcon :name="it.icon" class="size-5 text-toned" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <p class="font-semibold">
            <span class="text-muted">{{ i + 1 }}.</span> {{ it.title }}
          </p>
          <UIcon :name="stateIcon[it.step.state]" class="size-5 shrink-0" :class="stateColor[it.step.state]" :aria-label="t(`verify.state.${it.step.state}`)" />
        </div>
        <p v-if="detailText(it.key, it.step.detail)" class="ltr-nums mt-0.5 text-xs text-muted" style="direction: inherit">
          {{ detailText(it.key, it.step.detail) }}
        </p>
        <ul v-if="it.step.reasons.length" class="mt-1 space-y-0.5" role="alert">
          <li v-for="r in it.step.reasons" :key="r" class="text-sm font-medium text-error">
            {{ reasonText(it.key, r, it.step.detail) }}
          </li>
        </ul>
      </div>
    </li>
    <li v-if="general.length" role="alert">
      <UAlert color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="general.map(r => t(`reasons.${r}`, t('errors.generic'))).join(' · ')" />
    </li>
  </ol>
</template>
