/**
 * Smoke tests — run without a database. They verify the shipped build: Arabic RTL default,
 * language switching, route protection, PWA files, security headers and the CSRF guard.
 */
import { expect, test } from '@playwright/test'

const json = { 'content-type': 'application/json' }

test.describe('UI shell', () => {
  test('login page renders in Arabic, right-to-left, by default', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.getByRole('heading', { name: 'أهلاً بك' })).toBeVisible()
    await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible()
    await expect(page.getByLabel('كلمة المرور')).toBeVisible()
    await expect(page.getByRole('button', { name: 'تسجيل الدخول' })).toBeVisible()
    await page.screenshot({ path: `test-results/e2e/login-ar-${test.info().project.name}.png`, fullPage: true })
  })

  test('switches to English, left-to-right, and remembers the choice', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Switch to English' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
  })

  test('protected routes redirect to login', async ({ page }) => {
    for (const path of ['/', '/history', '/admin', '/admin/settings/location']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    }
  })

  test('shows a clear message when the sign-in service is unreachable', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('البريد الإلكتروني').fill('ali@etijah.local')
    await page.getByLabel('كلمة المرور').fill('Etijah@2026dev')
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
    await expect(page.getByRole('alert')).toContainText('خدمة تسجيل الدخول غير متاحة')
  })

  test('shows an offline banner when connectivity is lost', async ({ page, context }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'أهلاً بك' })).toBeVisible() // app + translations loaded
    await context.setOffline(true)
    await expect(page.getByText('أنت غير متصل بالإنترنت')).toBeVisible()
    await context.setOffline(false)
    await expect(page.getByText('أنت غير متصل بالإنترنت')).toBeHidden()
  })

  test('password reset without a token explains the link is invalid', async ({ page }) => {
    await page.goto('/auth/reset')
    await expect(page.getByText('هذا الرابط غير صالح أو منتهي الصلاحية')).toBeVisible()
  })
})

test.describe('PWA', () => {
  test('serves a valid, installable, RTL web manifest with icons', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest')
    expect(res.ok()).toBe(true)
    const m = await res.json()
    expect(m).toMatchObject({ display: 'standalone', lang: 'ar', dir: 'rtl', start_url: '/' })
    for (const size of ['192x192', '512x512']) {
      expect(m.icons.some((i: any) => i.sizes === size)).toBe(true)
    }
    expect(m.icons.some((i: any) => i.purpose === 'maskable')).toBe(true)
    for (const icon of m.icons) {
      expect((await request.get(icon.src)).ok(), icon.src).toBe(true)
    }
  })

  test('service worker precaches the shell but never caches or queues the API', async ({ request }) => {
    const res = await request.get('/sw.js')
    expect(res.headers()['cache-control']).toContain('no-cache')
    const sw = await res.text()
    expect(sw).toContain('"url":"/"')
    expect(sw).toContain('/api/')
    expect(sw).not.toMatch(/BackgroundSync|backgroundSync|bgSync/)
  })

  test.describe('with the service worker active', () => {
    test.use({ serviceWorkers: 'allow' })

    test('reopens offline from the service-worker cache, in Arabic, with an offline notice', async ({ page, context }) => {
      await page.goto('/login')
      await expect(page.getByRole('heading', { name: 'أهلاً بك' })).toBeVisible()
      await page.evaluate(() => navigator.serviceWorker.ready)
      await page.reload() // now controlled by the SW; translations get cached
      await expect(page.getByRole('heading', { name: 'أهلاً بك' })).toBeVisible()
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

      await context.setOffline(true)
      await page.reload()
      await expect(page.getByText('أنت غير متصل بالإنترنت')).toBeVisible()
      await expect(page.getByText(/اتجاه HR/).first()).toBeVisible()
      await context.setOffline(false)
    })
  })

  test('advertises iOS home-screen metadata', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
    expect(await page.locator('link[rel="apple-touch-startup-image"]').count()).toBeGreaterThan(5)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0866b2')
  })
})

test.describe('HTTP security', () => {
  test('document CSP allows inline scripts only by hash, and the page triggers no CSP violation', async ({ page, request }) => {
    const violations: string[] = []
    page.on('console', (m) => {
      if (/Content Security Policy|unsafe-eval|unsafe-inline/i.test(m.text())) violations.push(m.text())
    })
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'أهلاً بك' })).toBeVisible()
    // run Zod validation in the browser (it used to probe eval and trip the CSP)
    await page.getByLabel('البريد الإلكتروني').fill('not-an-email')
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
    await page.waitForTimeout(500)
    expect(violations).toEqual([])

    const res = await request.get('/login')
    const csp = res.headers()['content-security-policy']!
    const scriptSrc = csp.split('; ').find(d => d.startsWith('script-src'))!
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/)
    const html = await res.text()
    const { createHash } = await import('node:crypto')
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/gi)) {
      expect(scriptSrc).toContain(`'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`)
    }
  })

  test('the service worker and non-HTML responses get their own restrictive CSP', async ({ request }) => {
    expect((await request.get('/sw.js')).headers()['content-security-policy']).toBe("default-src 'none'; script-src 'self'; connect-src 'self' https://tile.openstreetmap.org")
    expect((await request.get('/api/auth/session')).headers()['content-security-policy']).toContain("default-src 'none'")
    for (const path of ['/manifest.webmanifest', '/favicon.ico']) {
      expect((await request.get(path)).headers()['content-security-policy'], path).toMatch(/^default-src 'none'/)
    }
  })

  test('HTML documents carry exactly one CSP: the hash-based document policy', async ({ request }) => {
    // Route rules become edge headers on Vercel; a second (resource) policy on a page would block it.
    for (const path of ['/', '/login', '/admin']) {
      const res = await request.get(path)
      const csp = res.headersArray().filter(h => h.name.toLowerCase() === 'content-security-policy')
      expect(csp, path).toHaveLength(1)
      expect(csp[0]!.value, path).toMatch(/script-src 'self' 'sha256-/)
    }
  })

  test('an allowed origin passes the CSRF guard (reaches the auth layer)', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/login', { headers: { ...json, 'x-requested-with': 'hr-app', 'origin': baseURL! }, data: { email: 'ali@etijah.local', password: 'wrong-password' } })
    // Supabase is deliberately unreachable in smoke runs: 503 proves the request was not blocked by CSRF (403)
    expect(res.status()).toBe(503)
    expect((await res.json()).data.code).toBe('auth_unavailable')
  })

  test('sends strict security headers', async ({ request }) => {
    const h = (await request.get('/login')).headers()
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(h['content-security-policy']).toContain("connect-src 'self'")
    expect(h['permissions-policy']).toContain('geolocation=(self)')
  })

  test('API responses are never cached and report no session without a cookie', async ({ request }) => {
    const res = await request.get('/api/auth/session')
    expect(res.headers()['cache-control']).toBe('no-store')
    expect(await res.json()).toEqual({ authenticated: false, reason: null })
  })

  test('protected API endpoints require a session', async ({ request }) => {
    for (const path of ['/api/me/today', '/api/admin/dashboard', '/api/admin/employees']) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(401)
      expect((await res.json()).data.code).toBe('unauthenticated')
    }
  })

  test('CSRF guard: state-changing requests need the app header, same origin and JSON', async ({ request, baseURL }) => {
    const noHeader = await request.post('/api/auth/logout', { headers: json, data: {} })
    expect(noHeader.status()).toBe(403)
    expect((await noHeader.json()).data.code).toBe('csrf_header_missing')

    const crossOrigin = await request.post('/api/auth/logout', { headers: { ...json, 'x-requested-with': 'hr-app', 'origin': 'https://evil.example' }, data: {} })
    expect((await crossOrigin.json()).data.code).toBe('csrf_origin_mismatch')

    const form = await request.post('/api/auth/login', { headers: { 'x-requested-with': 'hr-app', 'origin': baseURL!, 'content-type': 'application/x-www-form-urlencoded' }, data: 'email=a&password=b' })
    expect(form.status()).toBe(415)
  })

  test('validates request bodies', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/login', { headers: { ...json, 'x-requested-with': 'hr-app', 'origin': baseURL! }, data: { email: 'not-an-email' } })
    expect(res.status()).toBe(422)
    expect((await res.json()).data.code).toBe('validation_failed')
  })

  test('attendance submission cannot be made without a session (no offline queue, no anonymous path)', async ({ request, baseURL }) => {
    const res = await request.post('/api/attendance/submit', { headers: { ...json, 'x-requested-with': 'hr-app', 'origin': baseURL! }, data: {} })
    expect(res.status()).toBe(401)
  })
})
