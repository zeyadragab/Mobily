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

type Exp = {
  id: string
  category_name: string
  description: string
  beneficiary: string | null
  amount: string
  expense_date: string
  due_date: string | null
  invoice_ref: string | null
  notes: string | null
  status: 'open' | 'pending_approval' | 'rejected'
  paid: string
  remaining: string
  created_at: string
}

function state(e: Exp): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'info' } {
  if (e.status === 'pending_approval') return { label: 'بانتظار موافقة المالك', tone: 'warn' }
  if (e.status === 'rejected') return { label: 'مرفوض', tone: 'danger' }
  if (toMinor(e.remaining) === 0) return { label: 'مدفوع', tone: 'ok' }
  if (e.due_date && e.due_date < cairoBusinessDate()) return { label: 'متأخر', tone: 'danger' }
  return toMinor(e.paid) > 0 ? { label: 'مدفوع جزئيًا', tone: 'info' } : { label: 'غير مدفوع', tone: 'neutral' }
}

export default function Expenses() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'manager', 'accountant')
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid' | 'pending'>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_balances').select('*').order('expense_date', { ascending: false }).limit(500)
      if (error) throw error
      return data as Exp[]
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((e) => {
      const rem = toMinor(e.remaining)
      const ok =
        filter === 'all' ? true : filter === 'pending' ? e.status === 'pending_approval'
        : filter === 'paid' ? e.status === 'open' && rem === 0 : e.status === 'open' && rem > 0
      return ok && (!s || e.description.toLowerCase().includes(s) || (e.beneficiary ?? '').toLowerCase().includes(s) || e.category_name.includes(s))
    })
  }, [q.data, filter, search])

  const totals = useMemo(() => {
    const open = (q.data ?? []).filter((e) => e.status === 'open')
    return {
      remaining: open.reduce((s, e) => s + toMinor(e.remaining), 0),
      paid: open.reduce((s, e) => s + toMinor(e.paid), 0),
      overdue: open.filter((e) => toMinor(e.remaining) > 0 && e.due_date && e.due_date < cairoBusinessDate()).length,
    }
  }, [q.data])
  const ex = q.data?.find((e) => e.id === viewId)

  return (
    <div>
      <PageHeader title="المصروفات" subtitle="سجّل الفواتير والمصاريف، وادفع كاملة أو على دفعات."
        actions={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>+ مصروف جديد</Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">المتبقي للسداد</p><p className="mt-1 text-2xl font-bold">{formatEGP(totals.remaining)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">المدفوع</p><p className="mt-1 text-2xl font-bold">{formatEGP(totals.paid)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">فواتير متأخرة</p><p className={`mt-1 text-2xl font-bold ${totals.overdue ? 'text-danger' : ''}`}>{totals.overdue}</p></Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث بالبيان أو المستفيد أو البند" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${inputCls} sm:w-48`} aria-label="الحالة" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">الكل</option><option value="unpaid">غير مسدد بالكامل</option><option value="paid">مدفوع</option><option value="pending">بانتظار موافقة</option>
        </select>
      </div>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل المصروفات." />}
      {q.data && rows.length === 0 && <State kind="empty" title="لا توجد مصروفات" action={canEdit ? <Button variant="primary" onClick={() => setCreating(true)}>+ مصروف جديد</Button> : undefined} />}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['البند', 'البيان', 'المستفيد', 'الاستحقاق', 'المبلغ', 'المدفوع', 'المتبقي', 'الحالة'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((e) => {
                const s = state(e)
                return (
                  <tr key={e.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-bg" onClick={() => setViewId(e.id)}>
                    <td className="p-3">{e.category_name}</td>
                    <td className="p-3 font-medium" dir="auto">{e.description}</td>
                    <td className="p-3" dir="auto">{e.beneficiary ?? '—'}</td>
                    <td className="whitespace-nowrap p-3">{e.due_date ?? '—'}</td>
                    <td className="whitespace-nowrap p-3">{formatEGP(toMinor(e.amount))}</td>
                    <td className="whitespace-nowrap p-3">{formatEGP(toMinor(e.paid))}</td>
                    <td className="whitespace-nowrap p-3 font-semibold">{formatEGP(toMinor(e.remaining))}</td>
                    <td className="p-3"><Chip tone={s.tone}>{s.label}</Chip></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {creating && <NewExpense onClose={() => setCreating(false)} />}
      {ex && <ExpenseDialog ex={ex} canPay={canEdit} onClose={() => setViewId(null)} />}
    </div>
  )
}

function NewExpense({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const settings = useSettings()
  const { hasRole } = useAuth()
  const cats = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_categories').select('id,name').order('sort_order')
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })
  const [f, setF] = useState({ category: '', description: '', beneficiary: '', amount: '', date: cairoBusinessDate(), due: '', ref: '', notes: '' })
  const [err, setErr] = useState<unknown>(null)
  const thr = settings.data?.expense_approval_threshold ?? 5000
  let amt = 0
  try { amt = f.amount ? toMinor(f.amount) : 0 } catch { amt = -1 }
  const needsApproval = amt >= thr * 100 && !hasRole('owner')

  const save = useMutation({
    mutationFn: async () => {
      if (!f.category) throw new Error('اختر البند.')
      if (!f.description.trim()) throw new Error('اكتب بيان المصروف.')
      if (amt <= 0) throw new Error('أدخل مبلغًا صحيحًا أكبر من صفر.')
      const { error } = await supabase.rpc('create_expense', {
        p_category: f.category, p_description: f.description, p_beneficiary: f.beneficiary || null,
        p_amount: Number(fromMinor(amt)), p_expense_date: f.date || null, p_due_date: f.due || null,
        p_invoice_ref: f.ref || null, p_notes: f.notes || null,
      })
      if (error) throw error
    },
    onSuccess: () => { ['expenses', 'approvals'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose() },
    onError: setErr,
  })

  return (
    <Modal open onClose={onClose} title="مصروف جديد"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => { setErr(null); save.mutate() }}>{save.isPending ? 'جارٍ الحفظ…' : needsApproval ? 'إرسال للمالك للموافقة' : 'حفظ'}</Button></>}>
      <div className="space-y-3">
        <ErrorText error={err} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="البند *">
            <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="">— اختر —</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="المبلغ (جنيه) *"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="البيان *" className="sm:col-span-2"><input className={inputCls} dir="auto" placeholder="مثال: فاتورة كهرباء أكتوبر" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="المستفيد"><input className={inputCls} dir="auto" value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} /></Field>
          <Field label="رقم الفاتورة / المرجع"><input className={inputCls} dir="ltr" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
          <Field label="تاريخ المصروف"><input type="date" className={inputCls} dir="ltr" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="تاريخ الاستحقاق"><input type="date" className={inputCls} dir="ltr" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
          <Field label="ملاحظات" className="sm:col-span-2"><input className={inputCls} dir="auto" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        {needsApproval && <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">المصروفات من {formatEGP(thr * 100)} فأكثر تحتاج موافقة المالك قبل السداد.</p>}
      </div>
    </Modal>
  )
}

function ExpenseDialog({ ex, canPay, onClose }: { ex: Exp; canPay: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const session = useOpenSession()
  const rem = toMinor(ex.remaining)
  const [amount, setAmount] = useState(rem > 0 ? fromMinor(rem) : '')
  const [method, setMethod] = useState<Method>('cash')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<unknown>(null)

  const pays = useQuery({
    queryKey: ['expense-payments', ex.id, ex.paid],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_payments').select('id,amount,method,paid_at,note').eq('expense_id', ex.id).order('paid_at')
      if (error) throw error
      return data as { id: string; amount: string; method: Method; paid_at: string; note: string | null }[]
    },
  })

  const pay = useMutation({
    mutationFn: async () => {
      let a = 0
      try { a = toMinor(amount) } catch { a = 0 }
      if (a <= 0) throw new Error('أدخل مبلغًا صحيحًا.')
      const { error } = await supabase.rpc('pay_expense', { p_expense: ex.id, p_amount: Number(fromMinor(a)), p_method: method, p_note: note || null })
      if (error) throw error
    },
    onSuccess: () => { ['expenses', 'cash', 'expense-payments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose() },
    onError: setErr,
  })
  const s = state(ex)

  return (
    <Modal open onClose={onClose} title={ex.description} footer={<Button onClick={onClose}>إغلاق</Button>}>
      <div className="space-y-4 text-sm">
        <ErrorText error={err} />
        <div className="flex flex-wrap items-center gap-2"><Chip tone={s.tone}>{s.label}</Chip><span className="text-muted">{ex.category_name} · {ex.expense_date}</span></div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">المبلغ</p><p className="font-bold">{formatEGP(toMinor(ex.amount))}</p></div>
          <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">المدفوع</p><p className="font-bold">{formatEGP(toMinor(ex.paid))}</p></div>
          <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">المتبقي</p><p className="font-bold">{formatEGP(rem)}</p></div>
        </div>
        {(ex.beneficiary || ex.invoice_ref || ex.due_date) && <p className="text-muted" dir="auto">{[ex.beneficiary, ex.invoice_ref && `مرجع ${ex.invoice_ref}`, ex.due_date && `استحقاق ${ex.due_date}`].filter(Boolean).join(' · ')}</p>}
        {ex.notes && <p className="text-muted" dir="auto">{ex.notes}</p>}

        {pays.data && pays.data.length > 0 && (
          <div><h3 className="mb-1 font-semibold">الدفعات</h3>
            <ul className="space-y-1">{pays.data.map((p) => <li key={p.id} className="flex justify-between"><span className="text-muted">{formatCairo(p.paid_at)} · {METHOD_AR[p.method]}{p.note ? ` · ${p.note}` : ''}</span><span>{formatEGP(toMinor(p.amount))}</span></li>)}</ul>
          </div>
        )}

        {canPay && ex.status === 'open' && rem > 0 && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <h3 className="font-semibold">تسجيل دفعة</h3>
            {method === 'cash' && !session.isLoading && !session.data && <p role="alert" className="text-warn">الدرج مغلق. افتحه من <Link to="/cash" className="underline">صفحة الدرج</Link> أو اختر طريقة أخرى.</p>}
            <div className="flex flex-wrap gap-2">
              <input aria-label="المبلغ" className={`${inputCls} !w-36`} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <select aria-label="طريقة الدفع" className={`${inputCls} !w-36`} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                {Object.entries(METHOD_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input aria-label="ملاحظة" className={`${inputCls} min-w-0 flex-1`} placeholder="ملاحظة (اختياري)" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button variant="primary" disabled={pay.isPending} onClick={() => { setErr(null); pay.mutate() }}>{pay.isPending ? '…' : 'دفع'}</Button>
            </div>
          </div>
        )}
        {ex.status === 'pending_approval' && <p className="text-muted">لا يمكن السداد قبل موافقة المالك.</p>}
      </div>
    </Modal>
  )
}
