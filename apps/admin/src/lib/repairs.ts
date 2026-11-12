import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { STORE_TZ } from './time'

export const REPAIR_STATUS = {
  received: 'تم الاستلام',
  diagnosing: 'جاري الفحص',
  awaiting_approval: 'بانتظار موافقة العميل',
  awaiting_part: 'بانتظار قطعة',
  repairing: 'جاري الإصلاح',
  testing: 'جاري الاختبار',
  ready: 'جاهز للتسليم',
  cancelled: 'اتلغى ولسه في المحل',
  unrepairable: 'تعذّر الإصلاح ولسه في المحل',
  delivered: 'تم التسليم',
}

export type RepairStatus = keyof typeof REPAIR_STATUS
export const NEXT_REPAIR_STATUS: Record<RepairStatus, RepairStatus[]> = {
  received: ['diagnosing', 'cancelled'],
  diagnosing: ['awaiting_approval', 'unrepairable', 'cancelled'],
  awaiting_approval: ['repairing', 'awaiting_part', 'diagnosing', 'cancelled'],
  awaiting_part: ['repairing', 'awaiting_approval', 'unrepairable', 'cancelled'],
  repairing: ['testing', 'awaiting_part', 'awaiting_approval', 'unrepairable', 'cancelled'],
  testing: ['ready', 'repairing', 'unrepairable', 'cancelled'],
  ready: ['delivered', 'testing'],
  cancelled: ['delivered'],
  unrepairable: ['delivered'],
  delivered: [],
}

export type RepairBranch = { id: string; name: string; can_receive: boolean; can_update: boolean }
export type RepairQuote = {
  labor_cost: number; parts_cost: number; quote_total: number; quoted_at: string | null
  customer_informed_at: string | null; customer_decision: 'approved' | 'declined' | null
}
export type RepairOrder = RepairQuote & {
  id: string; order_number: number; branch_id: string; device_model: string
  customer_name: string; customer_phone: string; status: RepairStatus; technician: string | null
  due_at: string | null; received_at: string; delivered_at: string | null
}
export type RepairDetail = RepairOrder & {
  device_id: string | null; serial: string | null; imei1: string | null; imei2: string | null
  missing_identifier_reason: string | null; complaint: string; intake_condition: string
  accessories: string | null; diagnosis: string | null; custody_location: string; revision: number
  warranty_days: number | null; warranty_until: string | null
}
export const REPAIR_LIST_COLUMNS = 'id,order_number,branch_id,device_model,customer_name,customer_phone,status,technician,due_at,received_at,delivered_at,labor_cost,parts_cost,quote_total,quoted_at,customer_informed_at,customer_decision'

export type RepairPart = { id: string; name: string; sku: string | null; unit_price: number; is_active: boolean }
export type RepairPartLevel = { part_id: string; branch_id: string; on_hand: number }
export type RepairOrderPart = { id: string; part_id: string; qty: number; unit_price: number; consumed_at: string | null; repair_parts: { name: string } | null }

export const PART_REQUEST_STATUS = {
  pending: 'بانتظار موافقة المدير', approved: 'تمت الموافقة · بانتظار وصول القطعة',
  rejected: 'مرفوض', received: 'وصلت القطعة', cancelled: 'ملغي',
}
export type PartRequestStatus = keyof typeof PART_REQUEST_STATUS
export type RepairPartRequest = {
  id: string; order_id: string; branch_id: string; part_id: string; qty: number; status: PartRequestStatus
  requested_at: string; decision_note: string | null
  repair_parts: { name: string } | null
  repair_orders: { order_number: number; device_model: string } | null
}

/** Egyptian mobile 01xxxxxxxxx -> international digits for wa.me; other numbers keep their digits. */
export function whatsappDigits(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return /^01\d{9}$/.test(digits) ? `20${digits.slice(1)}` : digits
}

/** Cashier work queue: quote is ready but the customer has not been told yet. */
export const needsCustomerContact = (order: RepairOrder) =>
  order.status === 'awaiting_approval' && !!order.quoted_at && !order.customer_informed_at
export type RepairEvent = {
  id: number; status: RepairStatus; due_at: string | null; custody_location: string
  technician: string | null; diagnosis: string | null
  note: string | null; actor_name: string; occurred_at: string
}

export const repairNumber = (number: number) => `RP-${number}`

export function cairoDateTimeInput(iso: string | null) {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STORE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}

export type RepairPayment = {
  id: string; order_id: string; kind: 'deposit' | 'payment' | 'refund'
  method: 'cash' | 'card' | 'transfer' | 'wallet'; amount: number | string; note: string | null; created_at: string
}
export const PAYMENT_KIND = { deposit: 'عربون', payment: 'دفعة', refund: 'مردود' } as const
export const PAY_METHOD = { cash: 'نقدي', card: 'فيزا', transfer: 'تحويل', wallet: 'محفظة' } as const
export type RepairTemplate = {
  id: string; name: string; default_labor: number | string; default_warranty_days: number; notes: string | null; is_active: boolean
}
export type WarrantyRow = {
  order_number: number; device_model: string; customer_name: string; delivered_at: string
  warranty_days: number | null; warranty_until: string | null; is_valid: boolean; days_left: number
}
export const WARRANTY_CHOICES = [0, 30, 90, 180, 365]

/** Volt-style board: our 10 statuses grouped into 5 columns. Delivered orders are not on the board. */
export const BOARD_COLUMNS: { key: string; label: string; tone: string; statuses: RepairStatus[] }[] = [
  { key: 'wait', label: 'قيد الانتظار', tone: 'bg-warn/10 border-warn/30', statuses: ['received', 'diagnosing', 'awaiting_approval'] },
  { key: 'work', label: 'جاري العمل', tone: 'bg-info/10 border-info/30', statuses: ['repairing', 'testing'] },
  { key: 'parts', label: 'بانتظار قطع', tone: 'bg-warn/10 border-warn/30', statuses: ['awaiting_part'] },
  { key: 'done', label: 'تم الإصلاح', tone: 'bg-ok/10 border-ok/30', statuses: ['ready'] },
  { key: 'rejected', label: 'مرفوض / تعذّر', tone: 'bg-danger/10 border-danger/30', statuses: ['cancelled', 'unrepairable'] },
]

export function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const blob = new Blob(['﻿' + [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export function useRepairTemplates() {
  return useQuery({
    queryKey: ['repair-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_templates').select('id,name,default_labor,default_warranty_days,notes,is_active').order('name')
      if (error) throw error
      return data as RepairTemplate[]
    },
  })
}
