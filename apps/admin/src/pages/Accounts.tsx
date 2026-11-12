import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import ApproverPin from '../components/ApproverPin'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { ACCOUNT_KIND, CONTROL_KIND, useAccounts, type AccountKind, type ControlRow, type MoneyAccount, type ShiftAlert } from '../lib/accounts'
import { DRAWER_HINT, useDrawerBalances, type DrawerCode } from '../lib/drawers'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'

type Dlg =
  | { type: 'account'; acc: MoneyAccount | null }
  | { type: 'balance'; acc: MoneyAccount }
  | { type: 'transfer' }
  | { type: 'cash' }
  | { type: 'review'; alert: ShiftAlert }
  | null

const money = (v: number | string | null) => formatEGP(toMinor(v ?? 0))
const amountOf = (v: string, allowZero = false) => {
  let m: number
  try { m = toMinor(v.trim()) } catch { throw new Error('أدخل مبلغًا صحيحًا.') }
  if (m < 0 || (!allowZero && m === 0)) throw new Error('أدخل مبلغًا صحيحًا.')
  return Number(fromMinor(m))
}
const optional = (v: string) => (v.trim() ? amountOf(v) : null)

export default function Accounts() {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const canSeeLog = hasRole('owner', 'manager', 'accountant')
  const qc = useQueryClient()
  const accounts = useAccounts()
  const drawers = useDrawerBalances()
  const [dlg, setDlg] = useState<Dlg>(null)
  const [logScope, setLogScope] = useState<'all' | 'drawer' | 'account'>('all')

  const alerts = useQuery({
    queryKey: ['accounts', 'alerts'],
    enabled: canSeeLog,
    queryFn: async () => {
      const { data, error } = await supabase.from('shift_alerts').select('id,session_id,phase,drawer_code,difference,reviewed_at,review_note,created_at,cash_sessions(shift_no)')
        .is('reviewed_at', null).order('id', { ascending: false }).limit(50)
      if (error) throw error
      return data as unknown as ShiftAlert[]
    },
  })
  const log = useQuery({
    queryKey: ['accounts', 'log'],
    enabled: canSeeLog,
    queryFn: async () => {
      const { data, error } = await supabase.from('balance_control_log').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data as ControlRow[]
    },
  })
  const refresh = () => { ['accounts', 'drawers', 'cash'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] })) }
  const done = () => { refresh(); setDlg(null) }
  const list = accounts.data ?? []
  const total = list.filter((a) => a.is_active).reduce((s, a) => s + toMinor(a.balance), 0)
  const drawerName = (code: string) => code.startsWith('acct:')
    ? list.find((a) => a.id === code.slice(5))?.name ?? 'حساب'
    : drawers.data?.find((d) => d.code === code)?.name ?? code
  const logRows = (log.data ?? []).filter((r) => logScope === 'all' || r.scope === logScope)

  return (
    <div>
      <PageHeader title="الأرصدة والحسابات" subtitle="المحافظ الإلكترونية وماكينات الدفع، حركة النقدية في الأدراج، وتنبيهات فروق الورديات."
        actions={boss && <>
          <Button onClick={() => setDlg({ type: 'cash' })}>إضافة / سحب نقدية</Button>
          <Button disabled={list.filter((a) => a.is_active).length < 2} onClick={() => setDlg({ type: 'transfer' })}>تحويل بين الحسابات</Button>
          <Button variant="primary" onClick={() => setDlg({ type: 'account', acc: null })}>+ حساب جديد</Button>
        </>} />

      {!!alerts.data?.length && (
        <Card className="mb-4 animate-rise border-warn/40 bg-warn/10 p-4">
          <h2 className="mb-2 font-semibold text-warn">فروق عدّ تحتاج مراجعة ({alerts.data.length})</h2>
          <ul className="space-y-2 text-sm">
            {alerts.data.map((al) => {
              const d = toMinor(al.difference)
              return (
                <li key={al.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface/70 p-2.5">
                  <Chip tone={d < 0 ? 'danger' : 'info'}>{d < 0 ? 'عجز' : 'زيادة'} {formatEGP(Math.abs(d))}</Chip>
                  <span className="min-w-0 flex-1">{drawerName(al.drawer_code)} · {al.phase === 'open' ? 'عند فتح' : 'عند إغلاق'} الوردية <bdi>W-{String(al.cash_sessions?.shift_no ?? 0).padStart(4, '0')}</bdi> · <span className="text-muted">{formatCairo(al.created_at)}</span></span>
                  {boss && <Button small onClick={() => setDlg({ type: 'review', alert: al })}>تمت المراجعة</Button>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {accounts.isLoading && <State kind="loading" />}
      {accounts.isError && <State kind="error" text="تعذّر تحميل الحسابات. تأكد من تطبيق آخر تحديث لقاعدة البيانات." action={<Button onClick={() => void accounts.refetch()}>حاول تاني</Button>} />}
      {accounts.isSuccess && list.length === 0 && <State kind="empty" title="لسه مفيش محافظ أو ماكينات"
        text="أضف محفظة (مثل فودافون كاش) أو ماكينة دفع، وسجّل رصيدها الحالي، عشان تتابع كل حركة عليها."
        action={boss ? <Button variant="primary" onClick={() => setDlg({ type: 'account', acc: null })}>+ حساب جديد</Button> : undefined} />}

      {list.length > 0 && <>
        <p className="mb-2 text-sm text-muted">إجمالي أرصدة الحسابات النشطة: <b className="text-fg">{formatEGP(total)}</b></p>
        <div className="stagger mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <Card key={a.id} className={`p-4 transition hover:-translate-y-0.5 hover:shadow-float ${a.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold" dir="auto">{a.name}</p>
                  <p className="text-xs text-muted">{ACCOUNT_KIND[a.kind]}{a.number && <> · <bdi>{a.number}</bdi></>}</p>
                </div>
                {!a.is_active && <Chip tone="warn">موقوف</Chip>}
              </div>
              <p className="mt-3 text-2xl font-bold">{money(a.balance)}</p>
              <Limit label="المستخدم اليوم" used={a.used_today} limit={a.daily_limit} />
              <Limit label="المستخدم هذا الشهر" used={a.used_month} limit={a.monthly_limit} />
              {boss && <div className="mt-3 flex gap-2">
                <Button small onClick={() => setDlg({ type: 'balance', acc: a })}>ضبط الرصيد</Button>
                <Button small onClick={() => setDlg({ type: 'account', acc: a })}>تعديل</Button>
              </div>}
            </Card>
          ))}
        </div>
      </>}

      {canSeeLog && <>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-bold">سجل رقابة الأرصدة</h2>
          <div className="flex gap-2">
            <select aria-label="نوع الرصيد" className={`${inputCls} !w-40`} value={logScope} onChange={(e) => setLogScope(e.target.value as typeof logScope)}>
              <option value="all">الأدراج والحسابات</option><option value="drawer">الأدراج فقط</option><option value="account">الحسابات فقط</option>
            </select>
            <Button disabled={!logRows.length} onClick={() => downloadCsv('balance-control-log.csv', ['التاريخ', 'الرصيد', 'العملية', 'المبلغ', 'قبل', 'بعد', 'ملاحظات'],
              logRows.map((r) => [formatCairo(r.created_at), r.target, CONTROL_KIND[r.kind] ?? r.kind, r.amount, r.balance_before, r.balance_after, r.note]))}>تصدير CSV</Button>
          </div>
        </div>
        {log.isLoading && <State kind="loading" />}
        {log.isError && <State kind="error" text="تعذّر تحميل سجل الرقابة." />}
        {log.isSuccess && logRows.length === 0 && <Card className="p-6 text-center text-sm text-muted">لا توجد عمليات على الأرصدة بعد. يظهر هنا: عدّ الورديات، التحويلات، التصحيحات، وإضافة أو سحب النقدية.</Card>}
        {logRows.length > 0 && <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-line text-muted">{['التاريخ', 'الرصيد', 'العملية', 'المبلغ', 'قبل', 'بعد', 'ملاحظات'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{logRows.map((r) => {
              const n = toMinor(r.amount)
              return <tr key={r.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap p-3">{formatCairo(r.created_at)}</td>
                <td className="p-3" dir="auto">{r.target} <span className="text-xs text-muted">{r.scope === 'drawer' ? 'درج' : 'حساب'}</span></td>
                <td className="p-3"><Chip tone="info">{CONTROL_KIND[r.kind] ?? r.kind}</Chip></td>
                <td className={`whitespace-nowrap p-3 font-semibold ${n < 0 ? 'text-danger' : 'text-ok'}`}>{n < 0 ? '−' : '+'} {formatEGP(Math.abs(n))}</td>
                <td className="whitespace-nowrap p-3 text-muted">{money(r.balance_before)}</td>
                <td className="whitespace-nowrap p-3">{money(r.balance_after)}</td>
                <td className="p-3 text-muted" dir="auto">{r.note}</td>
              </tr>
            })}</tbody>
          </table>
        </Card>}
      </>}

      {dlg?.type === 'account' && <AccountForm acc={dlg.acc} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.type === 'balance' && <BalanceForm acc={dlg.acc} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.type === 'transfer' && <TransferForm accounts={list.filter((a) => a.is_active)} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.type === 'cash' && <CashMoveForm onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.type === 'review' && <ReviewForm alert={dlg.alert} onClose={() => setDlg(null)} onDone={done} />}
    </div>
  )
}

function Limit({ label, used, limit }: { label: string; used: number | string; limit: number | string | null }) {
  if (limit === null) return null
  const u = toMinor(used), l = toMinor(limit)
  const pct = Math.min(100, Math.round((u / l) * 100))
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-muted"><span>{label}</span><span>{formatEGP(u)} من {formatEGP(l)}</span></div>
      <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/20">
        <div className={`h-full rounded-full transition-all duration-500 ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

type FormProps = { onClose: () => void; onDone: () => void }
const needsPin = (e: unknown) => /override required/i.test((e as { message?: string })?.message ?? '')

function AccountForm({ acc, onClose, onDone }: FormProps & { acc: MoneyAccount | null }) {
  const [f, setF] = useState({
    kind: (acc?.kind ?? 'wallet') as AccountKind, name: acc?.name ?? '', number: acc?.number ?? '',
    daily: acc?.daily_limit != null ? String(acc.daily_limit) : '', monthly: acc?.monthly_limit != null ? String(acc.monthly_limit) : '',
    min: acc ? String(acc.min_balance) : '0', active: acc?.is_active ?? true,
  })
  const save = useMutation({
    mutationFn: async () => {
      if (f.name.trim().length < 2) throw new Error('اكتب اسم الحساب.')
      const { error } = await supabase.rpc('save_money_account', {
        p_id: acc?.id ?? null, p_kind: f.kind, p_name: f.name, p_number: f.number || null,
        p_daily_limit: optional(f.daily), p_monthly_limit: optional(f.monthly), p_min_balance: amountOf(f.min || '0', true), p_active: f.active,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title={acc ? 'تعديل الحساب' : 'حساب جديد'}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="النوع"><select className={inputCls} disabled={!!acc} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AccountKind })}>
          {Object.entries(ACCOUNT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></Field>
        <Field label="الاسم"><input className={inputCls} dir="auto" autoFocus maxLength={80} placeholder="مثال: فودافون كاش 1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="الرقم أو الكود (اختياري)" className="sm:col-span-2"><input className={inputCls} dir="ltr" maxLength={40} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label="الحد اليومي (جنيه)" hint="اتركه فارغًا إذا لا يوجد حد"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.daily} onChange={(e) => setF({ ...f, daily: e.target.value })} /></Field>
        <Field label="الحد الشهري (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></Field>
        <Field label="أقل رصيد مسموح (جنيه)" hint="لن تُقبل عملية تنزل بالرصيد تحته"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        {acc && <label className="flex items-center gap-2 self-end pb-2.5 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> الحساب نشط</label>}
      </div>
    </Modal>
  )
}

function BalanceForm({ acc, onClose, onDone }: FormProps & { acc: MoneyAccount }) {
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')
  const [idem] = useState(() => crypto.randomUUID())
  const [pin, setPin] = useState(false)
  const save = useMutation({
    mutationFn: async (token: string | null) => {
      const { error } = await supabase.rpc('adjust_account', { p_account: acc.id, p_target: amountOf(target, true), p_note: note, p_idem: idem, p_override: token })
      if (error) throw error
    },
    onSuccess: onDone,
    onError: (e) => { if (needsPin(e)) setPin(true) },
  })
  return (
    <Modal open onClose={onClose} title={`ضبط رصيد · ${acc.name}`}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending || !target.trim() || !note.trim()} onClick={() => save.mutate(null)}>تأكيد</Button></>}>
      <div className="space-y-3">
        {!needsPin(save.error) && <ErrorText error={save.error} />}
        <p className="text-sm text-muted">الرصيد المسجل الآن: <b className="text-fg">{money(acc.balance)}</b>. اكتب الرصيد الفعلي الظاهر في المحفظة أو الماكينة. الفرق يُسجَّل في سجل الرقابة.</p>
        <Field label="الرصيد الفعلي (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" autoFocus value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="السبب (إلزامي)"><input className={inputCls} dir="auto" maxLength={200} placeholder="مثال: رصيد افتتاحي" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <ApproverPin open={pin} onClose={() => setPin(false)} reason={`ضبط رصيد ${acc.name} إلى ${target}`} onToken={(t) => { setPin(false); save.mutate(t) }} />
    </Modal>
  )
}

function TransferForm({ accounts, onClose, onDone }: FormProps & { accounts: MoneyAccount[] }) {
  const [f, setF] = useState({ from: '', to: '', amount: '', note: '' })
  const [idem] = useState(() => crypto.randomUUID())
  const save = useMutation({
    mutationFn: async () => {
      if (!f.from || !f.to || f.from === f.to) throw new Error('اختر حسابين مختلفين.')
      const { error } = await supabase.rpc('transfer_account', { p_from: f.from, p_to: f.to, p_amount: amountOf(f.amount), p_note: f.note || null, p_idem: idem })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  const opt = (a: MoneyAccount) => <option key={a.id} value={a.id}>{a.name} · {money(a.balance)}</option>
  return (
    <Modal open onClose={onClose} title="تحويل بين الحسابات"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>تحويل</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="من حساب"><select className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}><option value="">اختر</option>{accounts.map(opt)}</select></Field>
        <Field label="إلى حساب"><select className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">اختر</option>{accounts.filter((a) => a.id !== f.from).map(opt)}</select></Field>
        <Field label="المبلغ (جنيه)" hint="يُحسب من الحد اليومي والشهري للحساب المحوَّل منه"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="ملاحظة (اختياري)"><input className={inputCls} dir="auto" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function CashMoveForm({ onClose, onDone }: FormProps) {
  const drawers = useDrawerBalances()
  const [f, setF] = useState({ drawer: '', type: 'add' as 'add' | 'withdraw', amount: '', note: '' })
  const [idem] = useState(() => crypto.randomUUID())
  const [pin, setPin] = useState(false)
  const save = useMutation({
    mutationFn: async (token: string | null) => {
      if (!f.drawer) throw new Error('اختر الدرج.')
      const { error } = await supabase.rpc('move_drawer_cash', { p_drawer: f.drawer, p_type: f.type, p_amount: amountOf(f.amount), p_note: f.note, p_idem: idem, p_override: token })
      if (error) throw error
    },
    onSuccess: onDone,
    onError: (e) => { if (needsPin(e)) setPin(true) },
  })
  const chosen = drawers.data?.find((d) => d.id === f.drawer)
  return (
    <Modal open onClose={onClose} title="إضافة أو سحب نقدية من درج"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending || !f.note.trim()} onClick={() => save.mutate(null)}>تأكيد</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">{!needsPin(save.error) && <ErrorText error={save.error} />}</div>
        <Field label="الدرج" hint={chosen ? DRAWER_HINT[chosen.code as DrawerCode] : 'يحتاج وردية مفتوحة'}>
          <select className={inputCls} value={f.drawer} onChange={(e) => setF({ ...f, drawer: e.target.value })}>
            <option value="">اختر</option>
            {(drawers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name} · {money(d.balance)}</option>)}
          </select>
        </Field>
        <Field label="العملية"><select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'add' | 'withdraw' })}>
          <option value="add">إضافة نقدية للدرج</option><option value="withdraw">سحب نقدية من الدرج</option>
        </select></Field>
        <Field label="المبلغ (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="السبب (إلزامي)"><input className={inputCls} dir="auto" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <ApproverPin open={pin} onClose={() => setPin(false)} reason={`${f.type === 'add' ? 'إضافة' : 'سحب'} ${f.amount} ${chosen?.name ?? ''}`} onToken={(t) => { setPin(false); save.mutate(t) }} />
    </Modal>
  )
}

function ReviewForm({ alert, onClose, onDone }: FormProps & { alert: ShiftAlert }) {
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('review_shift_alert', { p_id: alert.id, p_note: note })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title="مراجعة فرق العدّ"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending || !note.trim()} onClick={() => save.mutate()}>تأكيد المراجعة</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorText error={save.error} />
        <p>الفرق <b>{money(alert.difference)}</b> يبقى مسجلًا كما هو. المراجعة تعني أنك تحققت من السبب مع صاحب الوردية. لا يمكن لصاحب الوردية مراجعة فرقه بنفسه.</p>
        <Field label="نتيجة المراجعة (إلزامي)"><input className={inputCls} dir="auto" autoFocus maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
