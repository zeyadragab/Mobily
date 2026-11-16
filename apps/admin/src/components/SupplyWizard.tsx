import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { METHOD_AR, useCosts, useProducts, variantLabel, type Method } from '../lib/data'
import { newKey } from '../lib/drawers'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { cairoBusinessDate } from '../lib/time'
import { Button, Card, ErrorText, Field, inputCls } from './ui'
import SourcePicker from './SourcePicker'

type Line = { variant_id: string; label: string; tracked: boolean; qty: string; cost: string; serials: string; price: string; wholesale: string }

/** Supply in one step: goods in, supplier invoice created, optional payment now. One key per form, so a double click is one supply. */
export default function SupplyWizard({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canPay = hasRole('owner', 'manager', 'accountant')
  const products = useProducts()
  const costs = useCosts(true)
  const suppliers = useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id,name').eq('status', 'active').order('name')
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })

  const [step, setStep] = useState(1)
  const [key] = useState(newKey)
  const [supplier, setSupplier] = useState('')
  const [invNo, setInvNo] = useState('')
  const [date, setDate] = useState(cairoBusinessDate())
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [search, setSearch] = useState('')
  const [pricing, setPricing] = useState<'keep' | 'apply'>('keep')
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [src, setSrc] = useState({ drawer: '', account: '' })
  const [err, setErr] = useState<unknown>(null)
  const [done, setDone] = useState(false)

  const options = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return []
    const out: { id: string; label: string; tracked: boolean; price: string; wholesale: string }[] = []
    for (const p of products.data ?? []) {
      if (!p.is_active) continue
      for (const v of p.variants) {
        if (!v.is_active) continue
        const label = variantLabel(p, v)
        if (label.toLowerCase().includes(s) || (v.barcode ?? '').includes(s)) out.push({ id: v.id, label, tracked: p.tracking_mode !== 'none', price: v.price, wholesale: v.wholesale_price ?? '' })
      }
    }
    return out.slice(0, 8)
  }, [products.data, search])

  const parseNum = (v: string) => { try { return toMinor(v || '0') } catch { return NaN } }
  const serialList = (t: string) => t.split(/[\s,;،]+/).map((x) => x.trim()).filter(Boolean)
  const lineQty = (l: Line) => (l.tracked ? serialList(l.serials).length : parseInt(l.qty || '0', 10) || 0)
  const total = lines.reduce((s, l) => s + lineQty(l) * (parseNum(l.cost) || 0), 0)
  const paidMinor = parseNum(paid)

  function add(o: { id: string; label: string; tracked: boolean; price: string; wholesale: string }) {
    if (lines.some((l) => l.variant_id === o.id)) return
    setLines([...lines, { variant_id: o.id, label: o.label, tracked: o.tracked, qty: '1', cost: costs.data?.get(o.id) ?? '', serials: '', price: o.price, wholesale: o.wholesale }])
    setSearch('')
  }
  const patch = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)))

  function validateStep(s: number) {
    if (s === 1 && !supplier) return 'اختر المورد.'
    if (s === 2) {
      if (lines.length === 0) return 'أضف صنفًا واحدًا على الأقل.'
      for (const l of lines) {
        if (lineQty(l) <= 0) return `حدد كمية «${l.label}».`
        const c = parseNum(l.cost)
        if (Number.isNaN(c) || c < 0 || l.cost === '') return `اكتب تكلفة صحيحة لـ «${l.label}».`
      }
      if (total <= 0) return 'إجمالي الفاتورة لازم يكون أكبر من صفر.'
    }
    return null
  }
  function next() { const e = validateStep(step); if (e) return setErr(new Error(e)); setErr(null); setStep(step + 1) }

  const save = useMutation({
    mutationFn: async () => {
      if (Number.isNaN(paidMinor) || paidMinor < 0) throw new Error('المبلغ المدفوع غير صحيح.')
      if (paidMinor > total) throw new Error('المدفوع أكبر من إجمالي الفاتورة.')
      const { error } = await supabase.rpc('receive_supply', {
        p_supplier: supplier, p_invoice_no: invNo.trim() || null, p_date: date || null, p_due: due || null,
        p_lines: lines.map((l) => ({
          variant_id: l.variant_id, qty: lineQty(l), unit_cost: Number(fromMinor(parseNum(l.cost))),
          ...(l.tracked ? { serials: serialList(l.serials) } : {}),
          ...(pricing === 'apply' && l.price ? { new_price: Number(fromMinor(parseNum(l.price))), ...(l.wholesale ? { new_wholesale: Number(fromMinor(parseNum(l.wholesale))) } : {}) } : {}),
        })),
        p_pricing: pricing, p_paid: Number(fromMinor(paidMinor || 0)), p_method: paidMinor > 0 ? method : null,
        p_drawer: paidMinor > 0 && method === 'cash' ? src.drawer || null : null,
        p_account: paidMinor > 0 && method !== 'cash' ? src.account || null : null,
        p_idem: key, p_note: note.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      ;['products', 'costs', 'stock', 'suppliers', 'supplier-ledger', 'drawers', 'accounts', 'supply-log'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
      setDone(true)
    },
    onError: setErr,
  })

  if (done) {
    return (
      <Card className="p-8 text-center">
        <h2 className="text-lg font-bold">تم تسجيل التوريد</h2>
        <p className="mt-1 text-sm text-muted">دخلت الكميات المخزون، وفاتورة المورد اتسجلت بإجمالي {formatEGP(total)}{paidMinor > 0 ? `، والمدفوع ${formatEGP(paidMinor)}` : ''}.</p>
        <Button variant="primary" className="mt-4" onClick={onDone}>تم</Button>
      </Card>
    )
  }

  const steps = ['المورد والفاتورة', 'الأصناف', 'التسعير والدفع']
  return (
    <Card className="space-y-5 p-5">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="خطوات التوريد">
        {steps.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? 'step' : undefined}
            className={`rounded-full border px-3 py-1 ${step === i + 1 ? 'border-accent bg-accent text-accent-fg' : step > i + 1 ? 'border-ok/40 text-ok' : 'border-line text-muted'}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      <ErrorText error={err} />

      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="المورد *">
            <select className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">اختر…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="رقم فاتورة المورد" hint="اتركه فارغًا لرقم تلقائي"><input className={inputCls} dir="ltr" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></Field>
          <Field label="تاريخ الفاتورة"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="تاريخ الاستحقاق"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="ملاحظات" className="sm:col-span-2"><input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="relative">
            <input className={inputCls} placeholder="ابحث بالاسم أو SKU أو الباركود لإضافة صنف" aria-label="بحث عن صنف" value={search} onChange={(e) => setSearch(e.target.value)} />
            {options.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-window">
                {options.map((o) => (
                  <li key={o.id}><button type="button" className="w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-bg" onClick={() => add(o)} dir="auto">
                    {o.label}{o.tracked && <span className="text-xs text-muted"> · بسيريال</span>}</button></li>
                ))}
              </ul>
            )}
          </div>
          {lines.length === 0 && <p className="text-sm text-muted">ابحث وأضف الأصناف المستلمة.</p>}
          {lines.map((l, i) => (
            <div key={l.variant_id} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-4">
              <p className="font-medium sm:col-span-3" dir="auto">{l.label}</p>
              <Button small variant="danger" type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}>إزالة</Button>
              {l.tracked ? (
                <Field label={`السيريال / IMEI (${lineQty(l)} مدخل)`} className="sm:col-span-3" hint="واحد في كل سطر أو مفصولة بمسافة">
                  <textarea className={inputCls} rows={3} dir="ltr" value={l.serials} onChange={(e) => patch(i, { serials: e.target.value })} />
                </Field>
              ) : (
                <Field label="الكمية"><input className={inputCls} dir="ltr" inputMode="numeric" value={l.qty} onChange={(e) => patch(i, { qty: e.target.value })} /></Field>
              )}
              <Field label="تكلفة الوحدة"><input className={inputCls} dir="ltr" inputMode="decimal" value={l.cost} onChange={(e) => patch(i, { cost: e.target.value })} /></Field>
            </div>
          ))}
          <p className="text-end text-lg font-bold">الإجمالي: {formatEGP(total)}</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">أسعار البيع</legend>
            {([['keep', 'إبقاء أسعار البيع كما هي'], ['apply', 'تطبيق أسعار جديدة على هذه الأصناف']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="pricing" checked={pricing === k} onChange={() => setPricing(k)} /> {l}</label>
            ))}
          </fieldset>
          {pricing === 'apply' && lines.map((l, i) => (
            <div key={l.variant_id} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-3">
              <p className="text-sm font-medium sm:col-span-3" dir="auto">{l.label}</p>
              <Field label="سعر البيع الجديد"><input className={inputCls} dir="ltr" inputMode="decimal" value={l.price} onChange={(e) => patch(i, { price: e.target.value })} /></Field>
              <Field label="سعر الجملة"><input className={inputCls} dir="ltr" inputMode="decimal" value={l.wholesale} onChange={(e) => patch(i, { wholesale: e.target.value })} /></Field>
            </div>
          ))}
          <div className="rounded-xl bg-bg p-4 text-sm">
            <p className="flex justify-between text-base font-bold"><span>إجمالي الفاتورة</span><span>{formatEGP(total)}</span></p>
            <p className="flex justify-between"><span>الباقي على المورد (دين)</span><span>{formatEGP(Math.max(0, total - (Number.isNaN(paidMinor) ? 0 : paidMinor)))}</span></p>
          </div>
          {canPay ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="المدفوع الآن" hint="صفر = كله دين على المورد"><input className={inputCls} dir="ltr" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" /></Field>
              <Field label="طريقة الدفع">
                <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as Method)}>{Object.entries(METHOD_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </Field>
              {paidMinor > 0 && <SourcePicker method={method} drawer={src.drawer} account={src.account} onDrawer={(d) => setSrc({ ...src, drawer: d })} onAccount={(a) => setSrc({ ...src, account: a })} />}
            </div>
          ) : <p className="text-sm text-muted">الدفع للمورد من صلاحية المالك والمدير والمحاسب. الفاتورة هتتسجل كدين.</p>}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button type="button" disabled={step === 1} onClick={() => { setErr(null); setStep(step - 1) }}>السابق</Button>
        {step < 3 ? <Button variant="primary" type="button" onClick={next}>التالي</Button>
          : <Button variant="primary" type="button" disabled={save.isPending} onClick={() => { setErr(null); save.mutate() }}>{save.isPending ? 'جارٍ الحفظ…' : 'تأكيد التوريد'}</Button>}
      </div>
    </Card>
  )
}
