import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export const CUSTOMER_CATEGORY = { regular: 'عادي', vip: 'مميز', wholesale: 'جملة', technician: 'فني صيانة' } as const
export type CustomerCategory = keyof typeof CUSTOMER_CATEGORY

export type Customer = {
  id: string
  code: string
  name: string
  phone: string
  phone2: string | null
  category: CustomerCategory
  credit_limit: number | string
  notes: string | null
  is_active: boolean
  created_at: string
  balance: number // minor units (piastres); + = the customer owes the shop
}

export const LEDGER_KIND = {
  sale_credit: 'بيع آجل',
  repair_credit: 'صيانة آجل',
  installment: 'قسط',
  used_credit: 'مستعمل آجل',
  manual_debt: 'دين مضاف يدويًا',
  payment: 'تحصيل',
  return_credit: 'مرتجع',
  reversal: 'قيد عكسي',
} as const
export type LedgerRow = {
  id: number
  customer_id: string
  amount: number | string
  kind: keyof typeof LEDGER_KIND
  method: string | null
  note: string | null
  ref_type: string | null
  reverses: number | null
  created_at: string
}

const toMinor = (v: number | string) => Math.round(Number(v) * 100)

export function useCustomers(enabled = true) {
  return useQuery({
    queryKey: ['customers'],
    enabled,
    queryFn: async () => {
      const [c, b] = await Promise.all([
        supabase.from('customers').select('id,code,name,phone,phone2,category,credit_limit,notes,is_active,created_at').order('name').limit(2000),
        supabase.from('customer_balances').select('customer_id,balance'),
      ])
      if (c.error) throw c.error
      if (b.error) throw b.error
      const bal = new Map((b.data ?? []).map((r) => [r.customer_id as string, toMinor(r.balance as number)]))
      return (c.data ?? []).map((r) => ({ ...r, balance: bal.get(r.id) ?? 0 })) as Customer[]
    },
  })
}

export function matchCustomer(c: Customer, term: string) {
  const s = term.trim().toLowerCase()
  return !s || c.name.toLowerCase().includes(s) || c.phone.includes(s) || c.code.toLowerCase().includes(s) || (c.phone2 ?? '').includes(s)
}
