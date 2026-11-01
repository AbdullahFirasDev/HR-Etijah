/**
 * Calendar/timezone helpers. All instants are JS Dates (UTC internally); calendar dates are
 * ISO strings (YYYY-MM-DD) interpreted in the organisation timezone (default Asia/Baghdad).
 */
import { TZDate } from '@date-fns/tz'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

function parseDate(date: string): [number, number, number] {
  const m = DATE_RE.exec(date)
  if (!m) {
    throw new RangeError(`Invalid date: ${date}`)
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function parseTime(time: string): [number, number, number] {
  const m = TIME_RE.exec(time)
  if (!m) {
    throw new RangeError(`Invalid time: ${time}`)
  }
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
}

/** The UTC instant of a wall-clock date + time in `tz`. */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, mo, d] = parseDate(date)
  const [h, mi, s] = parseTime(time)
  return new Date(new TZDate(y, mo - 1, d, h, mi, s, tz).getTime())
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

/** Calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(instant: Date, tz: string): string {
  let fmt = dateFormatters.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    dateFormatters.set(tz, fmt)
  }
  return fmt.format(instant)
}

/** ISO weekday of a calendar date: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: string): number {
  const [y, m, d] = parseDate(date)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return wd === 0 ? 7 : wd
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Inclusive list of calendar dates. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d)
    if (out.length > 3700) {
      throw new RangeError('Date range too large')
    }
  }
  return out
}

/** Start (inclusive) of the week containing `date`, with weeks starting on ISO weekday `weekStart`. */
export function startOfWeek(date: string, weekStart: number): string {
  const diff = (isoWeekday(date) - weekStart + 7) % 7
  return addDays(date, -diff)
}

export function monthRange(year: number, month: number): { from: string, to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from, to: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
}

export function diffMinutes(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b
}
