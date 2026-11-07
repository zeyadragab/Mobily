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
