/// <reference lib="WebWorker" />
/**
 * Service worker (Workbox, injectManifest).
 *
 * Caching policy:
 *  - App shell (JS/CSS/fonts/icons/HTML) is precached → the app opens offline and shows a
 *    clear offline state.
 *  - /api/** is NEVER cached and NEVER queued. There is intentionally no Background Sync:
 *    attendance must be submitted online and verified by the server in real time.
 *  - OpenStreetMap tiles: cache-first with a small expiring cache.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkOnly } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string, revision: string | null }> }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// API: network only, all methods. No cache, no retry queue.
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
  registerRoute(({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'), new NetworkOnly(), method)
}

// SPA navigations → precached shell
try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/'), { denylist: [/^\/api\//, /^\/_/] }))
}
catch {
  // shell not in precache (dev) — navigations go to the network
}

// Translations are served by @nuxtjs/i18n from /_i18n/<build-hash>/<locale>/messages.json (not
// part of the static precache). The path is content-hashed, so cache-first is safe and lets an
// installed app render its offline state in the right language.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_i18n/'),
  new CacheFirst({
    cacheName: 'i18n-messages',
    plugins: [new ExpirationPlugin({ maxEntries: 8, purgeOnQuotaError: true })],
  }),
)

registerRoute(
  ({ url }) => url.hostname === 'tile.openstreetmap.org',
  new CacheFirst({
    cacheName: 'osm-tiles',
    plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 7 * 24 * 3600, purgeOnQuotaError: true })],
  }),
)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// ---- Web Push ----------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data: { title?: string, body?: string, tag?: string, url?: string } = {}
  try {
    data = event.data?.json() ?? {}
  }
  catch {
    data = { body: event.data?.text() }
  }
  event.waitUntil(self.registration.showNotification(data.title ?? 'Etijah HR', {
    body: data.body ?? '',
    tag: data.tag,
    icon: '/icons/pwa-192x192.png',
    badge: '/icons/pwa-64x64.png',
    dir: 'auto',
    data: { url: data.url && data.url.startsWith('/') ? data.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data?.url as string) ?? '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of windows) {
      if ('focus' in w) {
        await (w as WindowClient).navigate(url).catch(() => {})
        return (w as WindowClient).focus()
      }
    }
    return self.clients.openWindow(url)
  })())
})
