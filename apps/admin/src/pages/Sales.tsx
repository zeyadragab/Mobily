import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { SALE_METHOD_AR, useOpenSession, useProducts, useStock, variantLabel, type SaleMethod } from '../lib/data'
import { matchCustomer, useCustomers } from '../lib/customers'
import { CustomerForm } from './Customers'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'
import { useSettings } from '../lib/settings'
import ReturnDialog from '../components/ReturnDialog'
import SerialPicker from '../components/SerialPicker'
import { AccountSelect } from '../components/SourcePicker'
import ApproverPin from '../components/ApproverPin'
import { offerOpen, previewOffer, useOffers } from '../lib/offers'

type Invoice = {
  id: string
  invoice_number: string
  status: 'completed' | 'pending_approval' | 'void'
  customer_name: string | null
  customer_phone: string | null
  customer_id?: string | null
  subtotal: string
  discount: string
  offer_discount?: string
  price_mode?: 'retail' | 'wholesale'
  total: string
  notes: string | null
  business_date: string
  created_at: string
  created_by: string
  sales_invoice_lines: { id: string; name_snapshot: string; qty: number; unit_price: string; serials: string[] | null }[]
  sales_payments: { id: string; method: SaleMethod; amount: string }[]
}
const STATUS = {
  completed: { label: 'مكتملة', tone: 'ok' },
  pending_approval: { label: 'بانتظار موافقة المالك على الخصم', tone: 'warn' },
  void: { label: 'ملغاة', tone: 'neutral' },
} as const

type Line = { variant_id: string; qty: number; serials?: string[]; price?: string }
type Unc = { name: string; qty: string; price: string; cost: string; reason: string }
const toMinorSafe = (v: string) => { try { return v ? toMinor(v) : 0 } catch { return 0 } }
const lq = (l: Line) => (l.serials ? l.serials.length : l.qty)
type Pay = { method: SaleMethod; amount: string; account?: string }
type Held = { id: string; label: string | null; customer_name: string | null; customer_phone: string | null; discount: number | string; notes: string | null; lines: Line[]; created_at: string }

export default function Sales() {
  const { hasRole } = useAuth()
  const canSell = hasRole('owner', 'manager', 'cashier')
  const canProfit = hasRole('owner', 'manager', 'accountant')
  const [day, setDay] = useState(cairoBusinessDate())
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [returning, setReturning] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [resume, setResume] = useState<Held | null>(null)
  const qc = useQueryClient()
  const held = useQuery({
    queryKey: ['sales', 'held'],
    enabled: canSell,
    queryFn: async () => {
      const { data, error } = await supabase.from('held_baskets').select('id,label,customer_name,customer_phone,discount,notes,lines,created_at').order('created_at', { ascending: false })
      if (error) throw error
      return data as Held[]
    },
  })
  const discard = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('discard_basket', { p_id: id }); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sales', 'held'] }),
  })

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

  const log = useQuery({
    queryKey: ['sales', 'log', day],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_log').select('id,paid,credit,profit,has_uncoded').eq('business_date', day).limit(300)
      if (error) throw error
      return new Map((data as { id: string; paid: string; credit: string; profit: string | null; has_uncoded: boolean }[]).map((r) => [r.id, r]))
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
        actions={canSell && <>
          <Button onClick={() => setHeldOpen(true)}>فواتير معلّقة{held.data?.length ? ` (${held.data.length})` : ''}</Button>
          <Button variant="primary" onClick={() => { setResume(null); setCreating(true) }}>+ فاتورة جديدة</Button>
        </>}
      />

      <div className="stagger mb-4 grid gap-3 sm:grid-cols-3">
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
              {['الرقم', 'العميل', 'الأصناف', 'الخصم', 'الإجمالي', 'الدفع', 'آجل', ...(canProfit ? ['الربح'] : []), 'الحالة', 'الوقت'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-bg" onClick={() => setViewId(i.id)}>
                  <td className="p-3 font-mono text-xs" dir="ltr">{i.invoice_number}</td>
                  <td className="p-3" dir="auto">{i.customer_name ?? '—'}</td>
                  <td className="p-3">{i.sales_invoice_lines.reduce((s, l) => s + l.qty, 0)}</td>
                  <td className="p-3">{toMinor(i.discount) ? formatEGP(toMinor(i.discount)) : '—'}</td>
                  <td className="whitespace-nowrap p-3 font-semibold">{formatEGP(toMinor(i.total))}</td>
                  <td className="p-3 text-xs">{[...new Set(i.sales_payments.map((p) => SALE_METHOD_AR[p.method]))].join('، ') || '—'}</td>
                  <td className="p-3">{toMinor(log.data?.get(i.id)?.credit ?? '0') ? formatEGP(toMinor(log.data!.get(i.id)!.credit)) : '—'}</td>
                  {canProfit && <td className="p-3">{log.data?.get(i.id)?.profit != null ? formatEGP(toMinor(log.data.get(i.id)!.profit!)) : '—'}{log.data?.get(i.id)?.has_uncoded && <Chip tone="warn">بدون كود</Chip>}</td>}
                  <td className="p-3"><Chip tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Chip></td>
                  <td className="whitespace-nowrap p-3">{formatCairo(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && <NewInvoice initial={resume} onClose={() => { setCreating(false); setResume(null) }} />}

      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title="الفواتير المعلّقة" footer={<Button onClick={() => setHeldOpen(false)}>إغلاق</Button>}>
        <div className="space-y-2 text-sm">
          <ErrorText error={discard.error} />
          {held.isLoading && <State kind="loading" />}
          {held.data?.length === 0 && <p className="py-6 text-center text-muted">لا توجد فواتير معلّقة. من شاشة الفاتورة اضغط «تعليق الفاتورة» لحفظها مؤقتًا وخدمة عميل آخر.</p>}
          {held.data?.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium" dir="auto">{h.label || h.customer_name || 'فاتورة بدون اسم'}</p>
                <p className="text-xs text-muted">{h.lines.length} صنف · {formatCairo(h.created_at)}</p>
              </div>
              <Button small variant="primary" onClick={() => { setResume(h); setHeldOpen(false); setCreating(true) }}>استكمال</Button>
              <Button small variant="danger" disabled={discard.isPending} onClick={() => discard.mutate(h.id)}>حذف</Button>
            </div>
          ))}
          <p className="text-xs text-muted">التعليق لا يحجز المخزون: الكميات تُراجع من جديد عند حفظ الفاتورة.</p>
        </div>
      </Modal>

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
              {toMinor(inv.discount) > 0 && <p className="flex justify-between"><span className="text-muted">الخصم{toMinor(inv.offer_discount ?? '0') > 0 ? ` (منه عرض ${formatEGP(toMinor(inv.offer_discount ?? '0'))})` : ''}</span><span>- {formatEGP(toMinor(inv.discount))}</span></p>}
              <p className="flex justify-between text-base font-bold"><span>الصافي</span><span>{formatEGP(toMinor(inv.total))}</span></p>
            </div>
            {inv.sales_payments.length > 0 && (
              <ul className="space-y-1">{inv.sales_payments.map((p) => <li key={p.id} className="flex justify-between"><span className="text-muted">{SALE_METHOD_AR[p.method]}</span><span>{formatEGP(toMinor(p.amount))}</span></li>)}</ul>
            )}
            {inv.notes && <p className="text-muted" dir="auto">{inv.notes}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

function NewInvoice({ onClose, initial }: { onClose: () => void; initial: Held | null }) {
  const qc = useQueryClient()
  const products = useProducts()
  const stock = useStock()
  const session = useOpenSession()
  const settings = useSettings()
  const { hasRole } = useAuth()

  const [lines, setLines] = useState<Line[]>(initial?.lines ?? [])
  const [find, setFind] = useState('')
  const [discount, setDiscount] = useState(initial && Number(initial.discount) > 0 ? String(initial.discount) : '')
  const [pays, setPays] = useState<Pay[]>([{ method: 'cash', amount: '' }])
  const [customer, setCustomer] = useState({ name: initial?.customer_name ?? '', phone: initial?.customer_phone ?? '', notes: initial?.notes ?? '' })
  const [err, setErr] = useState<unknown>(null)
  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail')
  const [offerId, setOfferId] = useState('')
  const [unc, setUnc] = useState<Unc[]>([])
  const [uncForm, setUncForm] = useState<Unc | null>(null)
  const [pinOpen, setPinOpen] = useState(false)
  const tokenRef = useRef<string | null>(null)
  const offers = useOffers(true)
  const [idem] = useState(() => crypto.randomUUID()) // one key per form: a double click can never sell twice
  const customers = useCustomers()
  const [custId, setCustId] = useState<string | null>(null)
  const [custFind, setCustFind] = useState('')
  const [addingCust, setAddingCust] = useState(false)
  const cust = customers.data?.find((c) => c.id === custId) ?? null
  const custResults = custFind.trim() ? (customers.data ?? []).filter((c) => c.is_active && matchCustomer(c, custFind)).slice(0, 6) : []

  const catalog = useMemo(() => {
    const out: { id: string; label: string; price: number; wholesale: number | null; cat: string | null; barcode: string | null; sku: string; stock: number; tracked: boolean }[] = []
    for (const p of products.data ?? []) {
      if (!p.is_active) continue
      for (const v of p.variants) {
        if (v.is_active) out.push({ id: v.id, label: variantLabel(p, v), price: toMinor(v.price), wholesale: v.wholesale_price ? toMinor(v.wholesale_price) : null, cat: p.category_id, barcode: v.barcode, sku: v.sku, stock: stock.data?.get(v.id) ?? 0, tracked: p.track_serial })
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

  const listOf = (c: { price: number; wholesale: number | null }) => (priceMode === 'wholesale' && c.wholesale !== null ? c.wholesale : c.price)
  const unitOf = (l: Line) => {
    const c = byId.get(l.variant_id)
    if (!c) return 0
    return l.price ? toMinorSafe(l.price) : listOf(c)
  }
  const uncTotal = unc.reduce((s, u) => s + toMinorSafe(u.price) * (parseInt(u.qty, 10) || 1), 0)
  const subtotal = lines.reduce((s, l) => s + unitOf(l) * lq(l), 0) + uncTotal
  const openOffers = (offers.data ?? []).filter((o) => offerOpen(o, cairoBusinessDate()))
  const chosenOffer = openOffers.find((o) => o.id === offerId) ?? null
  const missingSerials = lines.some((l) => l.serials && l.serials.length === 0)
  let discMinor = 0
  try { discMinor = discount ? toMinor(discount) : 0 } catch { discMinor = -1 }
  const offerDisc = chosenOffer
    ? previewOffer(chosenOffer, lines.map((l) => ({ variant_id: l.variant_id, qty: lq(l), unit: unitOf(l), category_id: byId.get(l.variant_id)?.cat ?? null })), subtotal)
    : 0
  const total = subtotal - Math.max(discMinor, 0) - offerDisc
  const paid = pays.reduce((s, p) => { try { return s + (p.amount ? toMinor(p.amount) : 0) } catch { return s } }, 0)
  const remaining = total - paid
  const limitPct = settings.data?.max_discount_pct ?? 5
  const needsApproval = discMinor > 0 && discMinor > (subtotal * limitPct) / 100 && !hasRole('owner')
  const usesCash = pays.some((p) => p.method === 'cash' && p.amount)
  const noDrawer = usesCash && !session.isLoading && !session.data && !needsApproval
  const creditMinor = pays.reduce((s, p) => { try { return s + (p.method === 'credit' && p.amount ? toMinor(p.amount) : 0) } catch { return s } }, 0)
  const creditRoom = cust ? toMinor(cust.credit_limit) - cust.balance : 0
  const overLimit = !!cust && creditMinor > 0 && creditMinor > creditRoom && !hasRole('owner')
  const payload = () => ({
    p_customer_name: customer.name || null,
    p_customer_phone: customer.phone || null,
    p_discount: Number(fromMinor(Math.max(discMinor, 0))),
    p_notes: customer.notes || null,
    p_lines: lines.map((l) => (l.serials ? { variant_id: l.variant_id, serials: l.serials } : { variant_id: l.variant_id, qty: l.qty })),
  })
  const saleLines = () => [
    ...lines.map((l) => ({ ...(l.serials ? { variant_id: l.variant_id, serials: l.serials } : { variant_id: l.variant_id, qty: l.qty }), ...(l.price ? { price: Number(fromMinor(toMinorSafe(l.price))) } : {}) })),
    ...unc.map((u) => ({ uncoded: { name: u.name.trim(), qty: parseInt(u.qty, 10) || 1, price: Number(fromMinor(toMinorSafe(u.price))), cost: Number(fromMinor(toMinorSafe(u.cost))), reason: u.reason.trim() } })),
  ]
  const hold = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error('basket is empty')
      const p = payload()
      const { error } = await supabase.rpc('hold_basket', { p_label: cust?.name || customer.name || null, p_customer_name: p.p_customer_name, p_customer_phone: p.p_customer_phone,
        p_discount: p.p_discount, p_notes: p.p_notes, p_lines: p.p_lines, p_replace: initial?.id ?? null })
      if (error) throw error
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['sales', 'held'] }); onClose() },
    onError: (e) => setErr(e),
  })

  const save = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error('أضف صنفًا واحدًا على الأقل.')
      if (missingSerials) throw new Error('serial numbers required')
      if (discMinor < 0) throw new Error('الخصم رقم صحيح بحد أقصى خانتين عشريتين.')
      if (remaining !== 0) throw new Error('payments must equal the invoice total')
      if (creditMinor > 0 && !cust) throw new Error('customer required for credit sale')
      if (lines.some((l) => l.price && toMinorSafe(l.price) <= 0 && !hasRole('owner'))) throw new Error('سعر الوحدة غير صحيح.')
      const { data, error } = await supabase.rpc('create_sale_once', {
        p_idem: idem,
        ...payload(),
        p_lines: saleLines(),
        p_price_mode: priceMode,
        p_offer: chosenOffer?.id ?? null,
        p_override: tokenRef.current,
        p_payments: pays.filter((p) => p.amount).map((p) => ({
          method: p.method, amount: Number(fromMinor(toMinor(p.amount))),
          ...(p.method !== 'cash' && p.method !== 'credit' && p.account ? { account: p.account } : {}),
        })),
        p_held: initial?.id ?? null,
        p_customer: cust?.id ?? null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      ;['sales', 'stock', 'approvals', 'products', 'cash', 'customers', 'drawers', 'accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      onClose()
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? '')
      if (/override required|override invalid/i.test(msg)) { tokenRef.current = null; setPinOpen(true); return }
      setErr(e)
    },
  })

  return (
    <Modal open wide onClose={onClose} title="فاتورة بيع جديدة"
      footer={<>
        <Button className="me-auto" disabled={hold.isPending || lines.length === 0} onClick={() => { setErr(null); hold.mutate() }}>تعليق الفاتورة</Button>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="primary" disabled={save.isPending || lines.length === 0 || remaining !== 0 || missingSerials || overLimit} onClick={() => { setErr(null); save.mutate() }}>
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

        <div role="group" aria-label="نوع السعر" className="flex gap-2 text-sm">
          {([['retail', 'سعر التجزئة'], ['wholesale', 'سعر الجملة']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={priceMode === k} onClick={() => setPriceMode(k)}
              className={`rounded-lg border px-3 py-1.5 transition active:scale-[0.97] ${priceMode === k ? 'border-accent btn-gel' : 'border-line bg-surface'}`}>{l}</button>
          ))}
          <Button small type="button" className="ms-auto" onClick={() => setUncForm({ name: '', qty: '1', price: '', cost: '', reason: '' })}>+ صنف بدون كود</Button>
        </div>
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
                    <span className="whitespace-nowrap text-xs text-muted">{formatEGP(listOf(r))} · متاح {r.stock}</span>
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
                  <input aria-label="سعر الوحدة" className={`${inputCls} !w-24`} dir="ltr" inputMode="decimal" value={l.price ?? ''} placeholder={c ? fromMinor(listOf(c)) : ''}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.variant_id === l.variant_id ? { ...x, price: e.target.value || undefined } : x)))} />
                  <span className="w-24 text-end font-semibold">{formatEGP(unitOf(l) * lq(l))}</span>
                  {c && lq(l) > c.stock && <Chip tone="danger">المتاح {c.stock}</Chip>}
                  <Button small variant="danger" onClick={() => setLines((ls) => ls.filter((x) => x.variant_id !== l.variant_id))}>إزالة</Button>
                  {l.serials && <SerialPicker variantId={l.variant_id} value={l.serials} onChange={(v) => setLines((ls) => ls.map((x) => (x.variant_id === l.variant_id ? { ...x, serials: v } : x)))} />}
                </li>
              )
            })}
          </ul>
        )}

        {unc.length > 0 && (
          <ul className="space-y-2">
            {unc.map((u, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-3 text-sm">
                <span className="min-w-0 flex-1" dir="auto">{u.name} <Chip tone="warn">بدون كود</Chip> <span className="text-muted">× {u.qty} · {u.reason}</span></span>
                <span className="font-semibold">{formatEGP(toMinorSafe(u.price) * (parseInt(u.qty, 10) || 1))}</span>
                <Button small variant="danger" onClick={() => setUnc(unc.filter((_, j) => j !== i))}>إزالة</Button>
              </li>
            ))}
          </ul>
        )}
        {uncForm && (
          <div className="grid gap-2 rounded-xl border border-line bg-bg p-3 sm:grid-cols-5">
            <Field label="الاسم" className="sm:col-span-2"><input className={inputCls} dir="auto" value={uncForm.name} onChange={(e) => setUncForm({ ...uncForm, name: e.target.value })} /></Field>
            <Field label="الكمية"><input className={inputCls} dir="ltr" inputMode="numeric" value={uncForm.qty} onChange={(e) => setUncForm({ ...uncForm, qty: e.target.value })} /></Field>
            <Field label="سعر البيع"><input className={inputCls} dir="ltr" inputMode="decimal" value={uncForm.price} onChange={(e) => setUncForm({ ...uncForm, price: e.target.value })} /></Field>
            <Field label="التكلفة"><input className={inputCls} dir="ltr" inputMode="decimal" value={uncForm.cost} onChange={(e) => setUncForm({ ...uncForm, cost: e.target.value })} /></Field>
            <Field label="سبب البيع بدون كود *" className="sm:col-span-4"><input className={inputCls} dir="auto" value={uncForm.reason} onChange={(e) => setUncForm({ ...uncForm, reason: e.target.value })} /></Field>
            <div className="flex items-end gap-2">
              <Button small variant="primary" type="button" onClick={() => {
                if (!uncForm.name.trim() || !uncForm.reason.trim() || toMinorSafe(uncForm.price) <= 0) return setErr(new Error('الاسم والسبب وسعر البيع مطلوبين.'))
                setUnc([...unc, uncForm]); setUncForm(null); setErr(null)
              }}>إضافة</Button>
              <Button small type="button" onClick={() => setUncForm(null)}>إلغاء</Button>
            </div>
            <p className="text-xs text-muted sm:col-span-5">لو قيمة الصنف 1,000 جنيه أو أكتر والكاشير بيبيع، بيحتاج رقم سري لمدير. البيع بيتسجل بالتكلفة والسبب للمراجعة.</p>
          </div>
        )}

        <div className="rounded-xl border border-line p-3">
          {cust ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold" dir="auto">{cust.name} <bdi className="text-xs font-normal text-muted">{cust.code} · {cust.phone}</bdi></p>
                <p className="text-xs text-muted">عليه {formatEGP(cust.balance)} · حد الآجل {formatEGP(toMinor(cust.credit_limit))} · المتاح للآجل {formatEGP(Math.max(creditRoom, 0))}</p>
              </div>
              <Button small onClick={() => { setCustId(null); setPays((ps) => ps.map((p) => (p.method === 'credit' ? { ...p, method: 'cash' } : p))) }}>تغيير العميل</Button>
            </div>
          ) : (
            <div className="relative">
              <Field label="عميل مسجل (مطلوب للبيع الآجل)">
                <input className={inputCls} dir="auto" placeholder="ابحث بالاسم أو رقم الهاتف" value={custFind} onChange={(e) => setCustFind(e.target.value)} />
              </Field>
              {custFind.trim() && (
                <ul className="absolute inset-x-0 z-10 mt-1 max-h-60 animate-fade overflow-y-auto rounded-xl border border-line bg-surface shadow-float">
                  {custResults.map((c) => (
                    <li key={c.id}><button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-bg"
                      onClick={() => { setCustId(c.id); setCustFind(''); setCustomer((x) => ({ ...x, name: c.name, phone: c.phone })) }}>
                      <span dir="auto">{c.name}</span><bdi className="text-xs text-muted">{c.phone}</bdi></button></li>
                  ))}
                  <li><button className="w-full px-3 py-2 text-start text-sm font-medium text-accent hover:bg-bg" onClick={() => setAddingCust(true)}>+ إضافة عميل جديد</button></li>
                </ul>
              )}
            </div>
          )}
        </div>
        {addingCust && <CustomerForm customer={null} onClose={() => setAddingCust(false)} onSaved={(id) => { setCustId(id); setCustFind('') }} />}

        {openOffers.length > 0 && (
          <Field label="عرض" hint={chosenOffer ? (offerDisc > 0 ? `خصم العرض - ${formatEGP(offerDisc)}` : 'العرض لا ينطبق على الأصناف الحالية') : undefined}>
            <select className={inputCls} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">بدون عرض</option>{openOffers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
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
              <select aria-label="طريقة الدفع" className={`${inputCls} !w-36`} value={p.method} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, method: e.target.value as SaleMethod } : x)))}>
                {Object.entries(SALE_METHOD_AR).map(([k, l]) => <option key={k} value={k} disabled={k === 'credit' && !cust}>{l}{k === 'credit' && !cust ? ' (اختر عميلًا)' : ''}</option>)}
              </select>
              <input aria-label="المبلغ" className={`${inputCls} !w-40`} dir="ltr" inputMode="decimal" placeholder="المبلغ" value={p.amount} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              {p.method !== 'cash' && p.method !== 'credit' && (
                <AccountSelect value={p.account ?? ''} onChange={(id) => setPays(pays.map((x, j) => (j === i ? { ...x, account: id } : x)))} />
              )}
              {remaining > 0 && !p.amount && <Button small onClick={() => setPays(pays.map((x, j) => (j === i ? { ...x, amount: fromMinor(remaining) } : x)))}>الباقي {formatEGP(remaining)}</Button>}
              {pays.length > 1 && <Button small variant="danger" onClick={() => setPays(pays.filter((_, j) => j !== i))}>إزالة</Button>}
            </div>
          ))}
        </div>

        {overLimit && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            مبلغ الآجل ({formatEGP(creditMinor)}) أكبر من المتاح للعميل ({formatEGP(Math.max(creditRoom, 0))}). زوّد المدفوع الآن أو اطلب من المالك رفع الحد.
          </p>
        )}
        <div className="space-y-1 rounded-xl bg-bg p-4 text-sm">
          <p className="flex justify-between"><span className="text-muted">قبل الخصم</span><span>{formatEGP(subtotal)}</span></p>
          {discMinor > 0 && <p className="flex justify-between"><span className="text-muted">الخصم</span><span>- {formatEGP(discMinor)}</span></p>}
          {offerDisc > 0 && <p className="flex justify-between"><span className="text-muted">العرض: {chosenOffer?.name}</span><span>- {formatEGP(offerDisc)}</span></p>}
          <p className="flex justify-between text-lg font-bold"><span>الصافي</span><span>{formatEGP(Math.max(total, 0))}</span></p>
          <p className={`flex justify-between ${remaining === 0 ? 'text-ok' : 'text-warn'}`}><span>{remaining === 0 ? 'الدفع مكتمل' : remaining > 0 ? 'متبقي للدفع' : 'زيادة في الدفع'}</span><span>{remaining === 0 ? '✓' : formatEGP(Math.abs(remaining))}</span></p>
        </div>
      </div>
      <ApproverPin open={pinOpen} onClose={() => setPinOpen(false)} reason="سعر أقل من المسموح أو صنف بدون كود في فاتورة بيع"
        onToken={(t) => { tokenRef.current = t; setPinOpen(false); setErr(null); save.mutate() }} />
    </Modal>
  )
}
