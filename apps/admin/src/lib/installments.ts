import { useQuery } from '@tanstack/react-query'
import { fromMinor, toMinor } from './money'
import { supabase } from './supabase'

/** Shared by the installments, in/out and trade-in screens (migration 0033). */

/** Money text -> a number with two decimals for an RPC. Empty is 0 when allowed. */
export function money(text: string, opts: { zero?: boolean } = {}): number {
  const t = text.trim()
  if (!t && opts.zero) return 0
  let m: number
  try { m = toMinor(t) } catch { throw new Error('اكتب مبلغًا صحيحًا (أرقام فقط وبحد أقصى خانتين عشريتين).') }
  if (m < 0 || (!opts.zero && m === 0)) throw new Error('اكتب مبلغًا أكبر من صفر.')
  return Number(fromMinor(m))
}

export const PERIOD = { week: 'أسبوعي', month: 'شهري' } as const
export const PLAN_STATUS = { active: 'جارية', done: 'مكتملة', cancelled: 'ملغاة' } as const
export const PLAN_TONE = { active: 'info', done: 'ok', cancelled: 'danger' } as const
export const INST_STATUS = { due: 'مستحق', partial: 'مدفوع جزئيًا', paid: 'مدفوع', cancelled: 'ملغي' } as const
export const PAY_METHODS = { cash: 'نقدي', card: 'فيزا', transfer: 'تحويل', wallet: 'محفظة' } as const
export type PayMethod = keyof typeof PAY_METHODS

export type InstallmentRow = {
  id: string; plan_id: string; plan_no: string; plan_status: keyof typeof PLAN_STATUS
  customer_id: string; customer_name: string; customer_phone: string; description: string | null; invoice_id: string | null
  seq: number; installment_count: number; due_date: string; amount: number | string; paid: number | string
  remaining: number | string; status: keyof typeof INST_STATUS; overdue: boolean; days_late: number
}
export function useInstallmentsDue() {
  return useQuery({
    queryKey: ['installments-due'],
    queryFn: async () => {
      const { data, error } = await supabase.from('installments_due')
        .select('id,plan_id,plan_no,plan_status,customer_id,customer_name,customer_phone,description,invoice_id,seq,installment_count,due_date,amount,paid,remaining,status,overdue,days_late')
        .order('due_date').limit(2000)
      if (error) throw error
      return data as InstallmentRow[]
    },
  })
}

export type PlanRow = {
  id: string; plan_no: string; customer_id: string; invoice_id: string | null; description: string | null
  principal: number | string; interest: number | string; down_payment: number | string; installment_count: number
  period: keyof typeof PERIOD; first_due: string; status: keyof typeof PLAN_STATUS; created_at: string; cancel_reason: string | null
  customers: { name: string; phone: string } | null
}
export function usePlans() {
  return useQuery({
    queryKey: ['installment-plans'],
    queryFn: async () => {
      const { data, error } = await supabase.from('installment_plans')
        .select('id,plan_no,customer_id,invoice_id,description,principal,interest,down_payment,installment_count,period,first_due,status,created_at,cancel_reason,customers(name,phone)')
        .order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return data as unknown as PlanRow[]
    },
  })
}

export type CollectionRow = {
  id: string; receipt_no: string; plan_id: string; amount: number | string; method: PayMethod
  status: 'active' | 'cancelled'; created_at: string; cancel_reason: string | null
  installment_plans: { plan_no: string } | null; customers: { name: string } | null
}
export function useCollections() {
  return useQuery({
    queryKey: ['installment-collections'],
    queryFn: async () => {
      const { data, error } = await supabase.from('installment_collections')
        .select('id,receipt_no,plan_id,amount,method,status,created_at,cancel_reason,installment_plans(plan_no),customers(name)')
        .order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return data as unknown as CollectionRow[]
    },
  })
}

export type CreditInvoice = { id: string; invoice_number: number; customer_id: string; customer_name: string | null; credit: number | string; created_at: string }
export function useCreditInvoices(enabled: boolean) {
  return useQuery({
    queryKey: ['credit-invoices'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_log')
        .select('id,invoice_number,customer_id,customer_name,credit,created_at')
        .eq('status', 'completed').gt('credit', 0).not('customer_id', 'is', null)
        .order('created_at', { ascending: false }).limit(60)
      if (error) throw error
      return data as CreditInvoice[]
    },
  })
}

export type InOutEntry = {
  id: string; entry_no: string; customer_id: string; direction: 'in' | 'out'; amount: number | string; drawer_code: string | null
  note: string | null; status: 'active' | 'cancelled'; created_at: string; cancel_reason: string | null; customers: { name: string; phone: string } | null
}
export function useInOut() {
  return useQuery({
    queryKey: ['inout'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inout_entries')
        .select('id,entry_no,customer_id,direction,amount,drawer_code,note,status,created_at,cancel_reason,customers(name,phone)')
        .order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return data as unknown as InOutEntry[]
    },
  })
}
export type InOutBalance = { customer_id: string; customer_name: string; customer_phone: string; total_in: number | string; total_out: number | string; net: number | string; entries: number }
export function useInOutBalances() {
  return useQuery({
    queryKey: ['inout-balances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inout_balances').select('customer_id,customer_name,customer_phone,total_in,total_out,net,entries').order('customer_name')
      if (error) throw error
      return data as InOutBalance[]
    },
  })
}

export type TradeIn = {
  id: string; trade_no: string; serial: string; price: number | string; expected_price: number | string | null
  pay: 'cash' | 'account' | 'credit'; seller_name: string; seller_phone: string | null; condition_note: string | null
  status: 'active' | 'cancelled'; created_at: string; cancel_reason: string | null; variant_id: string
  variants: { sku: string; products: { name: string } | null } | null
}
export const TRADE_PAY = { cash: 'نقدي', account: 'من محفظة / ماكينة', credit: 'خصم من دين العميل' } as const
export function useTradeIns() {
  return useQuery({
    queryKey: ['trade-ins'],
    queryFn: async () => {
      const { data, error } = await supabase.from('trade_ins')
        .select('id,trade_no,serial,price,expected_price,pay,seller_name,seller_phone,condition_note,status,created_at,cancel_reason,variant_id,variants(sku,products(name))')
        .order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return data as unknown as TradeIn[]
    },
  })
}

export type TrackedVariant = { id: string; sku: string; color: string | null; storage: string | null; products: { name: string; tracking_mode: string } | null }
export function useTrackedVariants() {
  return useQuery({
    queryKey: ['tracked-variants'],
    queryFn: async () => {
      const { data, error } = await supabase.from('variants')
        .select('id,sku,color,storage,products!inner(name,tracking_mode)')
        .eq('is_active', true).eq('products.is_active', true).neq('products.tracking_mode', 'none').order('sku').limit(1000)
      if (error) throw error
      return data as unknown as TrackedVariant[]
    },
  })
}
