/** Locale- and timezone-aware formatting. Timestamps are UTC; display is in the org timezone. */
export function useFormat() {
  const { locale, t } = useI18n()
  const config = useRuntimeConfig()
  const tz = useState('org.timezone', () => config.public.defaultTimezone as string)
  // Latin digits for times/durations: clearer for attendance figures in both languages.
  const tag = computed(() => (locale.value === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB'))

  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag.value, { timeZone: tz.value, ...opts })

  function time(iso: string | Date | null | undefined): string {
    if (!iso) return '—'
    return fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  }
  function dateTime(iso: string | Date | null | undefined): string {
    if (!iso) return '—'
    return fmt({ year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  }
  /** Calendar date (YYYY-MM-DD) — formatted at UTC noon to avoid any timezone shift. */
  function date(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
    if (!d) return '—'
    return new Intl.DateTimeFormat(tag.value, { timeZone: 'UTC', ...opts }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`))
  }
  function longDate(d: Date): string {
    return fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(d)
  }
  function clock(d: Date): string {
    return fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d)
  }
  function duration(minutes: number | null | undefined): string {
    const m = Math.max(0, Math.round(minutes ?? 0))
    const h = Math.floor(m / 60)
    const r = m % 60
    if (h === 0) return t('units.minutes', { n: r })
    return r === 0 ? t('units.hours', { n: h }) : t('units.hoursMinutes', { h, m: r })
  }
  function hm(minutes: number | null | undefined): string {
    const m = Math.max(0, Math.round(minutes ?? 0))
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
  }
  function todayIso(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz.value, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  }
  function name(row: { full_name?: string, full_name_en?: string | null, name?: string, nameEn?: string | null } | null | undefined): string {
    if (!row) return '—'
    if (locale.value === 'en') return row.full_name_en || row.nameEn || row.full_name || row.name || '—'
    return row.full_name || row.name || '—'
  }
  function label(row: { name_ar?: string, name_en?: string } | null | undefined): string {
    if (!row) return '—'
    return (locale.value === 'en' ? row.name_en : row.name_ar) || row.name_ar || row.name_en || '—'
  }

  return { tz, time, dateTime, date, longDate, clock, duration, hm, todayIso, name, label }
}

/** Unwrap Supabase one-to-one embeds that may arrive as an object or a 1-element array. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}
