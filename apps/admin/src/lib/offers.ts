import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { toMinor } from './money'

export const OFFER_KIND = { percent: 'نسبة خصم', fixed: 'مبلغ ثابت', bxgy: 'اشتري X وخذ Y', bundle: 'باقة بسعر واحد' } as const
export type OfferKind = keyof typeof OFFER_KIND

export type Offer = {
  id: string
  name: string
  kind: OfferKind
  value: string
  cap: string | null
  variant_id: string | null
  category_id: string | null
  buy_qty: number | null
  get_qty: number | null
  starts_on: string | null
  ends_on: string | null
  max_uses: number | null
  uses: number
  is_active: boolean
  offer_items: { variant_id: string; qty: number }[]
}

export function useOffers(onlyActive = false) {
  return useQuery({
    queryKey: ['offers', onlyActive],
    queryFn: async () => {
      let q = supabase.from('offers').select('*, offer_items(variant_id,qty)').order('created_at', { ascending: false })
      if (onlyActive) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as Offer[]
    },
  })
}

export function offerOpen(o: Offer, today: string) {
  return o.is_active && (!o.starts_on || o.starts_on <= today) && (!o.ends_on || o.ends_on >= today) && (o.max_uses === null || o.uses < o.max_uses)
}

export type CartLine = { variant_id: string; qty: number; unit: number; category_id: string | null }

/** Preview of the discount (in piastres) the database will give. The database is the source of truth. */
export function previewOffer(o: Offer, cart: CartLine[], subtotal: number): number {
  let d = 0
  if (o.kind === 'percent') {
    const elig = cart.filter((l) => (!o.variant_id || l.variant_id === o.variant_id) && (!o.category_id || l.category_id === o.category_id)).reduce((s, l) => s + l.qty * l.unit, 0)
    d = Math.round((elig * Number(o.value)) / 100)
    if (o.cap) d = Math.min(d, toMinor(o.cap))
  } else if (o.kind === 'fixed') {
    d = Math.min(toMinor(o.value), subtotal)
  } else if (o.kind === 'bxgy') {
    const ls = cart.filter((l) => l.variant_id === o.variant_id)
    const q = ls.reduce((s, l) => s + l.qty, 0)
    const unit = Math.max(0, ...ls.map((l) => l.unit))
    d = Math.floor(q / ((o.buy_qty ?? 1) + (o.get_qty ?? 1))) * (o.get_qty ?? 1) * unit
  } else {
    let n: number | null = null, sum = 0
    for (const it of o.offer_items) {
      const ls = cart.filter((l) => l.variant_id === it.variant_id)
      const q = ls.reduce((s, l) => s + l.qty, 0)
      n = Math.min(n ?? Math.floor(q / it.qty), Math.floor(q / it.qty))
      sum += it.qty * Math.max(0, ...ls.map((l) => l.unit))
    }
    d = Math.max(0, (n ?? 0) * (sum - toMinor(o.value)))
  }
  return Math.min(d, subtotal)
}
