<script setup lang="ts">
/**
 * Leaflet + OpenStreetMap. Read-only display of geofences (and optionally the user's fix),
 * or an editor when `editable` — click/drag to move the centre, radius from props.
 */
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Fence { id?: string, name?: string, latitude: number, longitude: number, radius_m: number }
const props = withDefaults(defineProps<{
  fences: Fence[]
  position?: { latitude: number, longitude: number, accuracy: number } | null
  editable?: boolean
  height?: string
}>(), { position: null, editable: false, height: '16rem' })
const emit = defineEmits<{ move: [lat: number, lng: number] }>()

const el = ref<HTMLDivElement>()
let map: L.Map | null = null
let layer: L.LayerGroup | null = null

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:9999px;background:#0866b2;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function draw() {
  if (!map || !layer) return
  layer.clearLayers()
  const bounds: L.LatLngExpression[] = []
  for (const f of props.fences) {
    const c = L.circle([f.latitude, f.longitude], { radius: f.radius_m, color: '#0866b2', weight: 2, fillOpacity: 0.12 }).addTo(layer)
    if (f.name) c.bindTooltip(f.name)
    const m = L.marker([f.latitude, f.longitude], { icon: pinIcon, draggable: props.editable, keyboard: props.editable }).addTo(layer)
    if (props.editable) {
      m.on('dragend', () => {
        const p = m.getLatLng()
        emit('move', Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7)))
      })
    }
    bounds.push([f.latitude, f.longitude])
  }
  if (props.position) {
    L.circle([props.position.latitude, props.position.longitude], { radius: props.position.accuracy, color: '#16a34a', weight: 1, fillOpacity: 0.15 }).addTo(layer)
    L.circleMarker([props.position.latitude, props.position.longitude], { radius: 6, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).addTo(layer)
    bounds.push([props.position.latitude, props.position.longitude])
  }
  if (bounds.length === 1) map.setView(bounds[0]!, props.editable ? map.getZoom() || 17 : 17)
  else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 18 })
}

onMounted(async () => {
  // A `.client.vue` component renders its real template only after mounting: wait one tick so
  // the container element exists before Leaflet looks for it ("Map container not found").
  await nextTick()
  if (!el.value || map) {
    return
  }
  map = L.map(el.value, { zoomControl: true, attributionControl: true }).setView([32.0259, 44.3462], 16)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map)
  layer = L.layerGroup().addTo(map)
  if (props.editable) {
    map.on('click', (e: L.LeafletMouseEvent) => emit('move', Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7))))
  }
  draw()
})
watch(() => [props.fences, props.position], draw, { deep: true })
onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="el" class="w-full overflow-hidden rounded-lg border border-default" :style="{ height }" role="region" aria-label="Map" />
</template>
