export const STORE_TZ = 'Africa/Cairo'

export function formatCairo(iso: string, withTime = true): string {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: STORE_TZ,
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(new Date(iso))
}

/** Business date (YYYY-MM-DD) in Cairo for a given instant. */
export function cairoBusinessDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TZ }).format(d)
}

/** The instant (ISO, UTC) of a Cairo wall-clock date + time. Handles Egypt's daylight saving. */
export function cairoInstant(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const asUtc = Date.UTC(y, m - 1, d, hh, mm)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(asUtc))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return new Date(asUtc - (shown - asUtc)).toISOString()
}

/** HH:MM in Cairo for an instant (empty when there is none). */
export function cairoClock(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: STORE_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** 125 -> "2:05" */
export function hoursMinutes(total: number): string {
  const t = Math.max(0, Math.round(total))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
