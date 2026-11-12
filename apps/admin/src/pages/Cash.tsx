import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useOpenSession } from '../lib/data'
import {
  COUNTED, DRAWER_HINT, newKey, shiftLabel, useDrawerBalances, usePinThreshold, useShiftHistory,
  type DrawerBalance, type DrawerCode,
} from '../lib/drawers'
import { useAccounts } from '../lib/accounts'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'
import ApproverPin from '../components/ApproverPin'

type ModalKind = 'open' | 'close' | 'transfer' | 'adjust' | null

const money = (v: number | string) => formatEGP(toMinor(v))
function parse(v: string): number | null {
  if (v.trim() === '') return null
  try { const m = toMinor(v.trim()); return m < 0 ? NaN : m } catch { return NaN }
}
function countsPayload(vals: Record<string, string>) {
  const out: Record<string, number> = {}
  for (const c of COUNTED) {
    const m = parse(vals[c] ?? '')
    if (m === null) continue
    if (Number.isNaN(m)) throw new Error('أدخل أرقاماً صحيحة في العدّ.')
    out[c] = Number(fromMinor(m))
  }
  return out
}

export default function Cash() {
  const { hasRole } = useAuth()
  const canUse = hasRole('owner', 'manager', 'cashier')
  const canManage = hasRole('owner', 'manager')
  const isOwner = hasRole('owner')
  const qc = useQueryClient()
  const session = useOpenSession()
  const balances = useDrawerBalances()
  const history = useShiftHistory()
  const threshold = usePinThreshold()
  const accounts = useAccounts(canUse)
  const [avals, setAvals] = useState<Record<string, string>>({})
  const activeAccounts = (accounts.data ?? []).filter((a) => a.is_active)

  const [modal, setModal] = useState<ModalKind>(null)
  const [err, setErr] = useState<unknown>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [target, setTarget] = useState('')
  const [drawer, setDrawer] = useState('')
  const [key, setKey] = useState(newKey())
  const [pinFor, setPinFor] = useState<string | null>(null)

  const s = session.data
  const bal = (code: DrawerCode) => balances.data?.find((d) => d.code === code)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cash'] })
    qc.invalidateQueries({ queryKey: ['drawers'] })
    qc.invalidateQueries({ queryKey: ['accounts'] })
  }
  function close() {
    setModal(null); setErr(null); setVals({}); setAvals({}); setNote(''); setFrom(''); setTo(''); setAmount(''); setTarget(''); setDrawer(''); setPinFor(null)
    setKey(newKey())
  }
  const done = () => { refresh(); close() }

  const openShift = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('open_shift', { p_for: null, p_counts: countsPayload(vals) })
      if (error) throw error
    },
    onSuccess: done, onError: setErr,
  })
  const closeShift = useMutation({
    mutationFn: async () => {
      const ac: Record<string, number> = {}
      for (const a of activeAccounts) {
        const m = parse(avals[a.id] ?? '')
        if (m === null) continue
        if (Number.isNaN(m)) throw new Error('أدخل أرقاماً صحيحة في العدّ.')
        ac[a.id] = Number(fromMinor(m))
      }
      const { error } = await supabase.rpc('close_shift', { p_counts: countsPayload(vals), p_note: note.trim() || null, p_account_counts: ac })
      if (error) throw error
    },
    onSuccess: done, onError: setErr,
  })
  const transfer = useMutation({
    mutationFn: async (token: string | null) => {
      const m = parse(amount)
      if (!from || !to || from === to) throw new Error('اختر درجين مختلفين.')
      if (m === null || Number.isNaN(m) || m <= 0) throw new Error('أدخل مبلغاً صحيحاً.')
      const { error } = await supabase.rpc('transfer_drawer', {
        p_from: from, p_to: to, p_amount: Number(fromMinor(m)), p_note: note.trim() || null, p_idem: key, p_override: token,
      })
      if (error) throw error
    },
    onSuccess: done, onError: setErr,
  })
  const adjust = useMutation({
    mutationFn: async (token: string | null) => {
      const m = parse(target)
      if (!drawer) throw new Error('اختر الدرج.')
      if (m === null || Number.isNaN(m)) throw new Error('أدخل الرصيد الصحيح.')
      if (!note.trim()) throw new Error('اكتب سبب التعديل.')
      const { error } = await supabase.rpc('adjust_drawer', {
        p_drawer: drawer, p_target: Number(fromMinor(m)), p_note: note.trim(), p_idem: key, p_override: token,
      })
      if (error) throw error
    },
    onSuccess: done, onError: setErr,
  })

  // does this transfer/adjustment need a manager PIN? (the owner never does)
  const thr = threshold.data ?? 5000
  const transferNeedsPin = () => { const m = parse(amount); return !isOwner && m !== null && !Number.isNaN(m) && m >= thr * 100 }
  const adjustNeedsPin = () => {
    const m = parse(target); const cur = balances.data?.find((d) => d.id === drawer)
    if (isOwner || m === null || Number.isNaN(m) || !cur) return false
    return Math.abs(m - toMinor(cur.balance)) >= thr * 100
  }
  function submitTransfer() { setErr(null); if (transferNeedsPin()) setPinFor('transfer'); else transfer.mutate(null) }
  function submitAdjust() { setErr(null); if (adjustNeedsPin()) setPinFor('adjust'); else adjust.mutate(null) }

  // live difference for the close dialog
  const diffs = COUNTED.map((c) => {
    const m = parse(vals[c] ?? ''); const b = bal(c)
    return { c, diff: m === null || Number.isNaN(m) || !b ? 0 : m - toMinor(b.balance) }
  })
  const acctDiffs = activeAccounts.map((a) => {
    const m = parse(avals[a.id] ?? '')
    return { a, diff: m === null || Number.isNaN(m) ? 0 : m - toMinor(a.balance) }
  })
  const anyDiff = diffs.some((d) => d.diff !== 0) || acctDiffs.some((d) => d.diff !== 0)

  const countFields = (mode: 'open' | 'close') => (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        اكتب المبلغ الموجود فعلياً في كل درج. اترك الحقل فارغاً لتخطي العدّ (يبقى الرصيد المتوقع). الخزنة لا تُعدّ هنا.
      </p>
      {COUNTED.map((c) => {
        const b = bal(c)
        const d = diffs.find((x) => x.c === c)!.diff
        return (
          <div key={c} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem]">
            <div>
              <p className="text-sm font-medium">{b?.name ?? c}</p>
              <p className="text-xs text-muted">{DRAWER_HINT[c]} · المتوقع: {b ? money(b.balance) : '…'}</p>
            </div>
            <Field label="المعدود">
              <input className={inputCls} dir="ltr" inputMode="decimal" placeholder="تخطي" value={vals[c] ?? ''} onChange={(e) => setVals({ ...vals, [c]: e.target.value })} />
            </Field>
            {mode === 'close' && d !== 0 && <p role="status" className="text-xs text-warn sm:col-span-2">الفرق: {formatEGP(d)}</p>}
          </div>
        )
      })}
      {mode === 'close' && activeAccounts.length > 0 && (
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-sm font-semibold">المحافظ والماكينات</p>
          <p className="text-xs text-muted">اكتب الرصيد الظاهر فعلياً في كل محفظة أو ماكينة. الفرق يُسجَّل تصحيحًا وينبّه المدير.</p>
          {acctDiffs.map(({ a, diff }) => (
            <div key={a.id} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem]">
              <div>
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted">المتوقع: {money(a.balance)}</p>
              </div>
              <Field label="المعدود">
                <input className={inputCls} dir="ltr" inputMode="decimal" placeholder="تخطي" value={avals[a.id] ?? ''} onChange={(e) => setAvals({ ...avals, [a.id]: e.target.value })} />
              </Field>
              {diff !== 0 && <p role="status" className="text-xs text-warn sm:col-span-2">الفرق: {formatEGP(diff)}</p>}
            </div>
          ))}
        </div>
      )}
      {mode === 'close' && (
        <Field label={anyDiff ? 'سبب الفرق (مطلوب)' : 'ملاحظات (اختياري)'}>
          <input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
    </div>
  )

  const drawerOptions = (list: DrawerBalance[] | undefined) =>
    list?.map((d) => <option key={d.id} value={d.id}>{d.name} — {money(d.balance)}</option>)

  return (
    <div>
      <PageHeader
        title="الورديات والأدراج"
        subtitle="افتح الوردية بعدّ كل درج، وأغلقها بنفس الطريقة. كل حركة نقدية تُسجَّل في الدرج الخاص بها."
        actions={
          canUse && (
            <>
              {s && <Button onClick={() => { setErr(null); setKey(newKey()); setModal('transfer') }}>تحويل بين الأدراج</Button>}
              {s && canManage && <Button onClick={() => { setErr(null); setKey(newKey()); setModal('adjust') }}>تعديل رصيد درج</Button>}
              {s ? <Button variant="primary" onClick={() => { setErr(null); setVals({}); setModal('close') }}>إغلاق الوردية</Button>
                 : <Button variant="primary" onClick={() => { setErr(null); setVals({}); setModal('open') }}>بدء وردية جديدة</Button>}
            </>
          )
        }
      />

      {session.isLoading && <State kind="loading" />}
      {session.isError && <State kind="error" text="تعذّر تحميل حالة الوردية." />}

      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{s ? 'الوردية مفتوحة' : 'لا توجد وردية نشطة'}</h2>
          <Chip tone={s ? 'ok' : 'neutral'}>{s ? 'مفتوحة' : 'مغلقة'}</Chip>
          {s && <Chip tone="info"><bdi>{shiftLabel(s.shift_no)}</bdi></Chip>}
          {s && <span className="text-sm text-muted">منذ {formatCairo(s.opened_at)}</span>}
        </div>
        {!s && <p className="mt-2 text-sm text-muted">لا يمكن تسجيل أي بيع قبل بدء وردية.</p>}
      </Card>

      {balances.isLoading && <State kind="loading" />}
      {balances.isError && <State kind="error" text="تعذّر تحميل أرصدة الأدراج. تأكد من تطبيق المايجريشن 0016." />}
      {balances.data && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.data.map((d) => (
            <Card key={d.id} className={`p-4 ${d.carries_over ? 'border-accent/50' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{d.name}</p>
                {d.carries_over && <Chip tone="info">تبقى بين الورديات</Chip>}
              </div>
              <p className="mt-2 text-2xl font-bold" dir="ltr">{money(d.balance)}</p>
              <p className="mt-1 text-xs text-muted">{DRAWER_HINT[d.code]}</p>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-2 text-lg font-bold">سجل الورديات</h2>
      {history.data?.length === 0 && <State kind="empty" title="لا توجد ورديات سابقة" text="ستظهر هنا بعد أول إغلاق." />}
      {history.data && history.data.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                {['الوردية', 'الفتح', 'الإغلاق', 'المتوقع', 'المعدود', 'الفرق', 'فرق الأدراج', 'السبب'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {history.data.map((h) => {
                const d = toMinor(h.difference ?? '0')
                const per = Object.entries(h.closing_counts ?? {}).filter(([, v]) => v.difference !== 0)
                const perAcct = Object.entries(h.closing_account_counts ?? {}).filter(([, v]) => v.difference !== 0)
                return (
                  <tr key={h.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap p-3"><bdi>{shiftLabel(h.shift_no)}</bdi></td>
                    <td className="whitespace-nowrap p-3">{formatCairo(h.opened_at)}</td>
                    <td className="whitespace-nowrap p-3">{h.closed_at ? formatCairo(h.closed_at) : '—'}</td>
                    <td className="p-3">{money(h.expected_cash ?? '0')}</td>
                    <td className="p-3">{money(h.counted_cash ?? '0')}</td>
                    <td className="p-3">{d === 0 ? <Chip tone="ok">مطابق</Chip> : <Chip tone="danger">{formatEGP(d)}</Chip>}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {per.length + perAcct.length === 0 ? '—' : <>
                          {per.map(([c, v]) => <Chip key={c} tone="warn">{bal(c as DrawerCode)?.name ?? c}: {money(v.difference)}</Chip>)}
                          {perAcct.map(([id, v]) => <Chip key={id} tone="warn">{v.name}: {money(v.difference)}</Chip>)}
                        </>}
                      </div>
                    </td>
                    <td className="p-3" dir="auto">{h.close_note ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modal === 'open'} onClose={close} title="بدء وردية جديدة" wide
        footer={<><Button onClick={close}>إلغاء</Button><Button variant="primary" disabled={openShift.isPending} onClick={() => { setErr(null); openShift.mutate() }}>{openShift.isPending ? 'جارٍ الفتح…' : 'تأكيد وبدء الوردية'}</Button></>}>
        {countFields('open')}<div className="mt-3"><ErrorText error={err} /></div>
      </Modal>

      <Modal open={modal === 'close'} onClose={close} title="إغلاق الوردية" wide
        footer={<><Button onClick={close}>إلغاء</Button><Button variant="primary" disabled={closeShift.isPending || (anyDiff && !note.trim())} onClick={() => { setErr(null); closeShift.mutate() }}>{closeShift.isPending ? 'جارٍ الإغلاق…' : 'تأكيد وإغلاق الوردية'}</Button></>}>
        {countFields('close')}<div className="mt-3"><ErrorText error={err} /></div>
      </Modal>

      <Modal open={modal === 'transfer'} onClose={close} title="تحويل بين الأدراج"
        footer={<><Button onClick={close}>إلغاء</Button><Button variant="primary" disabled={transfer.isPending} onClick={submitTransfer}>{transfer.isPending ? 'جارٍ التحويل…' : 'تحويل'}</Button></>}>
        <div className="space-y-3">
          <Field label="من درج"><select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}><option value="">اختر…</option>{drawerOptions(balances.data)}</select></Field>
          <Field label="إلى درج"><select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}><option value="">اختر…</option>{drawerOptions(balances.data?.filter((d) => d.id !== from))}</select></Field>
          <Field label="المبلغ" hint={isOwner ? undefined : `من ${formatEGP(thr * 100)} فأكثر يلزم رقم سري لمدير.`}>
            <input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="ملاحظة (اختياري)"><input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <ErrorText error={err} />
        </div>
      </Modal>

      <Modal open={modal === 'adjust'} onClose={close} title="تعديل رصيد درج"
        footer={<><Button onClick={close}>إلغاء</Button><Button variant="primary" disabled={adjust.isPending} onClick={submitAdjust}>{adjust.isPending ? 'جارٍ الحفظ…' : 'حفظ التعديل'}</Button></>}>
        <div className="space-y-3">
          <Field label="الدرج"><select className={inputCls} value={drawer} onChange={(e) => setDrawer(e.target.value)}><option value="">اختر…</option>{drawerOptions(balances.data)}</select></Field>
          <Field label="الرصيد الصحيح بعد التعديل"><input className={inputCls} dir="ltr" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label="السبب (مطلوب)"><input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <ErrorText error={err} />
        </div>
      </Modal>

      <ApproverPin
        open={pinFor !== null}
        onClose={() => setPinFor(null)}
        reason={pinFor === 'transfer' ? `تحويل ${amount} بين درجين` : `تعديل رصيد درج إلى ${target}`}
        onToken={(t) => { const k = pinFor; setPinFor(null); if (k === 'transfer') transfer.mutate(t); else adjust.mutate(t) }}
      />
    </div>
  )
}
