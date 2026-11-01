<script setup lang="ts">
type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
const props = defineProps<{ label: string, value: string | number, icon: string, color?: Tone, hint?: string, to?: string }>()

// Resolve in <script setup>: Nuxt rewrites this call into a direct import at build time.
// (Called inside the template it becomes a runtime lookup, and NuxtLink is not globally registered.)
const NuxtLink = resolveComponent('NuxtLink')

// Static class names so Tailwind can see them.
const tones: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
  info: 'bg-info/10 text-info',
  neutral: 'bg-elevated text-toned',
}
</script>

<template>
  <component :is="props.to ? NuxtLink : 'div'" :to="props.to" class="block">
    <UCard :ui="{ body: 'p-4 sm:p-4' }" :class="props.to ? 'transition hover:ring-2 hover:ring-primary/40' : ''">
      <div class="flex items-center gap-3">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-xl" :class="tones[props.color ?? 'primary']">
          <UIcon :name="props.icon" class="size-6" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-sm text-muted">
            {{ props.label }}
          </p>
          <p class="text-2xl font-bold text-highlighted tabular-nums">
            {{ props.value }}
          </p>
          <p v-if="props.hint" class="truncate text-xs text-dimmed">
            {{ props.hint }}
          </p>
        </div>
      </div>
    </UCard>
  </component>
</template>
