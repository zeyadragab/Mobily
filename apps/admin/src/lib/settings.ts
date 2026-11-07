import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type Settings = { max_discount_pct: number; expense_approval_threshold: number; return_approval_threshold: number; supplier_payment_threshold: number }

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('key,value')
      if (error) throw error
      const m = new Map((data as { key: string; value: string | number }[]).map((r) => [r.key, Number(r.value)]))
      return {
        max_discount_pct: m.get('max_discount_pct') ?? 5,
        expense_approval_threshold: m.get('expense_approval_threshold') ?? 5000,
        return_approval_threshold: m.get('return_approval_threshold') ?? 2000,
        supplier_payment_threshold: m.get('supplier_payment_threshold') ?? 20000,
      } as Settings
    },
  })
}
