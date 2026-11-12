import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export const ACCOUNT_KIND = { wallet: 'محفظة إلكترونية', machine: 'ماكينة دفع' } as const
export type AccountKind = keyof typeof ACCOUNT_KIND

export type MoneyAccount = {
  id: string
  kind: AccountKind
  name: string
  number: string | null
  daily_limit: number | string | null
  monthly_limit: number | string | null
  min_balance: number | string
  is_active: boolean
  balance: number | string
  used_today: number | string
  used_month: number | string
}

export function useAccounts(enabled = true) {
  return useQuery({
    queryKey: ['accounts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('account_balances')
      if (error) throw error
      return data as MoneyAccount[]
    },
  })
}

export const CONTROL_KIND: Record<string, string> = {
  opening_adjust: 'عدّ فتح الوردية',
  closing_adjust: 'عدّ إغلاق الوردية',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  adjustment: 'تصحيح رصيد',
  cash_add: 'إضافة نقدية',
  cash_withdraw: 'سحب نقدية',
  opening: 'رصيد افتتاحي',
}
export type ControlRow = {
  scope: 'drawer' | 'account'
  id: string
  target: string
  kind: string
  amount: number | string
  balance_before: number | string
  balance_after: number | string
  note: string | null
  created_at: string
}
export type ShiftAlert = {
  id: number
  session_id: string
  phase: 'open' | 'close'
  drawer_code: string
  difference: number | string
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  cash_sessions: { shift_no: number } | null
}
