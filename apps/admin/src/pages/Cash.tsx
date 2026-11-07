import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useOpenSession, type CashSession } from '../lib/data'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, PageHeader } from '../components/ui'
import { State } from '../components/State'

export default function Cash() {
  const { hasRole } = useAuth()
  const canUse = hasRole('owner', 'manager', 'cashier')
  const qc = useQueryClient()
  const open = useOpenSession()
  const [opening, setOpening] = useState('')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [lastClosed, setLastClosed] = useState<CashSession | null>(null)

  const history = useQuery({
    queryKey: ['cash', 'history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_sessions').select('*').eq('status', 'closed').order('closed_at', { ascending: false }).limit(50)
      if (error) throw error
      return data as CashSession[]
    },
  })

  const sums = useQuery({
    queryKey: ['cash', 'sums', open.data?.id],
    enabled: !!open.data,
    queryFn: async () => {
      const sp = await supabase.from('supplier_payments').select('amount').eq('session_id', open.data!.id).eq('method', 'cash').eq('status', 'completed')
      if (sp.error) throw sp.error
      const [a, b, c] = await Promise.all([
        supabase.from('sales_payments').select('amount').eq('session_id', open.data!.id).eq('method', 'cash'),
        supabase.from('expense_payments').select('amount').eq('session_id', open.data!.id).eq('method', 'cash'),
        supabase.from('sales_refunds').select('amount').eq('session_id', open.data!.id).eq('method', 'cash'),
      ])
      if (a.error) throw a.error
      if (b.error) throw b.error
      if (c.error) throw c.error
      const sum = (r: { amount: string }[]) => r.reduce((s, x) => s + toMinor(x.amount), 0)
      return { sales: sum(a.data as { amount: string }[]), expenses: sum(b.data as { amount: string }[]), refunds: sum(c.data as { amount: string }[]) + sum(sp.data as { amount: string }[]) }
    },
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['cash'] })
  const doOpen = useMutation({
    mutationFn: async () => {
      let v = -1
      try { v = toMinor(opening || '0') } catch { v = -1 }
      if (v < 0) throw new Error('أدخل رصيد فتح صحيح.')
      const { error } = await supabase.rpc('open_cash_session', { p_opening: Number(fromMinor(v)) })
      if (error) throw error
    },
    onSuccess: () => { setOpening(''); setLastClosed(null); refresh() },
    onError: setErr,
  })
  const doClose = useMutation({
    mutationFn: async () => {
      let v = -1
      try { v = toMinor(counted) } catch { v = -1 }
      if (v < 0 || !counted) throw new Error('أدخل المبلغ المعدود في الدرج.')
      const { data, error } = await supabase.rpc('close_cash_session', { p_counted: Number(fromMinor(v)), p_note: note || null })
      if (error) throw error
      return data as CashSession
    },
    onSuccess: (s) => { setCounted(''); setNote(''); setLastClosed(s); refresh() },
    onError: setErr,
  })

  const s = open.data
  const expectedLive = s && sums.data ? toMinor(s.opening_balance) + sums.data.sales - sums.data.expenses - sums.data.refunds : null

  return (
    <div>
      <PageHeader title="الدرج" subtitle="افتح الدرج في بداية الوردية، وأغلقه بعد عدّ النقدية. الفرق يظهر للمالك." />
      <ErrorText error={err} />

      {open.isLoading && <State kind="loading" />}
      {open.isError && <State kind="error" text="تعذّر تحميل حالة الدرج." />}

      {open.data === null && canUse && (
        <Card className="mb-6 max-w-lg space-y-3 p-5">
          <div className="flex items-center gap-2"><h2 className="text-lg font-bold">الدرج مغلق</h2><Chip>مغلق</Chip></div>
          <Field label="رصيد الفتح (النقدية الموجودة الآن)"><input className={inputCls} dir="ltr" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
          <Button variant="primary" disabled={doOpen.isPending} onClick={() => { setErr(null); doOpen.mutate() }}>فتح الدرج</Button>
        </Card>
      )}

      {s && (
        <Card className="mb-6 max-w-2xl space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold">الدرج مفتوح</h2><Chip tone="ok">مفتوح</Chip><span className="text-sm text-muted">منذ {formatCairo(s.opened_at)}</span></div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">رصيد الفتح</p><p className="font-bold">{formatEGP(toMinor(s.opening_balance))}</p></div>
            <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">نقدي من المبيعات</p><p className="font-bold">{sums.data ? formatEGP(sums.data.sales) : '…'}</p></div>
            <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">مصروفات + مرتجعات + موردين نقدًا</p><p className="font-bold">{sums.data ? formatEGP(sums.data.expenses + sums.data.refunds) : '…'}</p></div>
            <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">المتوقع في الدرج</p><p className="font-bold">{expectedLive != null ? formatEGP(expectedLive) : '…'}</p></div>
          </div>
          {canUse && (
            <div className="space-y-3 border-t border-line pt-4">
              <h3 className="font-semibold">إغلاق الدرج</h3>
              <Field label="المبلغ المعدود فعليًا"><input className={inputCls} dir="ltr" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
              {expectedLive != null && counted && (() => { try { const d = toMinor(counted) - expectedLive; return d !== 0 ? <p role="status" className="text-sm text-warn">الفرق عن المتوقع: {formatEGP(d)} — اكتب السبب.</p> : <p className="text-sm text-ok">مطابق للمتوقع ✓</p> } catch { return null } })()}
              <Field label="سبب الفرق (إن وُجد)"><input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <Button variant="primary" disabled={doClose.isPending} onClick={() => { setErr(null); doClose.mutate() }}>إغلاق الدرج</Button>
            </div>
          )}
        </Card>
      )}

      {lastClosed && (
        <Card className="mb-6 max-w-lg p-5 text-sm">
          <h2 className="mb-2 font-bold">تم إغلاق الدرج</h2>
          <p>المتوقع: {formatEGP(toMinor(lastClosed.expected_cash ?? '0'))} · المعدود: {formatEGP(toMinor(lastClosed.counted_cash ?? '0'))}</p>
          <p className={toMinor(lastClosed.difference ?? '0') === 0 ? 'text-ok' : 'text-danger'}>الفرق: {formatEGP(toMinor(lastClosed.difference ?? '0'))}</p>
        </Card>
      )}

      <h2 className="mb-2 text-lg font-bold">سجل الإغلاقات</h2>
      {history.data?.length === 0 && <State kind="empty" title="لا توجد إغلاقات سابقة" />}
      {history.data && history.data.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">{['الفتح', 'الإغلاق', 'رصيد الفتح', 'المتوقع', 'المعدود', 'الفرق', 'السبب'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {history.data.map((h) => {
                const d = toMinor(h.difference ?? '0')
                return (
                  <tr key={h.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap p-3">{formatCairo(h.opened_at)}</td>
                    <td className="whitespace-nowrap p-3">{h.closed_at ? formatCairo(h.closed_at) : '—'}</td>
                    <td className="p-3">{formatEGP(toMinor(h.opening_balance))}</td>
                    <td className="p-3">{formatEGP(toMinor(h.expected_cash ?? '0'))}</td>
                    <td className="p-3">{formatEGP(toMinor(h.counted_cash ?? '0'))}</td>
                    <td className="p-3">{d === 0 ? <Chip tone="ok">مطابق</Chip> : <Chip tone="danger">{formatEGP(d)}</Chip>}</td>
                    <td className="p-3" dir="auto">{h.close_note ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
