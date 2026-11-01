export function useLocaleSwitch() {
  const { locale, setLocale } = useI18n()
  const saved = useCookie<'ar' | 'en' | null>('hr_locale', { sameSite: 'strict', maxAge: 60 * 60 * 24 * 365 })
  const auth = useAuth()

  async function set(code: 'ar' | 'en', persist = true) {
    await setLocale(code)
    saved.value = code
    if (persist && auth.user.value) {
      useApi()('/api/me/locale', { method: 'POST', body: { locale: code } }).catch(() => {})
    }
  }
  const toggle = () => set(locale.value === 'ar' ? 'en' : 'ar')
  return { locale, set, toggle }
}
