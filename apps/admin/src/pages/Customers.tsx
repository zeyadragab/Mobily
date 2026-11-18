import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { State } from '../components/State'
import SourcePicker from '../components/SourcePicker'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { CUSTOMER_CATEGORY, LEDGER_KIND, matchCustomer, useCustomers, type Customer, type CustomerCategory, type LedgerRow } from '../lib/customers'
import { METHOD_AR, type Method } from '../lib/data'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'

const PAGE = 40

export default function Customers() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'manager', 'cashier')
  const q = useCustomers()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'debt' | 'stopped'>('all')
  const [sort, setSort] = useState<'name' | 'debt' | 'new'>('name')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const all = useMemo(() => q.data ?? [], [q.data])
  const rows = useMemo(() => {
    const out = all.filter((c) => matchCustomer(c, search) && (filter === 'all' ? true : filter === 'debt' ? c.balance > 0 : !c.is_active))
    if (sort === 'debt') out.sort((a, b) => b.balance - a.balance)
    else if (sort === 'new') out.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return out
  }, [all, search, filter, sort])
  const shown = rows.slice(page * PAGE, (page + 1) * PAGE)
  const totalDebt = all.reduce((s, c) => s + Math.max(c.balance, 0), 0)
  const opened = all.find((c) => c.id === openId)

  return (
    <div>
      <PageHeader title="العملاء" subtitle="سجل العملاء، حدود الآجل، كشف الحساب وتحصيل الديون."
        actions={<>
          <Button disabled={rows.length === 0} onClick={() => downloadCsv('customers.csv', ['الكود', 'الاسم', 'الهاتف', 'الفئة', 'حد الآجل', 'الرصيد المستحق'],
            rows.map((c) => [c.code, c.name, c.phone, CUSTOMER_CATEGORY[c.category], c.credit_limit, fromMinor(c.balance)]))}>تصدير CSV</Button>
          {canEdit && <Button variant="primary" onClick={() => setEditing('new')}>+ عميل جديد</Button>}
        </>} />

      <div className="stagger mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">عدد العملاء</p><p className="mt-1 text-2xl font-bold">{all.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">إجمالي الديون على العملاء</p><p className="mt-1 text-2xl font-bold text-danger">{formatEGP(totalDebt)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">عملاء عليهم ديون</p><p className="mt-1 text-2xl font-bold">{all.filter((c) => c.balance > 0).length}</p></Card>
      </div>

      <Card className="mb-4 grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr]">
        <Field label="بحث"><input className={inputCls} placeholder="الاسم، رقم الهاتف أو كود العميل" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }} /></Field>
        <Field label="عرض"><select className={inputCls} value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(0) }}>
          <option value="all">كل العملاء</option><option value="debt">عليهم ديون</option><option value="stopped">موقوفون</option>
        </select></Field>
        <Field label="ترتيب"><select className={inputCls} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="name">الاسم</option><option value="debt">الأعلى دينًا</option><option value="new">الأحدث</option>
        </select></Field>
      </Card>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل العملاء. تأكد من تطبيق آخر تحديث لقاعدة البيانات." action={<Button onClick={() => void q.refetch()}>حاول تاني</Button>} />}
      {q.isSuccess && rows.length === 0 && <State kind="empty" title={all.length ? 'مفيش عملاء مطابقين للبحث' : 'لسه مفيش عملاء'}
        text={all.length ? undefined : 'أضف أول عميل عشان تقدر تبيع له بالآجل وتتابع حسابه.'}
        action={canEdit && !all.length ? <Button variant="primary" onClick={() => setEditing('new')}>+ عميل جديد</Button> : undefined} />}
      {shown.length > 0 && <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['العميل', 'الهاتف', 'الفئة', 'حد الآجل', 'المستحق عليه', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{shown.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-0">
              <td className="p-3"><p className="font-medium" dir="auto">{c.name}</p><bdi className="text-xs text-muted">{c.code}</bdi>{!c.is_active && <span className="ms-2"><Chip tone="warn">موقوف</Chip></span>}</td>
              <td className="p-3"><bdi>{c.phone}</bdi></td>
              <td className="p-3"><Chip tone={c.category === 'vip' ? 'info' : 'neutral'}>{CUSTOMER_CATEGORY[c.category]}</Chip></td>
              <td className="p-3">{Number(c.credit_limit) > 0 ? formatEGP(toMinor(c.credit_limit)) : <span className="text-muted">بدون آجل</span>}</td>
              <td className={`whitespace-nowrap p-3 font-semibold ${c.balance > 0 ? 'text-danger' : ''}`}>{formatEGP(c.balance)}</td>
              <td className="p-3 text-end"><Button small onClick={() => setOpenId(c.id)}>فتح الحساب</Button></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>}
      {rows.length > PAGE && <div className="mt-4 flex items-center justify-end gap-3 text-sm">
        <Button small disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</Button>
        <span>صفحة {page + 1} من {Math.ceil(rows.length / PAGE)}</span>
        <Button small disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>التالي</Button>
      </div>}

      {editing && <CustomerForm customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {opened && !editing && <CustomerAccount customer={opened} onClose={() => setOpenId(null)} onEdit={() => setEditing(opened)} />}
    </div>
  )
}

export function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const [f, setF] = useState({
    name: customer?.name ?? '', phone: customer?.phone ?? '', phone2: customer?.phone2 ?? '',
    category: (customer?.category ?? 'regular') as CustomerCategory, limit: customer ? String(customer.credit_limit) : '0',
    notes: customer?.notes ?? '', active: customer?.is_active ?? true,
  })
  const save = useMutation({
    mutationFn: async () => {
      if (f.name.trim().length < 2) throw new Error('اكتب اسم العميل.')
      if (!/^\+?[0-9\s-]{7,18}$/.test(f.phone.trim())) throw new Error('رقم الهاتف غير صحيح.')
      const { data, error } = await supabase.rpc('save_customer', {
        p_id: customer?.id ?? null, p_name: f.name, p_phone: f.phone, p_phone2: f.phone2 || null, p_category: f.category,
        p_credit_limit: boss ? Number(fromMinor(toMinor(f.limit || '0'))) : null, p_notes: f.notes || null, p_active: f.active,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['customers'] }); onSaved?.(id); onClose() },
  })
  return (
    <Modal open onClose={onClose} title={customer ? 'تعديل بيانات العميل' : 'عميل جديد'}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="اسم العميل" className="sm:col-span-2"><input className={inputCls} dir="auto" autoFocus maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="رقم الهاتف"><input className={inputCls} dir="ltr" inputMode="tel" maxLength={18} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="هاتف آخر (اختياري)"><input className={inputCls} dir="ltr" inputMode="tel" maxLength={18} value={f.phone2} onChange={(e) => setF({ ...f, phone2: e.target.value })} /></Field>
        <Field label="الفئة"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as CustomerCategory })}>
          {Object.entries(CUSTOMER_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></Field>
        <Field label="حد الآجل (جنيه)" hint={boss ? 'صفر = ممنوع البيع له بالآجل' : 'يحدده المدير أو المالك فقط'}>
          <input className={inputCls} dir="ltr" inputMode="decimal" disabled={!boss} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
        </Field>
        <Field label="ملاحظات" className="sm:col-span-2"><textarea className={inputCls} rows={2} dir="auto" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {customer && boss && <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> العميل نشط (الموقوف لا يُباع له بالآجل)
        </label>}
      </div>
    </Modal>
  )
}

function CustomerAccount({ customer, onClose, onEdit }: { customer: Customer; onClose: () => void; onEdit: () => void }) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const canCollect = hasRole('owner', 'manager', 'cashier')
  const canKyc = hasRole('owner', 'manager', 'accountant')
  const [tab, setTab] = useState<'ledger' | 'kyc'>('ledger')
  const [act, setAct] = useState<'collect' | 'debt' | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [note, setNote] = useState('')
  const [idem, setIdem] = useState(() => crypto.randomUUID())
  const [src, setSrc] = useState({ drawer: '', account: '' })
  const [reverse, setReverse] = useState<LedgerRow | null>(null)
  const [reason, setReason] = useState('')

  const ledger = useQuery({
    queryKey: ['customers', 'ledger', customer.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('customer_ledger').select('id,customer_id,amount,kind,method,note,ref_type,reverses,created_at')
        .eq('customer_id', customer.id).order('id', { ascending: false }).limit(500)
      if (error) throw error
      return data as LedgerRow[]
    },
  })
  const reversed = new Set((ledger.data ?? []).map((r) => r.reverses).filter(Boolean))
  const refresh = () => { ['customers', 'drawers', 'accounts'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] })) }

  const submit = useMutation({
    mutationFn: async () => {
      let minor: number
      try { minor = toMinor(amount) } catch { throw new Error('المبلغ غير صحيح.') }
      if (minor <= 0) throw new Error('المبلغ غير صحيح.')
      const { error } = act === 'collect'
        ? await supabase.rpc('collect_customer_debt', { p_customer: customer.id, p_amount: Number(fromMinor(minor)), p_method: method, p_note: note || null, p_idem: idem,
            p_drawer: method === 'cash' ? src.drawer || 'products' : null, p_account: method !== 'cash' ? src.account || null : null })
        : await supabase.rpc('add_customer_debt', { p_customer: customer.id, p_amount: Number(fromMinor(minor)), p_note: note, p_idem: idem })
      if (error) throw error
    },
    onSuccess: () => { refresh(); setAct(null); setAmount(''); setNote(''); setIdem(crypto.randomUUID()) },
  })
  const undo = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('reverse_customer_entry', { p_id: reverse!.id, p_reason: reason })
      if (error) throw error
    },
    onSuccess: () => { refresh(); setReverse(null); setReason('') },
  })

  return (
    <Modal open wide onClose={onClose} title={`حساب العميل · ${customer.name}`}
      footer={<><Button className="me-auto" onClick={onEdit}>تعديل البيانات</Button><Button onClick={onClose}>إغلاق</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">المستحق عليه</p><p className={`text-xl font-bold ${customer.balance > 0 ? 'text-danger' : 'text-ok'}`}>{formatEGP(customer.balance)}</p></div>
          <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">حد الآجل</p><p className="text-xl font-bold">{formatEGP(toMinor(customer.credit_limit))}</p></div>
          <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">الهاتف</p><p className="text-xl font-bold"><bdi>{customer.phone}</bdi></p></div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canCollect && <Button variant="primary" disabled={customer.balance <= 0} onClick={() => { setAct('collect'); setAmount(fromMinor(Math.max(customer.balance, 0))); submit.reset() }}>تحصيل دفعة</Button>}
          {boss && <Button onClick={() => { setAct('debt'); setAmount(''); submit.reset() }}>إضافة دين / رصيد افتتاحي</Button>}
          <Button disabled={!ledger.data?.length} onClick={() => downloadCsv(`statement-${customer.code}.csv`, ['الرقم', 'التاريخ', 'النوع', 'المبلغ', 'طريقة الدفع', 'ملاحظات'],
            (ledger.data ?? []).map((r) => [r.id, formatCairo(r.created_at), LEDGER_KIND[r.kind], r.amount, r.method ? METHOD_AR[r.method as Method] : '', r.note]))}>تصدير كشف الحساب</Button>
        </div>

        {act && <Card className="animate-rise space-y-3 p-4">
          <h3 className="font-semibold">{act === 'collect' ? 'تحصيل دفعة من العميل' : 'إضافة دين على العميل'}</h3>
          <ErrorText error={submit.error} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="المبلغ (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            {act === 'collect' && <Field label="طريقة الدفع" hint={method === 'cash' ? 'النقدي يحتاج وردية مفتوحة' : undefined}>
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as Method)}>{Object.entries(METHOD_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Field>}
            {act === 'collect' && <SourcePicker method={method} drawer={src.drawer} account={src.account} onDrawer={(d) => setSrc({ ...src, drawer: d })} onAccount={(a) => setSrc({ ...src, account: a })} />}
            <Field label={act === 'debt' ? 'السبب (إلزامي)' : 'ملاحظة (اختياري)'} className={act === 'debt' ? 'sm:col-span-2' : ''}>
              <input className={inputCls} dir="auto" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAct(null)}>إلغاء</Button>
            <Button variant="primary" disabled={submit.isPending || (act === 'debt' && !note.trim())} onClick={() => submit.mutate()}>{submit.isPending ? 'جارٍ الحفظ…' : 'تأكيد'}</Button>
          </div>
        </Card>}

        <div role="tablist" className="flex gap-2">
          <button role="tab" aria-selected={tab === 'ledger'} onClick={() => setTab('ledger')} className={`rounded-[10px] px-4 py-1.5 text-sm font-medium transition ${tab === 'ledger' ? 'btn-gel' : 'bg-bg'}`}>كشف الحساب</button>
          {canKyc && <button role="tab" aria-selected={tab === 'kyc'} onClick={() => setTab('kyc')} className={`rounded-[10px] px-4 py-1.5 text-sm font-medium transition ${tab === 'kyc' ? 'btn-gel' : 'bg-bg'}`}>بيانات التحقق والضامن</button>}
        </div>

        {tab === 'ledger' && <>
          {ledger.isLoading && <State kind="loading" />}
          {ledger.isError && <State kind="error" text="تعذّر تحميل كشف الحساب." />}
          {ledger.data?.length === 0 && <p className="py-6 text-center text-sm text-muted">لا توجد حركات على حساب العميل بعد.</p>}
          {!!ledger.data?.length && <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-line text-muted">{['التاريخ', 'النوع', 'المبلغ', 'ملاحظات', ''].map((h, i) => <th key={i} scope="col" className="p-2.5 text-start font-medium">{h}</th>)}</tr></thead>
              <tbody>{ledger.data.map((r) => {
                const n = toMinor(r.amount)
                return <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap p-2.5">{formatCairo(r.created_at)}</td>
                  <td className="p-2.5"><Chip tone={n > 0 ? 'warn' : 'ok'}>{LEDGER_KIND[r.kind]}</Chip>{r.method && <span className="ms-1 text-xs text-muted">{METHOD_AR[r.method as Method]}</span>}</td>
                  <td className={`whitespace-nowrap p-2.5 font-semibold ${n > 0 ? 'text-danger' : 'text-ok'}`}>{n > 0 ? '+' : '−'} {formatEGP(Math.abs(n))}</td>
                  <td className="p-2.5 text-muted" dir="auto">{r.note}</td>
                  <td className="p-2.5 text-end">{boss && (r.kind === 'payment' || r.kind === 'manual_debt') && !reversed.has(r.id)
                    ? <Button small variant="danger" onClick={() => { setReverse(r); undo.reset() }}>إلغاء القيد</Button>
                    : reversed.has(r.id) ? <Chip>ملغى</Chip> : null}</td>
                </tr>
              })}</tbody>
            </table>
          </div>}
        </>}
        {tab === 'kyc' && <Kyc customerId={customer.id} canSave={boss} />}
      </div>

      {reverse && <Modal open onClose={() => setReverse(null)} title="إلغاء القيد بقيد عكسي"
        footer={<><Button onClick={() => setReverse(null)}>رجوع</Button><Button variant="danger" disabled={undo.isPending || !reason.trim()} onClick={() => undo.mutate()}>تأكيد الإلغاء</Button></>}>
        <div className="space-y-3 text-sm">
          <ErrorText error={undo.error} />
          <p>سيُسجَّل قيد عكسي بمبلغ <b>{formatEGP(Math.abs(toMinor(reverse.amount)))}</b>. القيد الأصلي يبقى ظاهرًا في السجل. {reverse.kind === 'payment' && 'المبلغ يخرج من نفس الدرج أو الحساب الذي دخل فيه.'}</p>
          <Field label="سبب الإلغاء (إلزامي)"><input className={inputCls} dir="auto" autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>}
    </Modal>
  )
}

function Kyc({ customerId, canSave }: { customerId: string; canSave: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['customers', 'kyc', customerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('customer_kyc').select('national_id,address,guarantor_name,guarantor_phone,guarantor_national_id').eq('customer_id', customerId).maybeSingle()
      if (error) throw error
      return data
    },
  })
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const f = draft ?? {
    national_id: q.data?.national_id ?? '', address: q.data?.address ?? '', guarantor_name: q.data?.guarantor_name ?? '',
    guarantor_phone: q.data?.guarantor_phone ?? '', guarantor_national_id: q.data?.guarantor_national_id ?? '',
  }
  const set = (k: string, v: string) => setDraft({ ...f, [k]: v })
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('save_customer_kyc', {
        p_customer: customerId, p_national_id: f.national_id || null, p_address: f.address || null,
        p_guarantor_name: f.guarantor_name || null, p_guarantor_phone: f.guarantor_phone || null, p_guarantor_national_id: f.guarantor_national_id || null,
      })
      if (error) throw error
    },
    onSuccess: () => { setDraft(null); void qc.invalidateQueries({ queryKey: ['customers', 'kyc', customerId] }) },
  })
  if (q.isLoading) return <State kind="loading" />
  if (q.isError) return <State kind="error" text="تعذّر تحميل بيانات التحقق." />
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <p className="rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-xs text-info sm:col-span-2">بيانات حساسة: تظهر للمالك والمدير والمحاسب فقط، وكل تعديل يُسجَّل في سجل العمليات.</p>
      <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
      <Field label="الرقم القومي (14 رقم)"><input className={inputCls} dir="ltr" inputMode="numeric" maxLength={14} disabled={!canSave} value={f.national_id} onChange={(e) => set('national_id', e.target.value.replace(/\D/g, ''))} /></Field>
      <Field label="العنوان"><input className={inputCls} dir="auto" maxLength={200} disabled={!canSave} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
      <Field label="اسم الضامن"><input className={inputCls} dir="auto" maxLength={120} disabled={!canSave} value={f.guarantor_name} onChange={(e) => set('guarantor_name', e.target.value)} /></Field>
      <Field label="هاتف الضامن"><input className={inputCls} dir="ltr" inputMode="tel" maxLength={18} disabled={!canSave} value={f.guarantor_phone} onChange={(e) => set('guarantor_phone', e.target.value)} /></Field>
      <Field label="الرقم القومي للضامن"><input className={inputCls} dir="ltr" inputMode="numeric" maxLength={14} disabled={!canSave} value={f.guarantor_national_id} onChange={(e) => set('guarantor_national_id', e.target.value.replace(/\D/g, ''))} /></Field>
      {canSave && <div className="flex items-end justify-end"><Button variant="primary" disabled={save.isPending || !draft} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ بيانات التحقق'}</Button></div>}
    </div>
  )
}
