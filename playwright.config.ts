import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests run against the production build (`npm run build` first).
 *
 *  - smoke        : no database needed (UI, RTL/i18n, PWA files, security headers, CSRF guard)
 *  - full-flow    : needs a real Supabase stack with the dev seed loaded:
 *                     supabase start && supabase db reset
 *                     E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_ANON_KEY=… \
 *                     E2E_SUPABASE_SERVICE_ROLE_KEY=… npm run test:e2e
 *                   Uses Chromium's virtual WebAuthn authenticator and mocked geolocation.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE = `http://localhost:${PORT}`
const fullStack = !!process.env.E2E_SUPABASE_URL

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: BASE,
    locale: 'ar-IQ',
    timezoneId: 'Asia/Baghdad',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'smoke-desktop', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'smoke-mobile', testMatch: /smoke\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    ...(fullStack ? [{ name: 'full-flow', testMatch: /flows\.spec\.ts/, use: { ...devices['Pixel 7'] } }] : []),
  ],
  webServer: {
    command: 'node .output/server/index.mjs',
    url: `${BASE}/manifest.webmanifest`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      // E2E always serves plain http://localhost (and smoke runs use fake Supabase keys)
      NUXT_APP_ENV: 'test',
      NUXT_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:59999', // unreachable on purpose for smoke
      NUXT_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? 'smoke-anon-key',
      NUXT_SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? 'smoke-service-key',
      NUXT_SESSION_SECRET: 'e2e-session-secret-0123456789abcdefghijklmnop',
      NUXT_COOKIE_SECURE: 'false',
      NUXT_WEBAUTHN_RP_ID: 'localhost',
      NUXT_WEBAUTHN_ORIGINS: BASE,
      NUXT_TRUST_PROXY_MODE: 'none',
      // The browser connects over loopback; network checks treat it as the seed's office IP
      // (explicit local-testing setting, refused in production).
      NUXT_DEV_LOOPBACK_CLIENT_IP: '203.0.113.10',
    },
  },
})
