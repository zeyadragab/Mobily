import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { METHOD_AR, useOpenSession, type Method } from '../lib/data'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'
import { useSettings } from '../lib/settings'

type Bal = { supplier_id: string; name: string; status: string; invoiced: number | string; paid: number | string; balance: number | string; overdue: number | string }
type Inv = {
  id: string; invoice_number: string; invoice_date: string; due_date: string | null; amount: number | string
  expected_amount: number | string | null; status: 'open' | 'pending_approval' | 'rejected'; paid: number | string
  remaining: number | string; po_id: string | null; created_at: string
}
type Pay = { id: string; invoice_id: string | null; amount: number | string; method: Method; note: string | null; status: 'completed' | 'pending_approval' | 'rejected'; paid_at: string }

const m = (v: number | string) => toMinor(v)

export default function SupplierAccounts() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'manager', 'accountant')
  const [search, setSearch] = useState('')
  const [onlyDue, setOnlyDue] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['supplier-balances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_balances').select('*').order('name')
      if (error) throw error
      return data as Bal[]
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((r) => (!s || r.name.toLowerCase().includes(s)) && (!onlyDue || m(r.balance) !== 0 || m(r.overdue) > 0))
  }, [q.data, search, onlyDue])

  const owed = (q.data ?? []).reduce((s, r) => s + Math.max(m(r.balance), 0), 0)
  const advances = (q.data ?? []).reduce((s, r) => s + Math.max(-m(r.balance), 0), 0)
  const overdue = (q.data ?? []).reduce((s, r) => s + m(r.overdue), 0)
  const sup = q.data?.find((r) => r.supplier_id === openId)

  return (
    <div>
      <PageHeader title="حسابات الموردين" subtitle="فواتير الموردين والدفعات والرصيد. الرصيد الموجب = مستحق للمورد، والسالب = دفعة مقدمة لصالح المحل." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">مستحق للموردين</p><p className="mt-1 text-2xl font-bold">{formatEGP(owed)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">منه متأخر</p><p className={`mt-1 text-2xl font-bold ${overdue ? 'text-danger' : ''}`}>{formatEGP(overdue)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">دفعات مقدمة لصالح المحل</p><p className="mt-1 text-2xl font-bold">{formatEGP(advances)}</p></Card>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث باسم المورد" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> أصحاب الأرصدة فقط</label>
      </div>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل الحسابات. تأكد من تطبيق آخر تحديثات قاعدة البيانات." />}
      {q.data && rows.length === 0 && <State kind="empty" title="لا توجد حسابات مطابقة" />}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['المورد', 'إجمالي الفواتير', 'المدفوع', 'الرصيد', 'المتأخر'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.supplier_id} className="cursor-pointer border-b border-line last:border-0 hover:bg-bg" onClick={() => setOpenId(r.supplier_id)}>
                  <td className="p-3 font-medium" dir="auto">{r.name}</td>
                  <td className="whitespace-nowrap p-3">{formatEGP(m(r.invoiced))}</td>
                  <td className="whitespace-nowrap p-3">{formatEGP(m(r.paid))}</td>
                  <td className="whitespace-nowrap p-3 font-semibold">{m(r.balance) < 0 ? <Chip tone="info">مقدم {formatEGP(-m(r.balance))}</Chip> : formatEGP(m(r.balance))}</td>
                  <td className="whitespace-nowrap p-3">{m(r.overdue) > 0 ? <Chip tone="danger">{formatEGP(m(r.overdue))}</Chip> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {sup && <Statement sup={sup} canEdit={canEdit} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function Statement({ sup, canEdit, onClose }: { sup: Bal; canEdit: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'invoice' | 'pay' | null>(null)
  const invs = useQuery({
    queryKey: ['supplier-invoices', sup.supplier_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_invoice_balances').select('*').eq('supplier_id', sup.supplier_id).order('invoice_date')
      if (error) throw error
      return data as Inv[]
    },
  })
  const pays = useQuery({
    queryKey: ['supplier-payments', sup.supplier_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_payments').select('id,invoice_id,amount,method,note,status,paid_at').eq('supplier_id', sup.supplier_id).order('paid_at')
      if (error) throw error
      return data as Pay[]
    },
  })

  // chronological ledger with a running balance (only effective entries move the balance)
  const ledger = useMemo(() => {
    const items = [
      ...(invs.data ?? []).map((i) => ({ at: i.created_at, kind: 'invoice' as const, label: `فاتورة ${i.invoice_number}`, amount: m(i.amount), effective: i.status === 'open', status: i.status, extra: i.due_date ? `استحقاق ${i.due_date}` : '' })),
      ...(pays.data ?? []).map((p) => ({ at: p.paid_at, kind: 'payment' as const, label: p.invoice_id ? 'دفعة على فاتورة' : 'دفعة مقدمة', amount: m(p.amount), effective: p.status === 'completed', status: p.status, extra: `${METHOD_AR[p.method]}${p.note ? ` · ${p.note}` : ''}` })),
    ].sort((a, b) => a.at.localeCompare(b.at))
    let run = 0
    return items.map((e) => { if (e.effective) run += e.kind === 'invoice' ? e.amount : -e.amount; return { ...e, run } })
  }, [invs.data, pays.data])

  return (
    <>
      <Modal open={mode === null} wide onClose={onClose} title={`كشف حساب: ${sup.name}`}
        footer={<>
          <Button className="me-auto" onClick={onClose}>إغلاق</Button>
          {canEdit && <Button onClick={() => setMode('invoice')}>+ فاتورة مورد</Button>}
          {canEdit && <Button variant="primary" onClick={() => setMode('pay')}>+ دفعة</Button>}
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">الفواتير</p><p className="font-bold">{formatEGP(m(sup.invoiced))}</p></div>
            <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">المدفوع</p><p className="font-bold">{formatEGP(m(sup.paid))}</p></div>
            <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">الرصيد</p><p className="font-bold">{formatEGP(m(sup.balance))}</p></div>
          </div>
          {(invs.isLoading || pays.isLoading) && <State kind="loading" />}
          {ledger.length === 0 && !invs.isLoading && <State kind="empty" title="لا توجد حركات بعد" />}
          {ledger.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="text-muted"><tr className="border-b border-line">{['التاريخ', 'البيان', 'عليه', 'له', 'الرصيد', 'الحالة'].map((h) => <th key={h} scope="col" className="p-2 text-start font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {ledger.map((e, i) => (
                    <tr key={i} className={`border-b border-line last:border-0 ${e.effective ? '' : 'opacity-60'}`}>
                      <td className="whitespace-nowrap p-2">{formatCairo(e.at, false)}</td>
                      <td className="p-2">{e.label}<span className="block text-xs text-muted">{e.extra}</span></td>
                      <td className="whitespace-nowrap p-2">{e.kind === 'invoice' ? formatEGP(e.amount) : ''}</td>
                      <td className="whitespace-nowrap p-2">{e.kind === 'payment' ? formatEGP(e.amount) : ''}</td>
                      <td className="whitespace-nowrap p-2 font-semibold">{formatEGP(e.run)}</td>
                      <td className="p-2">{e.status === 'open' || e.status === 'completed' ? <Chip tone="ok">معتمد</Chip> : e.status === 'pending_approval' ? <Chip tone="warn">بانتظار المالك</Chip> : <Chip tone="danger">مرفوض</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
      {mode === 'invoice' && <NewInvoice sup={sup} onClose={() => setMode(null)} />}
      {mode === 'pay' && <NewPayment sup={sup} invoices={(invs.data ?? []).filter((i) => i.status === 'open' && m(i.remaining) > 0)} onClose={() => setMode(null)} />}
    </>
  )
}

const refresh = (qc: ReturnType<typeof useQueryClient>) =>
  ['supplier-balances', 'supplier-invoices', 'supplier-payments', 'approvals', 'cash', 'transactions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

function NewInvoice({ sup, onClose }: { sup: Bal; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ po: '', number: '', date: cairoBusinessDate(), due: '', amount: '', notes: '' })
  const [err, setErr] = useState<unknown>(null)
  const pos = useQuery({
    queryKey: ['supplier-pos', sup.supplier_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_orders').select('id,po_number,status,purchase_order_lines(qty_received,unit_cost)')
        .eq('supplier_id', sup.supplier_id).in('status', ['partially_received', 'received']).order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as { id: string; po_number: string; purchase_order_lines: { qty_received: number; unit_cost: number | string }[] }[]
    },
  })
  const received = (id: string) => {
    const po = pos.data?.find((p) => p.id === id)
    return po ? po.purchase_order_lines.reduce((s, l) => s + l.qty_received * m(l.unit_cost), 0) : null
  }
  const exp = f.po ? received(f.po) : null
  let amt = 0
  try { amt = f.amount ? toMinor(f.amount) : 0 } catch { amt = -1 }
  const mismatch = exp !== null && amt > 0 && Math.abs(amt - exp) > 1

  const save = useMutation({
    mutationFn: async () => {
      if (!f.number.trim()) throw new Error('رقم فاتورة المورد مطلوب.')
      if (amt <= 0) throw new Error('أدخل مبلغًا صحيحًا.')
      const { error } = await supabase.rpc('create_supplier_invoice', {
        p_supplier: sup.supplier_id, p_po: f.po || null, p_number: f.number, p_date: f.date || null,
        p_due: f.due || null, p_amount: Number(fromMinor(amt)), p_notes: f.notes || null,
      })
      if (error) throw error
    },
    onSuccess: () => { refresh(qc); onClose() },
    onError: setErr,
  })

  return (
    <Modal open onClose={onClose} title={`فاتورة مورد — ${sup.name}`}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => { setErr(null); save.mutate() }}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="space-y-3">
        <ErrorText error={err} />
        <Field label="ربط بطلبية استلام (اختياري)" hint="الربط يقارن قيمة الفاتورة بما استُلم فعليًا.">
          <select className={inputCls} value={f.po} onChange={(e) => { const id = e.target.value; const r = id ? received(id) : null; setF({ ...f, po: id, amount: r != null && !f.amount ? fromMinor(r) : f.amount }) }}>
            <option value="">— بدون ربط —</option>
            {pos.data?.map((p) => <option key={p.id} value={p.id}>{p.po_number} — مستلم بقيمة {formatEGP(received(p.id) ?? 0)}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="رقم فاتورة المورد *"><input className={inputCls} dir="ltr" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
          <Field label="المبلغ *"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="تاريخ الفاتورة"><input type="date" className={inputCls} dir="ltr" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="تاريخ الاستحقاق"><input type="date" className={inputCls} dir="ltr" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
          <Field label="ملاحظات" className="sm:col-span-2"><input className={inputCls} dir="auto" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        {mismatch && <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">قيمة الفاتورة تختلف عن المستلم ({formatEGP(exp!)}). ستنتظر موافقة المالك قبل أن تدخل في حساب المورد.</p>}
      </div>
    </Modal>
  )
}

function NewPayment({ sup, invoices, onClose }: { sup: Bal; invoices: Inv[]; onClose: () => void }) {
  const qc = useQueryClient()
  const settings = useSettings()
  const session = useOpenSession()
  const { hasRole } = useAuth()
  const [f, setF] = useState({ invoice: '', amount: '', method: 'transfer' as Method, note: '' })
  const [err, setErr] = useState<unknown>(null)
  const inv = invoices.find((i) => i.id === f.invoice)
  let amt = 0
  try { amt = f.amount ? toMinor(f.amount) : 0 } catch { amt = -1 }
  const thr = (settings.data?.supplier_payment_threshold ?? 20000) * 100
  const needsApproval = amt >= thr && !hasRole('owner')

  const save = useMutation({
    mutationFn: async () => {
      if (amt <= 0) throw new Error('أدخل مبلغًا صحيحًا.')
      const { error } = await supabase.rpc('pay_supplier', {
        p_supplier: sup.supplier_id, p_invoice: f.invoice || null, p_amount: Number(fromMinor(amt)), p_method: f.method, p_note: f.note || null,
      })
      if (error) throw error
    },
    onSuccess: () => { refresh(qc); onClose() },
    onError: setErr,
  })

  return (
    <Modal open onClose={onClose} title={`دفعة للمورد — ${sup.name}`}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => { setErr(null); save.mutate() }}>{save.isPending ? 'جارٍ الحفظ…' : needsApproval ? 'إرسال للمالك للموافقة' : 'تسجيل الدفعة'}</Button></>}>
      <div className="space-y-3">
        <ErrorText error={err} />
        <Field label="تخصيص على فاتورة">
          <select className={inputCls} value={f.invoice} onChange={(e) => { const i = invoices.find((x) => x.id === e.target.value); setF({ ...f, invoice: e.target.value, amount: i ? fromMinor(m(i.remaining)) : f.amount }) }}>
            <option value="">— دفعة مقدمة (بدون فاتورة) —</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} — متبقي {formatEGP(m(i.remaining))}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="المبلغ *" hint={inv ? `المتبقي على الفاتورة ${formatEGP(m(inv.remaining))}` : undefined}><input className={inputCls} dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="طريقة الدفع">
            <select className={inputCls} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as Method })}>
              {Object.entries(METHOD_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="ملاحظة" className="sm:col-span-2"><input className={inputCls} dir="auto" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        {f.method === 'cash' && !session.isLoading && !session.data && <p role="alert" className="text-sm text-warn">الدرج مغلق. افتحه من <Link to="/cash" className="underline">صفحة الدرج</Link> أو اختر طريقة أخرى.</p>}
        {needsApproval && <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">الدفعات من {formatEGP(thr)} فأكثر تحتاج موافقة المالك. لن تُحتسب ولن يخرج المبلغ من الدرج قبل موافقته.</p>}
      </div>
    </Modal>
  )
}
