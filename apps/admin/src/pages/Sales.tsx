import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { METHOD_AR, useOpenSession, useProducts, useStock, variantLabel, type Method } from '../lib/data'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'
import { useSettings } from '../lib/settings'
import ReturnDialog from '../components/ReturnDialog'
import SerialPicker from '../components/SerialPicker'

type Invoice = {
  id: string
  invoice_number: string
  status: 'completed' | 'pending_approval' | 'void'
  customer_name: string | null
  customer_phone: string | null
  subtotal: string
  discount: string
  total: string
  notes: string | null
  business_date: string
  created_at: string
  created_by: string
  sales_invoice_lines: { id: string; name_snapshot: string; qty: number; unit_price: string; serials: string[] | null }[]
  sales_payments: { id: string; method: Method; amount: string }[]
}
const STATUS = {
  completed: { label: 'مكتملة', tone: 'ok' },
  pending_approval: { label: 'بانتظار موافقة المالك على الخصم', tone: 'warn' },
  void: { label: 'ملغاة', tone: 'neutral' },
} as const

type Line = { variant_id: string; qty: number; serials?: string[] }
const lq = (l: Line) => (l.serials ? l.serials.length : l.qty)
type Pay = { method: Method; amount: string }

export default function Sales() {
  const { hasRole } = useAuth()
  const canSell = hasRole('owner', 'manager', 'cashier')
  const [day, setDay] = useState(cairoBusinessDate())
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [returning, setReturning] = useState(false)

  const q = useQuery({
    queryKey: ['sales', day],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_invoices')
        .select('*, sales_invoice_lines(*), sales_payments(*)')
        .eq('business_date', day)
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return data as unknown as Invoice[]
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter(
      (i) => !s || i.invoice_number.toLowerCase().includes(s) || (i.customer_name ?? '').toLowerCase().includes(s) || (i.customer_phone ?? '').includes(s),
    )
  }, [q.data, search])

  const done = rows.filter((r) => r.status === 'completed')
  const dayTotal = done.reduce((s, r) => s + toMinor(r.total), 0)
  const inv = q.data?.find((i) => i.id === viewId)

  return (
    <div>
      <PageHeader
        title="المبيعات"
        subtitle="سجّل كل عملية بيع هنا. تُخصم الكمية من المخزون وتُسجَّل الدفعات تلقائيًا."
        actions={canSell && <Button variant="primary" onClick={() => setCreating(true)}>+ فاتورة جديدة</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">مبيعات اليوم المحدد</p><p className="mt-1 text-2xl font-bold">{formatEGP(dayTotal)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">عدد الفواتير المكتملة</p><p className="mt-1 text-2xl font-bold">{done.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">بانتظار موافقة</p><p className="mt-1 text-2xl font-bold">{rows.filter((r) => r.status === 'pending_approval').length}</p></Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input type="date" className={`${inputCls} sm:w-44`} dir="ltr" aria-label="اليوم" value={day} onChange={(e) => setDay(e.target.value || cairoBusinessDate())} />
        <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث برقم الفاتورة أو العميل" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل الفواتير." />}
      {q.data && rows.length === 0 && (
        <State kind="empty" title="لا توجد فواتير في هذا اليوم" action={canSell ? <Button variant="primary" onClick={() => setCreating(true)}>+ فاتورة جديدة</Button> : undefined} />
      )}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['الرقم', 'العميل', 'الأصناف', 'الخصم', 'الإجمالي', 'الدفع', 'الحالة', 'الوقت'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-bg" onClick={() => setViewId(i.id)}>
                  <td className="p-3 font-mono text-xs" dir="ltr">{i.invoice_number}</td>
                  <td className="p-3" dir="auto">{i.customer_name ?? '—'}</td>
                  <td className="p-3">{i.sales_invoice_lines.reduce((s, l) => s + l.qty, 0)}</td>
                  <td className="p-3">{toMinor(i.discount) ? formatEGP(toMinor(i.discount)) : '—'}</td>
                  <td className="whitespace-nowrap p-3 font-semibold">{formatEGP(toMinor(i.total))}</td>
                  <td className="p-3 text-xs">{[...new Set(i.sales_payments.map((p) => METHOD_AR[p.method]))].join('، ') || '—'}</td>
                  <td className="p-3"><Chip tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Chip></td>
                  <td className="whitespace-nowrap p-3">{formatCairo(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && <NewInvoice onClose={() => setCreating(false)} />}

      {inv && returning && <ReturnDialog inv={inv} onClose={() => setReturning(false)} />}
      <Modal open={!!inv && !returning} onClose={() => setViewId(null)} title={inv ? `فاتورة ${inv.invoice_number}` : ''}
        footer={<>
          {inv && inv.status === 'completed' && canSell && <Button className="me-auto" onClick={() => setReturning(true)}>إرجاع أصناف</Button>}
          <Button onClick={() => setViewId(null)}>إغلاق</Button>
        </>}>
        {inv && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Chip>
              <span className="text-muted">{formatCairo(inv.created_at)}</span>
            </div>
            {(inv.customer_name || inv.customer_phone) && <p dir="auto">العميل: {inv.customer_name} {inv.customer_phone && <span dir="ltr">· {inv.customer_phone}</span>}</p>}
            <ul className="space-y-1">
              {inv.sales_invoice_lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-2"><span dir="auto">{l.name_snapshot} <span className="text-muted">× {l.qty}</span>{l.serials && <span className="block font-mono text-xs text-muted" dir="ltr">{l.serials.join(' · ')}</span>}</span><span>{formatEGP(toMinor(l.unit_price) * l.qty)}</span></li>
              ))}
            </ul>
            <div className="space-y-1 border-t border-line pt-2">
              <p className="flex justify-between"><span className="text-muted">الإجمالي قبل الخصم</span><span>{formatEGP(toMinor(inv.subtotal))}</span></p>
              {toMinor(inv.discount) > 0 && <p className="flex justify-between"><span className="text-muted">الخصم</span><span>- {formatEGP(toMinor(inv.discount))}</span></p>}
              <p className="flex justify-between text-base font-bold"><span>الصافي</span><span>{formatEGP(toMinor(inv.total))}</span></p>
            </div>
            {inv.sales_payments.length > 0 && (
              <ul className="space-y-1">{inv.sales_payments.map((p) => <li key={p.id} className="flex justify-between"><span className="text-muted">{METHOD_AR[p.method]}</span><span>{formatEGP(toMinor(p.amount))}</span></li>)}</ul>
            )}
            {inv.notes && <p className="text-muted" dir="auto">{inv.notes}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

function NewInvoice({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const products = useProducts()
  const stock = useStock()
  const session = useOpenSession()
  const settings = useSettings()
  const { hasRole } = useAuth()

  const [lines, setLines] = useState<Line[]>([])
  const [find, setFind] = useState('')
  const [discount, setDiscount] = useState('')
  const [pays, setPays] = useState<Pay[]>([{ method: 'cash', amount: '' }])
  const [customer, setCustomer] = useState({ name: '', phone: '', notes: '' })
  const [err, setErr] = useState<unknown>(null)

  const catalog = useMemo(() => {
    const out: { id: string; label: string; price: number; barcode: string | null; sku: string; stock: number; tracked: boolean }[] = []
    for (const p of products.data ?? []) {
      if (!p.is_active) continue
      for (const v of p.variants) {
        if (v.is_active) out.push({ id: v.id, label: variantLabel(p, v), price: toMinor(v.price), barcode: v.barcode, sku: v.sku, stock: stock.data?.get(v.id) ?? 0, tracked: p.track_serial })
      }
    }
    return out
  }, [products.data, stock.data])
  const byId = new Map(catalog.map((c) => [c.id, c]))

  const results = useMemo(() => {
    const s = find.trim().toLowerCase()
    if (!s) return []
    return catalog.filter((c) => c.label.toLowerCase().includes(s) || c.sku.toLowerCase() === s || c.barcode === find.trim()).slice(0, 8)
  }, [find, catalog])

  function add(id: string) {
    const tracked = byId.get(id)?.tracked
    setLines((ls) =>
      ls.some((l) => l.variant_id === id)
        ? tracked ? ls : ls.map((l) => (l.variant_id === id ? { ...l, qty: l.qty + 1 } : l))
        : [...ls, tracked ? { variant_id: id, qty: 0, serials: [] } : { variant_id: id, qty: 1 }],
    )
    setFind('')
  }

  const subtotal = lines.reduce((s, l) => s + (byId.get(l.variant_id)?.price ?? 0) * lq(l), 0)
  const missingSerials = lines.some((l) => l.serials && l.serials.length === 0)
  let discMinor = 0
  try { discMinor = discount ? toMinor(discount) : 0 } catch { discMinor = -1 }
  const total = subtotal - Math.max(discMinor, 0)
  const paid = pays.reduce((s, p) => { try { return s + (p.amount ? toMinor(p.amount) : 0) } catch { return s } }, 0)
  const remaining = total - paid
  const limitPct = settings.data?.max_discount_pct ?? 5
  const needsApproval = discMinor > 0 && discMinor > (subtotal * limitPct) / 100 && !hasRole('owner')
  const usesCash = pays.some((p) => p.method === 'cash' && p.amount)
  const noDrawer = usesCash && !session.isLoading && !session.data && !needsApproval

  const save = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error('أضف صنفًا واحدًا على الأقل.')
      if (missingSerials) throw new Error('serial numbers required')
      if (discMinor < 0) throw new Error('الخصم رقم صحيح بحد أقصى خانتين عشريتين.')
      if (remaining !== 0) throw new Error('payments must equal the invoice total')
      const { data, error } = await supabase.rpc('create_sale', {
        p_customer_name: customer.name || null,
        p_customer_phone: customer.phone || null,
        p_discount: Number(fromMinor(Math.max(discMinor, 0))),
        p_notes: customer.notes || null,
        p_lines: lines.map((l) => (l.serials ? { variant_id: l.variant_id, serials: l.serials } : { variant_id: l.variant_id, qty: l.qty })),
        p_payments: pays.filter((p) => p.amount).map((p) => ({ method: p.method, amount: Number(fromMinor(toMinor(p.amount))) })),
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      ;['sales', 'stock', 'approvals', 'products', 'cash'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      onClose()
    },
    onError: (e) => setErr(e),
  })

  return (
    <Modal open wide onClose={onClose} title="فاتورة بيع جديدة"
      footer={<>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="primary" disabled={save.isPending || lines.length === 0 || remaining !== 0 || missingSerials} onClick={() => { setErr(null); save.mutate() }}>
          {save.isPending ? 'جارٍ الحفظ…' : needsApproval ? 'إرسال للمالك للموافقة' : 'حفظ الفاتورة'}
        </Button>
      </>}>
      <div className="space-y-5">
        <ErrorText error={err} />
        {noDrawer && (
          <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            الدرج مغلق. افتحه من <Link to="/cash" className="underline">صفحة الدرج</Link> قبل استلام نقدية، أو اختر طريقة دفع أخرى.
          </p>
        )}

        <div className="relative">
          <Field label="ابحث عن صنف (اسم، SKU، أو امسح الباركود)">
            <input className={inputCls} dir="auto" autoFocus value={find} onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); add(results[0].id) } }} />
          </Field>
          {results.length > 0 && (
            <ul className="absolute inset-x-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
              {results.map((r) => (
                <li key={r.id}>
                  <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-bg disabled:opacity-50" disabled={r.stock <= 0} onClick={() => add(r.id)}>
                    <span dir="auto">{r.label}</span>
                    <span className="whitespace-nowrap text-xs text-muted">{formatEGP(r.price)} · متاح {r.stock}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? <p className="text-sm text-muted">لم تُضف أصناف بعد.</p> : (
          <ul className="space-y-2">
            {lines.map((l) => {
              const c = byId.get(l.variant_id)
              return (
                <li key={l.variant_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
                  <span className="min-w-0 flex-1" dir="auto">{c?.label}{l.serials && <Chip tone="info">جهاز بسيريال</Chip>}</span>
                  {l.serials ? <span className="w-12 text-center text-muted">× {l.serials.length}</span> : (
                    <input aria-label="الكمية" className={`${inputCls} !w-20`} dir="ltr" inputMode="numeric" value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x) => (x.variant_id === l.variant_id ? { ...x, qty: Math.max(1, parseInt(e.target.value || '1', 10) || 1) } : x)))} />
                  )}
                  <span className="w-24 text-end font-semibold">{formatEGP((c?.price ?? 0) * lq(l))}</span>
                  {c && lq(l) > c.stock && <Chip tone="danger">المتاح {c.stock}</Chip>}
                  <Button small variant="danger" onClick={() => setLines((ls) => ls.filter((x) => x.variant_id !== l.variant_id))}>إزالة</Button>
                  {l.serials && <SerialPicker variantId={l.variant_id} value={l.serials} onChange={(v) => setLines((ls) => ls.map((x) => (x.variant_id === l.variant_id ? { ...x, serials: v } : x)))} />}
                </li>
              )
            })}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="اسم العميل (اختياري)"><input className={inputCls} dir="auto" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></Field>
          <Field label="هاتف العميل (اختياري)"><input className={inputCls} dir="ltr" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></Field>
          <Field label="خصم (جنيه)" hint={`الخصم فوق ${limitPct}% يحتاج موافقة المالك`}>
            <input className={inputCls} dir="ltr" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
        </div>
        {needsApproval && (
          <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            هذا الخصم أكبر من الحد المسموح. ستنتظر الفاتورة موافقة المالك، ولن يُخصم المخزون ولن تُسجَّل الدفعة قبل موافقته.
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">الدفع</h3>
            <Button small onClick={() => setPays([...pays, { method: 'card', amount: '' }])}>+ طريقة دفع</Button>
          </div>
          {pays.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <select aria-label="طريقة الدفع" className={`${inputCls} !w-36`} value={p.method} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, method: e.target.value as Method } : x)))}>
                {Object.entries(METHOD_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input aria-label="المبلغ" className={`${inputCls} !w-40`} dir="ltr" inputMode="decimal" placeholder="المبلغ" value={p.amount} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              {remaining > 0 && !p.amount && <Button small onClick={() => setPays(pays.map((x, j) => (j === i ? { ...x, amount: fromMinor(remaining) } : x)))}>الباقي {formatEGP(remaining)}</Button>}
              {pays.length > 1 && <Button small variant="danger" onClick={() => setPays(pays.filter((_, j) => j !== i))}>إزالة</Button>}
            </div>
          ))}
        </div>

        <div className="space-y-1 rounded-xl bg-bg p-4 text-sm">
          <p className="flex justify-between"><span className="text-muted">قبل الخصم</span><span>{formatEGP(subtotal)}</span></p>
          {discMinor > 0 && <p className="flex justify-between"><span className="text-muted">الخصم</span><span>- {formatEGP(discMinor)}</span></p>}
          <p className="flex justify-between text-lg font-bold"><span>الصافي</span><span>{formatEGP(Math.max(total, 0))}</span></p>
          <p className={`flex justify-between ${remaining === 0 ? 'text-ok' : 'text-warn'}`}><span>{remaining === 0 ? 'الدفع مكتمل' : remaining > 0 ? 'متبقي للدفع' : 'زيادة في الدفع'}</span><span>{remaining === 0 ? '✓' : formatEGP(Math.abs(remaining))}</span></p>
        </div>
      </div>
    </Modal>
  )
}
