/**
 * Full attendance flow against a real Supabase stack with supabase/seed.sql loaded.
 * Uses Chromium's virtual WebAuthn authenticator (platform, user-verifying) and mocked GPS.
 * Requests come from localhost (loopback), which is never allow-listed: playwright.config.ts sets
 * NUXT_DEV_LOOPBACK_CLIENT_IP to the seed's office IP (203.0.113.10), which is.
 */
import { expect, test, type Page } from '@playwright/test'

const PASSWORD = 'Etijah@2026dev'
const INSIDE = { latitude: 32.0262, longitude: 44.3462, accuracy: 12 } // ~33 m from the office
const OUTSIDE = { latitude: 32.0300, longitude: 44.3462, accuracy: 12 } // ~455 m away

test.describe.configure({ mode: 'serial' })

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByLabel('كلمة المرور').fill(PASSWORD)
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  return cdp
}

test('employee registers a device, HR approves it, employee checks in and out with all three checks', async ({ browser }) => {
  const employee = await browser.newContext({ geolocation: INSIDE, permissions: ['geolocation'], locale: 'ar-IQ', timezoneId: 'Asia/Baghdad', serviceWorkers: 'block' })
  const page = await employee.newPage()
  await virtualAuthenticator(page)
  await login(page, 'ali@etijah.local')

  // no device yet → the action is disabled and the user is told why
  await expect(page.getByText('لا يوجد جهاز مسجّل')).toBeVisible()
  await expect(page.getByRole('button', { name: 'تسجيل الحضور' })).toBeDisabled()

  // register this device's platform authenticator
  await page.goto('/devices')
  await page.getByRole('button', { name: 'تسجيل هذا الجهاز' }).click()
  await expect(page.getByText('بانتظار موافقة الموارد البشرية').first()).toBeVisible()

  // HR approves the device
  const hr = await browser.newContext({ locale: 'ar-IQ', timezoneId: 'Asia/Baghdad', serviceWorkers: 'block' })
  const hrPage = await hr.newPage()
  await login(hrPage, 'hr@etijah.local')
  await hrPage.goto('/admin/devices')
  await hrPage.getByRole('button', { name: 'موافقة' }).first().click()
  await expect(hrPage.getByText('تمت الموافقة على الجهاز')).toBeVisible()

  // check in: location ✓ network ✓ biometric ✓
  await page.goto('/')
  await page.getByRole('button', { name: 'تسجيل الحضور' }).click()
  await expect(page.getByText('تم تسجيل الحضور').first()).toBeVisible()
  await expect(page.getByText(/في العمل منذ/)).toBeVisible()

  // check out from outside the geofence → rejected with the specific reason
  await employee.setGeolocation(OUTSIDE)
  await page.getByRole('button', { name: 'تسجيل الانصراف' }).click()
  await expect(page.getByText('أنت خارج نطاق موقع الشركة.')).toBeVisible()

  // check out from inside → accepted
  await employee.setGeolocation(INSIDE)
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(page.getByText('تم تسجيل الانصراف').first()).toBeVisible()

  // HR sees the immutable events for today
  await hrPage.goto('/admin/attendance')
  await expect(hrPage.getByText('علي جبار').first()).toBeVisible()

  await hr.close()
  await employee.close()
})

test('insufficient GPS accuracy is rejected before the biometric prompt', async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: { ...INSIDE, accuracy: 400 }, permissions: ['geolocation'], locale: 'ar-IQ', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await virtualAuthenticator(page)
  await login(page, 'ali@etijah.local')
  await page.getByRole('button', { name: 'تسجيل الحضور' }).click()
  await expect(page.getByText('دقة GPS غير كافية', { exact: false })).toBeVisible({ timeout: 40_000 })
  await ctx.close()
})

test('employees cannot reach admin pages or admin APIs', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-IQ', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await login(page, 'sara@etijah.local')
  await page.goto('/admin/employees')
  await expect(page).not.toHaveURL(/\/admin/)
  const status = await page.evaluate(async () => (await fetch('/api/admin/employees')).status)
  expect(status).toBe(403)
  await ctx.close()
})

test('department managers only see their own department', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-IQ', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await login(page, 'manager.ops@etijah.local')
  const body = await page.evaluate(async () => (await fetch('/api/admin/employees')).json())
  const codes = body.employees.map((e: any) => e.employee_code).sort()
  expect(codes).toEqual(['E003', 'E004', 'E006'])
  await ctx.close()
})
