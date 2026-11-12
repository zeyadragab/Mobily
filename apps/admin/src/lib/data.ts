import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type Branch = { id: string; name: string }
export type Category = { id: string; name: string }
export type Variant = {
  id: string
  product_id: string
  sku: string
  barcode: string | null
  color: string | null
  storage: string | null
  condition: 'new' | 'used' | 'refurbished'
  price: string
  reorder_level: number
  warranty_months: number
  is_active: boolean
}
export type Product = {
  id: string
  name: string
  category_id: string | null
  brand: string | null
  description: string | null
  image_url: string | null
  track_serial: boolean
  is_published: boolean
  is_active: boolean
  categories: { name: string } | null
  variants: Variant[]
}

export function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('branches').select('id,name').eq('is_active', true).order('created_at')
      if (error) throw error
      return data as Branch[]
    },
  })
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('id,name').order('sort_order')
      if (error) throw error
      return data as Category[]
    },
  })
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*, categories(name), variants(*)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Product[]
    },
  })
}

/** variant_id -> on-hand across branches (or one branch when given). */
export function useStock(branchId?: string) {
  return useQuery({
    queryKey: ['stock', branchId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('stock_levels').select('variant_id,branch_id,on_hand')
      if (branchId) q = q.eq('branch_id', branchId)
      const { data, error } = await q
      if (error) throw error
      const m = new Map<string, number>()
      for (const r of data as { variant_id: string; on_hand: number }[]) {
        m.set(r.variant_id, (m.get(r.variant_id) ?? 0) + r.on_hand)
      }
      return m
    },
  })
}

/** variant_id -> cost. Returns empty map when the role is not allowed to read costs. */
export function useCosts(enabled: boolean) {
  return useQuery({
    queryKey: ['costs'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('variant_costs').select('variant_id,cost')
      if (error) throw error
      return new Map((data as { variant_id: string; cost: string }[]).map((r) => [r.variant_id, r.cost]))
    },
  })
}

export type CashSession = {
  id: string
  opened_by: string
  opened_at: string
  opening_balance: string
  status: 'open' | 'closed'
  closed_at: string | null
  expected_cash: string | null
  counted_cash: string | null
  difference: string | null
  close_note: string | null
  shift_no?: number
}

/** The currently open cash drawer session (or null). */
export function useOpenSession(enabled = true) {
  return useQuery({
    queryKey: ['cash', 'open'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_sessions').select('*').eq('status', 'open').maybeSingle()
      if (error) throw error
      return data as CashSession | null
    },
  })
}

export const METHOD_AR = { cash: 'نقدي', card: 'فيزا', transfer: 'تحويل', wallet: 'محفظة' } as const
export type Method = keyof typeof METHOD_AR
/** Sales only: part of an invoice may stay on the customer's account. */
export const SALE_METHOD_AR = { ...METHOD_AR, credit: 'آجل' } as const
export type SaleMethod = keyof typeof SALE_METHOD_AR

export const CONDITION_AR = { new: 'جديد', used: 'مستعمل', refurbished: 'مجدد' } as const

export function variantLabel(p: { name: string }, v: Pick<Variant, 'color' | 'storage' | 'condition' | 'sku'>) {
  const parts = [v.storage, v.color, v.condition !== 'new' ? CONDITION_AR[v.condition] : null].filter(Boolean)
  return `${p.name}${parts.length ? ' — ' + parts.join(' / ') : ''} (${v.sku})`
}
