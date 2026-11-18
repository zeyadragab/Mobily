import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** The 18 reports (migration 0039). Each database function returns { kpis, tables }; one screen renders all of them. */
export type ReportDef = { key: string; title: string; group: string; fn: string; ranged: boolean; hint: string }

export const REPORT_GROUPS = ['المال والأرباح', 'المبيعات والمخزون', 'العملاء والموردون', 'الخدمات والموظفون'] as const

export const REPORTS: ReportDef[] = [
  { key: 'comprehensive', title: 'التقرير الشامل', group: 'المال والأرباح', fn: 'report_comprehensive', ranged: true, hint: 'صافي النتيجة: ربح المنتجات والصيانة والعمولات ناقص المصروفات.' },
  { key: 'capital', title: 'إجمالي رأس المال', group: 'المال والأرباح', fn: 'report_capital', ranged: false, hint: 'نقدية + محافظ + مخزون + ديون لنا − ديون علينا (الآن).' },
  { key: 'expenses', title: 'المصروفات', group: 'المال والأرباح', fn: 'report_expenses', ranged: true, hint: 'حسب البند مع المدفوع والمستحق.' },
  { key: 'trends', title: 'الاتجاهات الزمنية', group: 'المال والأرباح', fn: 'report_trends', ranged: true, hint: 'يومي حتى 92 يومًا، وشهري بعد كده.' },
  { key: 'sales', title: 'المبيعات', group: 'المبيعات والمخزون', fn: 'report_sales', ranged: true, hint: 'يوميًا وحسب الدفع وأكثر المنتجات والموظفين.' },
  { key: 'returns', title: 'المرتجعات', group: 'المبيعات والمخزون', fn: 'report_returns', ranged: true, hint: 'القيمة والربح الضائع.' },
  { key: 'peak', title: 'أوقات الذروة', group: 'المبيعات والمخزون', fn: 'report_peak', ranged: true, hint: 'الأسبوع يبدأ السبت. الساعات بتوقيت القاهرة.' },
  { key: 'stock', title: 'قيمة المخزون', group: 'المبيعات والمخزون', fn: 'report_stock_valuation', ranged: false, hint: 'بالتكلفة وبسعر البيع والربح المتوقع (الآن).' },
  { key: 'movement', title: 'حركة المنتجات', group: 'المبيعات والمخزون', fn: 'report_product_movement', ranged: true, hint: 'توريد ومبيعات ومرتجع وجرد لكل منتج.' },
  { key: 'debts', title: 'ديون العملاء', group: 'العملاء والموردون', fn: 'report_customer_debts', ranged: false, hint: 'حسب المصدر: منتجات وصيانة وأقساط (الآن).' },
  { key: 'suppliers', title: 'الموردون', group: 'العملاء والموردون', fn: 'report_suppliers', ranged: true, hint: 'توريدات ومدفوعات الفترة والرصيد الحالي.' },
  { key: 'installments', title: 'الأقساط والتحصيل', group: 'العملاء والموردون', fn: 'report_installments', ranged: true, hint: 'المستحق والمحصّل والمتأخر.' },
  { key: 'inout', title: 'داخل وخارج', group: 'العملاء والموردون', fn: 'report_inout', ranged: true, hint: 'الأمانات وأرصدة العملاء.' },
  { key: 'maintenance', title: 'الصيانة', group: 'الخدمات والموظفون', fn: 'report_maintenance', ranged: true, hint: 'الطلبات المسلّمة وربحها.' },
  { key: 'wallet', title: 'إرسال واستقبال', group: 'الخدمات والموظفون', fn: 'report_wallet_ops', ranged: true, hint: 'حسب النوع مع العمولات.' },
  { key: 'bills', title: 'فواتير وخدمات', group: 'الخدمات والموظفون', fn: 'report_bills', ranged: true, hint: 'حسب الخدمة مع العمولات.' },
  { key: 'tradein', title: 'المستعمل والتبديل', group: 'الخدمات والموظفون', fn: 'report_tradein', ranged: true, hint: 'الأجهزة المشتراة والمدفوع.' },
  { key: 'employees', title: 'حسابات الموظفين', group: 'الخدمات والموظفون', fn: 'report_employees', ranged: true, hint: 'استحقاق وصرف وسلف لكل موظف.' },
]

export type ReportKpi = { label: string; value: number | string; kind: 'money' | 'int' | 'pct'; tone: 'ok' | 'warn' | 'danger' | null }
export type ReportColumn = { key: string; label: string; type: 'money' | 'int' | 'date' | 'text' }
export type ReportTable = { title: string; columns: ReportColumn[]; rows: Record<string, string | number | null>[] }
export type ReportData = { kpis: ReportKpi[]; tables: ReportTable[] }

export function useReport(def: ReportDef, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['report', def.key, def.ranged ? from : '', def.ranged ? to : ''],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(def.fn, def.ranged ? { p_from: from, p_to: to } : {})
      if (error) throw error
      return data as ReportData
    },
  })
}

/** YYYY-MM-DD arithmetic that never touches the machine's time zone. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function monthStart(date: string): string { return `${date.slice(0, 7)}-01` }
export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1)
}
