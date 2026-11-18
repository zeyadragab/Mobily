import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import ApproverPin from '../components/ApproverPin'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { CancelDialog, Kpi, NoShiftHint } from '../components/WalletBits'
import { useAccounts } from '../lib/accounts'
import { useOpenSession } from '../lib/data'
import { newKey, useDrawerBalances } from '../lib/drawers'
import { money } from '../lib/installments'
import { formatEGP, toMinor } from '../lib/money'
import { LEDGER_KIND, useEmployeeLedger, useEmployees, useTeam, type EmployeeRow } from '../lib/people'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, formatCairo } from '../lib/time'

const m = (v: number | string) => formatEGP(toMinor(v))
const OPS = { pay: 'صرف راتب', advance: 'سلفة', bonus: 'مكافأة', deduction: 'خصم', correction: 'تصحيح (بالموجب أو السالب)' } as const
type Op = keyof typeof OPS

/** Employee accounts (R33): what the shop owes each employee. Not an expense: paying a salary moves money out of a drawer and clears the balance. */
export default function EmployeeAccounts() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const employees = useEmployees()
  const session = useOpenSession()
  const [edit, setEdit] = useState<EmployeeRow | 'new' | null>(null)
  const [op, setOp] = useState<EmployeeRow | null>(null)
  const [statement, setStatement] = useState<EmployeeRow | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['employees'] }), qc.invalidateQueries({ queryKey: ['employee-ledger'] }), qc.invalidateQueries({ queryKey: ['drawers'] }),
  ])
  const accrue = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc('run_salary_accruals'); if (error) throw error; return data as number },
    onSuccess: refresh,
  })

  const rows = (employees.data ?? []).filter((e) => showInactive || e.is_active)
  const owed = rows.reduce((s, e) => s + Math.max(0, toMinor(e.balance)), 0)
  const advanced = rows.reduce((s, e) => s + Math.max(0, -toMinor(e.balance)), 0)
  const payroll = rows.filter((e) => e.is_active).reduce((s, e) => s + toMinor(e.monthly_salary), 0)

  return (
    <div>
      <PageHeader title="حسابات الموظفين" subtitle="الراتب بيتسجل مستحق في يوم الراتب كل شهر، والصرف بيخصم من الدرج وينزّل المستحق. السلفة بتنزل الرصيد تحت الصفر."
        actions={<>
          <Button onClick={() => downloadCsv('employee-accounts.csv', ['الموظف', 'الوظيفة', 'الراتب', 'يوم الراتب', 'الرصيد', 'نشط'],
            rows.map((e) => [e.name, e.job_title, e.monthly_salary, e.pay_day, e.balance, e.is_active ? 'نعم' : 'لا']))}>تصدير CSV</Button>
          {boss && <Button disabled={accrue.isPending} onClick={() => accrue.mutate()}>{accrue.isPending ? 'جارٍ الحساب…' : 'احسب المستحقات'}</Button>}
          {boss && <Button variant="primary" onClick={() => setEdit('new')}>موظف جديد</Button>}
        </>} />
      {session.isSuccess && !session.data && boss && <NoShiftHint />}
      <ErrorText error={accrue.error} />
      {accrue.isSuccess && <p className="mb-3 text-sm text-muted" role="status">{accrue.data ? `تمت إضافة ${accrue.data} مستحق جديد.` : 'كل المستحقات محسوبة بالفعل.'}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="مستحق للموظفين" value={formatEGP(owed)} tone={owed ? 'warn' : undefined} />
        <Kpi label="سلف على الموظفين" value={formatEGP(advanced)} tone={advanced ? 'danger' : undefined} />
        <Kpi label="رواتب شهرية (النشطين)" value={formatEGP(payroll)} />
        <Kpi label="عدد الموظفين" value={String(rows.length)} />
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> إظهار غير النشطين
      </label>

      {employees.isLoading && <State kind="loading" />}
      {employees.isError && <State kind="error" text="تعذّر تحميل الموظفين." action={<Button onClick={() => void employees.refetch()}>حاول تاني</Button>} />}
      {employees.isSuccess && rows.length === 0 && <State kind="empty" title="لا يوجد موظفون" text="أضف أول موظف بزر «موظف جديد»." />}
      {rows.length > 0 && <Card className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['الموظف', 'الراتب', 'يوم الراتب', 'آخر استحقاق', 'الرصيد', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((e) => {
          const b = toMinor(e.balance)
          return <tr key={e.id} className="border-b border-line last:border-0">
            <td className="p-3"><p dir="auto" className="font-medium">{e.name}{!e.is_active && <span className="ms-2"><Chip>غير نشط</Chip></span>}</p>
              <p className="text-xs text-muted" dir="auto">{e.job_title}{e.phone && <> · <bdi>{e.phone}</bdi></>}</p></td>
            <td className="p-3">{m(e.monthly_salary)}</td><td className="p-3">{e.pay_day}</td><td className="p-3"><bdi>{e.last_period ?? '—'}</bdi></td>
            <td className="p-3">{b > 0 ? <Chip tone="warn">له {formatEGP(b)}</Chip> : b < 0 ? <Chip tone="danger">عليه {formatEGP(-b)}</Chip> : <Chip tone="ok">صفر</Chip>}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2">
              <Button small onClick={() => setStatement(e)}>كشف حساب</Button>
              {boss && e.is_active && <Button small variant="primary" onClick={() => setOp(e)}>عملية</Button>}
              {boss && <Button small onClick={() => setEdit(e)}>تعديل</Button>}
            </div></td>
          </tr>
        })}</tbody>
      </table></Card>}

      {edit && <EmployeeForm employee={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await refresh() }} />}
      {op && <OperationDialog employee={op} onClose={() => setOp(null)} onDone={async () => { setOp(null); await refresh() }} />}
      {statement && <Statement employee={statement} onClose={() => setStatement(null)} onChanged={refresh} />}
    </div>
  )
}

function EmployeeForm({ employee, onClose, onDone }: { employee: EmployeeRow | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(employee?.name ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [title, setTitle] = useState(employee?.job_title ?? '')
  const [salary, setSalary] = useState(employee ? String(employee.monthly_salary) : '')
  const [payDay, setPayDay] = useState(String(employee?.pay_day ?? 1))
  const [start, setStart] = useState(employee?.start_date ?? cairoBusinessDate())
  const [profile, setProfile] = useState(employee?.profile_id ?? '')
  const [active, setActive] = useState(employee?.is_active ?? true)
  const team = useTeam()
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('save_employee_account', {
        p_id: employee?.id ?? null, p_name: name.trim(), p_phone: phone.trim() || null, p_job_title: title.trim() || null,
        p_monthly_salary: money(salary, { zero: true }), p_pay_day: Number(payDay), p_start_date: start, p_profile: profile || null, p_active: active,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title={employee ? 'تعديل موظف' : 'موظف جديد'}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="الاسم"><input className={inputCls} dir="auto" maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="الوظيفة"><input className={inputCls} dir="auto" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="الموبايل"><input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="الراتب الشهري"><input className={inputCls} dir="ltr" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} /></Field>
        <Field label="يوم الراتب (1 إلى 28)"><input className={inputCls} dir="ltr" inputMode="numeric" value={payDay} onChange={(e) => setPayDay(e.target.value)} /></Field>
        <Field label="تاريخ بداية العمل" hint="المستحقات بتتحسب من هنا لحد النهارده."><input className={inputCls} type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="حساب الدخول (اختياري)" hint="لو ربطته، الموظف يسجّل حضوره بنفسه ويشوف حسابه." className="sm:col-span-2">
          <select className={inputCls} value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">بدون ربط</option>
            {(team.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.full_name}{t.email ? ` · ${t.email}` : ''}</option>)}
          </select>
        </Field>
        {employee && <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> موظف نشط (يستحق راتبًا)</label>}
      </div>
    </Modal>
  )
}

function OperationDialog({ employee, onClose, onDone }: { employee: EmployeeRow; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Op>('pay')
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('d:products')
  const [note, setNote] = useState('')
  const [key] = useState(newKey)
  const [pin, setPin] = useState(false)
  const drawers = useDrawerBalances()
  const accounts = useAccounts()
  const run = useMutation({
    mutationFn: async (token?: string) => {
      const money_ = kind === 'pay' || kind === 'advance'
      let amt: number
      if (kind === 'correction') {
        const t = amount.trim()
        const neg = t.startsWith('-')
        const v = money(neg ? t.slice(1) : t)
        amt = neg ? -v : v
      } else amt = money(amount)
      const { error } = await supabase.rpc('employee_operation', {
        p_employee: employee.id, p_kind: kind, p_amount: amt,
        p_drawer: money_ && source.startsWith('d:') ? source.slice(2) : null,
        p_account: money_ && source.startsWith('a:') ? source.slice(2) : null,
        p_note: note.trim() || null, p_idem: key, p_override: token ?? null,
      })
      if (error) throw error
    },
    onSuccess: onDone,
    onError: (e) => { if (/override required/i.test(e instanceof Error ? e.message : (e as { message?: string }).message ?? '')) setPin(true) },
  })
  const cash = kind === 'pay' || kind === 'advance'
  const hideErr = pin ? null : run.error
  return (
    <Modal open onClose={onClose} title={`عملية على ${employee.name}`}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending ? 'جارٍ التنفيذ…' : 'تنفيذ'}</Button></>}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <p className="text-muted sm:col-span-2">الرصيد الحالي: <b className="text-fg">{m(employee.balance)}</b> · الراتب {m(employee.monthly_salary)}</p>
        <div className="sm:col-span-2"><ErrorText error={hideErr} /></div>
        <Field label="نوع العملية">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Op)}>
            {(Object.keys(OPS) as Op[]).map((k) => <option key={k} value={k}>{OPS[k]}</option>)}
          </select>
        </Field>
        <Field label="المبلغ"><input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {cash && <Field label="الفلوس بتطلع من" className="sm:col-span-2">
          <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
            {(drawers.data ?? []).map((d) => <option key={d.id} value={`d:${d.code}`}>{d.name} · {formatEGP(toMinor(d.balance))}</option>)}
            {(accounts.data ?? []).filter((a) => a.is_active).map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name} · {formatEGP(toMinor(a.balance))}</option>)}
          </select>
        </Field>}
        <Field label={kind === 'correction' ? 'السبب (إلزامي)' : 'ملاحظة'} className="sm:col-span-2"><input className={inputCls} dir="auto" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {cash && <p className="text-xs text-muted sm:col-span-2">محتاج وردية مفتوحة. المدير يحتاج رقم سري لمدير آخر عند المبالغ الكبيرة، والمالك لا.</p>}
      </div>
      <ApproverPin open={pin} onClose={() => setPin(false)} reason={`${OPS[kind]} ${employee.name} ${amount}`} onToken={(t) => { setPin(false); run.mutate(t) }} />
    </Modal>
  )
}

function Statement({ employee, onClose, onChanged }: { employee: EmployeeRow; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const { hasRole } = useAuth()
  const ledger = useEmployeeLedger(employee.id)
  const [rev, setRev] = useState<number | null>(null)
  const rows = ledger.data ?? []
  const reversed = new Set(rows.filter((r) => r.reverses != null).map((r) => r.reverses))
  return (
    <Modal open wide onClose={onClose} title={`كشف حساب ${employee.name}`}
      footer={<>
        <Button onClick={() => downloadCsv(`employee-${employee.name}.csv`, ['التاريخ', 'النوع', 'الفترة', 'المبلغ', 'ملاحظة'],
          rows.map((r) => [r.created_at, LEDGER_KIND[r.kind], r.period, r.amount, r.note]))}>تصدير CSV</Button>
        <Button onClick={onClose}>إغلاق</Button></>}>
      <p className="mb-3 text-sm text-muted">الرصيد: <b className="text-fg">{m(employee.balance)}</b> (الموجب = المحل مدين للموظف)</p>
      {ledger.isLoading && <State kind="loading" />}
      {ledger.isError && <State kind="error" text="تعذّر تحميل الكشف." />}
      {ledger.isSuccess && rows.length === 0 && <State kind="empty" title="لا توجد حركات" />}
      {rows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['التاريخ', 'النوع', 'المبلغ', 'ملاحظة', ''].map((h, i) => <th key={i} scope="col" className="p-2 text-start font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-line last:border-0">
          <td className="p-2">{formatCairo(r.created_at)}</td>
          <td className="p-2">{LEDGER_KIND[r.kind]}{r.period && <bdi className="ms-1 text-xs text-muted">{r.period}</bdi>}{r.reverses != null && <span className="ms-1"><Chip>عكس</Chip></span>}{reversed.has(r.id) && <span className="ms-1"><Chip tone="danger">معكوس</Chip></span>}</td>
          <td className="p-2" dir="ltr">{toMinor(r.amount) > 0 ? '+' : ''}{m(r.amount)}</td>
          <td className="p-2" dir="auto">{r.note}</td>
          <td className="p-2">{hasRole('owner') && r.reverses == null && !reversed.has(r.id) && r.kind !== 'accrual' && <Button small variant="danger" onClick={() => setRev(r.id)}>عكس</Button>}</td>
        </tr>)}</tbody>
      </table></div>}
      {rev != null && <CancelDialog title="عكس القيد" text="بيتعمل قيد عكسي. لو الصرف كان من درج أو حساب الفلوس بترجع له في الوردية الحالية."
        run={async (reason) => { const { error } = await supabase.rpc('reverse_employee_entry', { p_id: rev, p_reason: reason }); if (error) throw error }}
        onClose={() => setRev(null)} onDone={async () => { setRev(null); await onChanged() }} />}
    </Modal>
  )
}
