/** Arabic by default; the user's choice persists in a cookie and in their profile. */
export default defineNuxtPlugin(async (nuxtApp) => {
  const saved = useCookie<'ar' | 'en' | null>('hr_locale', { sameSite: 'strict', maxAge: 60 * 60 * 24 * 365 })
  if (saved.value === 'en' || saved.value === 'ar') {
    await nuxtApp.$i18n.setLocale(saved.value)
  }
})
