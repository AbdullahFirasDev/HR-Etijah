// https://nuxt.com/docs/api/configuration/nuxt-config
import { RESOURCE_CSP, SERVICE_WORKER_CSP } from './server/lib/csp'
import { appleSplashLinks } from './pwa-splash-links'

// Revision for the precached SPA shell ('/') — changes with every build.
const SHELL_REVISION = Date.now().toString(36)

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Geolocation + WebAuthn are used by this origin only.
  'Permissions-Policy':
    'geolocation=(self), publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), payment=(), usb=()',
  // Fallback for non-HTML responses. HTML documents get a hash-based policy from
  // server/plugins/csp.ts (no 'unsafe-inline' / 'unsafe-eval' for scripts).
  'Content-Security-Policy': RESOURCE_CSP,
}

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  // Opt-in separate build directory so tooling (`npm run typecheck`) never rewrites the
  // `.nuxt` directory a running `nuxi dev` is serving from.
  buildDir: process.env.NUXT_BUILD_DIR || undefined,
  // Authenticated application: no SEO requirements, and an SPA shell makes the PWA
  // app-shell/offline behaviour predictable. Nitro remains the trusted backend.
  ssr: false,

  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@vite-pwa/nuxt'],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'ar', dir: 'rtl' },
      title: 'Etijah HR',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0866b2' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'apple-mobile-web-app-title', content: 'Etijah HR' },
        { name: 'format-detection', content: 'telephone=no' },
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', href: '/icons/icon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon-180x180.png' },
        ...appleSplashLinks,
      ],
    },
  },

  runtimeConfig: {
    // development | test | production (defaults: dev server → development, build → production)
    appEnv: '',
    // --- Supabase (server only; never exposed to the browser) ---
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceRoleKey: '',
    // --- Session ---
    sessionSecret: '',
    sessionAbsoluteSeconds: 600,
    sessionIdleSeconds: 600,
    cookieSecure: true,
    // --- WebAuthn ---
    webauthnRpId: 'localhost',
    webauthnRpName: 'Etijah HR',
    webauthnOrigins: 'http://localhost:3000',
    webauthnChallengeTtlSeconds: 90,
    // --- Client IP resolution (see docs/SECURITY.md) ---
    trustProxyMode: 'none', // none | xff | header
    trustedProxyCidrs: '',
    clientIpHeader: '',
    // Local testing only (rejected in production): IP that stands in for loopback requests.
    devLoopbackClientIp: '',
    // --- Jobs / notifications ---
    cronSecret: '',
    vapidPrivateKey: '',
    vapidSubject: 'mailto:admin@example.com',
    public: {
      appName: 'Etijah HR',
      defaultTimezone: 'Asia/Baghdad',
      vapidPublicKey: '',
      sessionAbsoluteSeconds: 600,
      sessionIdleSeconds: 600,
    },
  },

  routeRules: {
    '/**': { headers: securityHeaders },
    '/api/**': { headers: { 'Cache-Control': 'no-store' } },
    '/sw.js': { headers: { 'Cache-Control': 'no-cache', 'Content-Security-Policy': SERVICE_WORKER_CSP } },
  },

  // Bundle every icon referenced in the source into the client: no runtime icon fetches,
  // so the installed PWA renders correctly offline.
  icon: {
    clientBundle: { scan: true, sizeLimitKb: 512 },
    serverBundle: 'local',
  },

  ui: {
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'],
    },
  },

  i18n: {
    defaultLocale: 'ar',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    locales: [
      { code: 'ar', language: 'ar-IQ', dir: 'rtl', name: 'العربية', file: 'ar.json' },
      { code: 'en', language: 'en-US', dir: 'ltr', name: 'English', file: 'en.json' },
    ],
  },

  pwa: {
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    registerType: 'prompt',
    injectRegister: false,
    manifest: {
      id: '/',
      name: 'Etijah HR — الحضور والانصراف',
      short_name: 'Etijah HR',
      description: 'نظام حضور وانصراف الموظفين — Employee attendance & time tracking',
      lang: 'ar',
      dir: 'rtl',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#ffffff',
      theme_color: '#0866b2',
      categories: ['business', 'productivity'],
      icons: [
        { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2,webmanifest}'],
      // iOS splash screens are large and only read at launch by iOS itself — do not precache.
      globIgnores: ['**/node_modules/**', '**/apple-splash-*'],
      // The SPA shell is rendered by the server (so it carries its CSP header) and precached
      // from there for offline start-up.
      additionalManifestEntries: [{ url: '/', revision: SHELL_REVISION }],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 3600,
    },
    devOptions: {
      enabled: false,
      type: 'module',
    },
  },

  nitro: {
    experimental: { tasks: true },
    // Rate-limit counters. In-memory per instance; mount a shared driver (e.g. redis) for multi-instance.
    storage: { ratelimit: { driver: 'memory' } },
    scheduledTasks: {
      // Missing check-out detection, absence detection and summary recalculation.
      '*/30 * * * *': ['attendance:close-days'],
    },
  },

  typescript: {
    strict: true,
  },

  vite: {
    optimizeDeps: {
      include: ['leaflet', 'echarts/core', 'vue-echarts', '@simplewebauthn/browser', 'zod'],
    },
  },
})
