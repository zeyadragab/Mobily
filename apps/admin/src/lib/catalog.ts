import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { escapeHtml, printDocument } from './print'

export const FIELD_KIND = { short: 'نص قصير', long: 'نص طويل', number: 'رقم', yesno: 'نعم / لا', list: 'قائمة اختيارات' } as const
export type FieldKind = keyof typeof FIELD_KIND
export type CategoryField = {
  id: string
  category_id: string
  label: string
  kind: FieldKind
  required: boolean
  internal: boolean
  options: string[] | null
  sort_order: number
}

export const TRACKING_AR = { none: 'بدون تتبع', imei: 'IMEI (15 رقم)', serial: 'سيريال داخلي' } as const

export function useCategoryFields() {
  return useQuery({
    queryKey: ['category-fields'],
    queryFn: async () => {
      const { data, error } = await supabase.from('category_fields').select('*').order('sort_order').order('created_at')
      if (error) throw error
      return data as CategoryField[]
    },
  })
}

export function useUnits() {
  return useQuery({
    queryKey: ['units'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from('units').select('name').order('sort_order')
      if (error) throw error
      return (data as { name: string }[]).map((u) => u.name)
    },
  })
}

/** Small CSV reader: quotes, doubled quotes, commas and line breaks inside quotes. Strips a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

/** Column titles used by the CSV export and accepted by the import (Arabic or English). */
export const IMPORT_COLUMNS: { key: string; ar: string }[] = [
  { key: 'name', ar: 'اسم المنتج' }, { key: 'category', ar: 'القسم' }, { key: 'brand', ar: 'العلامة' },
  { key: 'sku', ar: 'SKU' }, { key: 'barcode', ar: 'الباركود' }, { key: 'color', ar: 'اللون' }, { key: 'storage', ar: 'السعة' },
  { key: 'condition', ar: 'الحالة' }, { key: 'price', ar: 'سعر البيع' }, { key: 'wholesale_price', ar: 'سعر الجملة' },
  { key: 'cost', ar: 'التكلفة' }, { key: 'reorder_level', ar: 'حد إعادة الطلب' }, { key: 'warranty_months', ar: 'الضمان (شهور)' },
]
const CONDITION_FROM_AR: Record<string, string> = { 'جديد': 'new', 'مستعمل': 'used', 'مجدد': 'refurbished' }

export function rowsFromCsv(text: string): Record<string, string>[] {
  const [head, ...body] = parseCsv(text)
  if (!head) return []
  const idx = head.map((h) => {
    const t = h.trim().toLowerCase()
    return IMPORT_COLUMNS.find((c) => c.key === t || c.ar.toLowerCase() === t)?.key ?? null
  })
  return body.map((cells) => {
    const o: Record<string, string> = {}
    idx.forEach((k, i) => { if (k) o[k] = (cells[i] ?? '').trim() })
    if (o.condition && CONDITION_FROM_AR[o.condition]) o.condition = CONDITION_FROM_AR[o.condition]
    return o
  })
}

// ---------- EAN-13 bars (for labels) ----------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function isEan13(code: string) {
  if (!/^[0-9]{13}$/.test(code)) return false
  let s = 0
  for (let i = 0; i < 12; i++) s += Number(code[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (s % 10)) % 10 === Number(code[12])
}

export function ean13Svg(code: string, height = 34) {
  const p = PARITY[Number(code[0])]
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (p[i - 1] === 'L' ? L : G)[Number(code[i])]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])]
  bits += '101'
  let rects = ''
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') rects += `<rect x="${i}" y="0" width="1" height="${height}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bits.length} ${height}" preserveAspectRatio="none" style="width:100%;height:${height * 0.6}px" shape-rendering="crispEdges">${rects}</svg>`
}

export type LabelItem = { name: string; detail: string; price: string; barcode: string; copies: number }
export const LABEL_SIZES = { '50x28': [50, 28], '58x40': [58, 40], '50x40': [50, 40], '38x25': [38, 25] } as const
export type LabelSize = keyof typeof LABEL_SIZES

/** One label per copy; the browser print dialog picks the printer and paper. */
export function printLabels(items: LabelItem[], size: LabelSize) {
  const [w, h] = LABEL_SIZES[size]
  const html = items.flatMap((it) => Array.from({ length: Math.max(1, it.copies) }, () => `
    <div class="lb" style="width:${w}mm;height:${h}mm">
      <div class="nm">${escapeHtml(it.name)}</div>
      ${it.detail ? `<div class="dt">${escapeHtml(it.detail)}</div>` : ''}
      ${isEan13(it.barcode) ? ean13Svg(it.barcode) : ''}
      <div class="bc">${escapeHtml(it.barcode)}</div>
      <div class="pr">${escapeHtml(it.price)}</div>
    </div>`)).join('')
  printDocument('ملصقات الباركود', `<style>
    @page{size:${w}mm ${h}mm;margin:0} body{margin:0}
    .lb{box-sizing:border-box;padding:1.5mm 2mm;overflow:hidden;page-break-after:always;text-align:center;font-family:Tahoma,Arial,sans-serif}
    .nm{font-size:9px;font-weight:bold;line-height:1.15;max-height:2.4em;overflow:hidden}.dt{font-size:7px;color:#444}
    .bc{font-size:8px;direction:ltr;letter-spacing:1px}.pr{font-size:12px;font-weight:bold}
  </style>${html}`)
}

export function printPriceList(rows: { name: string; detail: string; sku: string; price: string }[]) {
  const body = rows.map((r) => `<tr><td>${escapeHtml(r.name)}<div class="muted">${escapeHtml(r.detail)}</div></td><td dir="ltr">${escapeHtml(r.sku)}</td><td>${escapeHtml(r.price)}</td></tr>`).join('')
  printDocument('قائمة الأسعار', `<h1>قائمة الأسعار</h1><p class="muted">${new Date().toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}</p>
    <table><thead><tr><th>الصنف</th><th>SKU</th><th>السعر</th></tr></thead><tbody>${body}</tbody></table>`)
}
