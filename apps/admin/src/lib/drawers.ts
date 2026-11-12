import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { CashSession } from './data'

export type DrawerCode = 'products' | 'maintenance' | 'machines' | 'installments' | 'wallets' | 'safe'
export const COUNTED: Exclude<DrawerCode, 'safe'>[] = ['products', 'maintenance', 'machines', 'installments', 'wallets']

export const DRAWER_HINT: Record<DrawerCode, string> = {
  products: 'مبيعات الملحقات والكروت والموبايلات',
  maintenance: 'رسوم الفحص والصيانة وقطع الغيار',
  machines: 'فودافون كاش وأمان والفيزا',
  installments: 'تحصيل الأقساط',
  wallets: 'نقدية المحافظ الإلكترونية',
  safe: 'تبقى بين الورديات، لا تُعدّ عند الفتح أو الإغلاق',
}

export type DrawerBalance = { id: string; code: DrawerCode; name: string; carries_over: boolean; balance: number | string }

export type CountDetail = { expected: number; counted: number | null; difference: number }
export type ShiftRow = CashSession & {
  opened_for: string | null
  opening_counts: Record<string, CountDetail> | null
  closing_counts: Record<string, CountDetail> | null
  closing_account_counts: Record<string, CountDetail & { name: string }> | null
}

export const shiftLabel = (n?: number) => `W-${String(n ?? 0).padStart(4, '0')}`

export function useDrawerBalances() {
  return useQuery({
    queryKey: ['drawers', 'balances'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('drawer_balances')
      if (error) throw error
      return data as DrawerBalance[]
    },
  })
}

/** Amount at/above which a transfer or adjustment needs a manager PIN (owner is exempt). */
export function usePinThreshold() {
  return useQuery({
    queryKey: ['drawers', 'threshold'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'drawer_transfer_pin_threshold').maybeSingle()
      if (error) throw error
      return data ? Number(data.value) : 5000
    },
  })
}

export function useShiftHistory() {
  return useQuery({
    queryKey: ['cash', 'history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_sessions').select('*').eq('status', 'closed').order('closed_at', { ascending: false }).limit(50)
      if (error) throw error
      return data as ShiftRow[]
    },
  })
}

export function newKey() {
  return crypto.randomUUID()
}
