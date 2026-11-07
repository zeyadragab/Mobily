// Money is stored as numeric(14,2) in the DB. In the app we never use floats:
// amounts are integer minor units (piasters) and strings at the boundary.

const RE = /^-?\d+(\.\d{1,2})?$/

/** "125.5" or 125.5 -> 12550. Throws on invalid input. The API returns numeric columns as JSON numbers. */
export function toMinor(value: string | number): number {
  const v = String(value).trim()
  if (!RE.test(v)) throw new Error(`Invalid money value: ${value}`)
  const neg = v.startsWith('-')
  const [whole, frac = ''] = v.replace('-', '').split('.')
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor)) throw new Error('Amount too large')
  return neg ? -minor : minor
}

/** 12550 -> "125.50" (DB-ready string). */
export function fromMinor(minor: number): string {
  const neg = minor < 0
  const abs = Math.abs(minor)
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return neg ? `-${s}` : s
}

export function formatEGP(minor: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(minor / 100)
}
