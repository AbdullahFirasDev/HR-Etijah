<script setup lang="ts">
import { use } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { DatasetComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DatasetComponent, CanvasRenderer])

const props = withDefaults(defineProps<{ option: Record<string, any>, height?: string, label?: string }>(), { height: '18rem', label: 'Chart' })
const { locale } = useI18n()

// RTL: mirror the category axis so time reads right-to-left, keep fonts consistent.
const merged = computed(() => ({
  textStyle: { fontFamily: 'Cairo, system-ui, sans-serif' },
  ...props.option,
  xAxis: props.option.xAxis && !Array.isArray(props.option.xAxis)
    ? { ...props.option.xAxis, inverse: locale.value === 'ar' && props.option.xAxis.type === 'category' }
    : props.option.xAxis,
  yAxis: props.option.yAxis && !Array.isArray(props.option.yAxis)
    ? { ...props.option.yAxis, position: locale.value === 'ar' ? 'right' : 'left' }
    : props.option.yAxis,
}))
</script>

<template>
  <VChart :option="merged" autoresize :style="{ height }" role="img" :aria-label="label" />
</template>
