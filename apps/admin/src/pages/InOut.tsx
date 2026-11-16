import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, PageHeader } from '../components/ui'
import { CancelDialog, CustomerPicker, Kpi, NoShiftHint } from '../components/WalletBits'
import { useCustomers } from '../lib/customers'
import { useOpenSession } from '../lib/data'
import { newKey, useDrawerBalances } from '../lib/drawers'
import { money, useInOut, useInOutBalances } from '../lib/installments'
import { formatEGP, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'

const m = (v: number | string) => formatEGP(toMinor(v))

/** Money a person leaves with the shop (in) or takes from it (out). Kept apart from sales debt. Owner and manager only. */
export default function InOut() {
  const qc = useQueryClient()
  const session = useOpenSession()
  const customers = useCustomers()
  const drawers = useDrawerBalances()
  const entries = useInOut()
  const balances = useInOutBalances()
  const [cust, setCust] = useState<string | null>(null)
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [drawer, setDrawer] = useState('')
  const [note, setNote] = useState('')
  const [key, setKey] = useState(newKey)
  const [cancel, setCancel] = useState<{ id: string; no: string } | null>(null)
  const [find, setFind] = useState('')

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['inout'] }), qc.invalidateQueries({ queryKey: ['inout-balances'] }), qc.invalidateQueries({ queryKey: ['drawers'] }),
  ])
  const save = useMutation({
    mutationFn: async () => {
      if (!cust) throw new Error('اختر العميل.')
      const { error } = await supabase.rpc('create_inout', {
        p_customer: cust, p_direction: direction, p_amount: money(amount), p_drawer: drawer || null, p_note: note.trim() || null, p_idem: key,
      })
      if (error) throw error
    },
    onSuccess: async () => { setAmount(''); setNote(''); setKey(newKey()); await refresh() },
  })

  const holds = (balances.data ?? []).filter((b) => toMinor(b.net) > 0).reduce((s, b) => s + toMinor(b.net), 0)
  const owes = (balances.data ?? []).filter((b) => toMinor(b.net) < 0).reduce((s, b) => s - toMinor(b.net), 0)
  const rows = (entries.data ?? []).filter((e) => !find.trim() || `${e.customers?.name} ${e.customers?.phone} ${e.entry_no}`.toLowerCase().includes(find.trim().toLowerCase()))

  return (
    <div>
      <PageHeader title="داخل وخارج" subtitle="أمانات: فلوس شخص عندنا (داخل) أو فلوس أخدها منّا (خارج). منفصلة عن ديون البيع."
        actions={<Button onClick={() => downloadCsv('inout.csv', ['الرقم', 'التاريخ', 'العميل', 'الاتجاه', 'المبلغ', 'الدرج', 'الحالة', 'ملاحظة'],
          (entries.data ?? []).map((e) => [e.entry_no, e.created_at, e.customers?.name, e.direction === 'in' ? 'داخل' : 'خارج', e.amount, e.drawer_code ?? 'دفتري', e.status, e.note]))}>تصدير CSV</Button>} />
      {session.isSuccess && !session.data && <NoShiftHint />}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="أمانات عندنا لعملاء" value={formatEGP(holds)} tone="warn" />
        <Kpi label="فلوس عند عملاء لينا" value={formatEGP(owes)} tone={owes ? 'danger' : undefined} />
        <Kpi label="عملاء عليهم حركة" value={String(balances.data?.length ?? 0)} />
        <Kpi label="حركات نشطة" value={String((entries.data ?? []).filter((e) => e.status === 'active').length)} />
      </div>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 font-semibold">حركة جديدة</h2>
        <form className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <div className="sm:col-span-2 lg:col-span-4"><CustomerPicker customers={customers.data ?? []} loading={customers.isLoading} value={cust} onChange={setCust} required /></div>
          <Field label="الاتجاه">
            <select className={inputCls} value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
              <option value="in">داخل (استلمنا فلوس أمانة)</option><option value="out">خارج (أعطينا فلوس)</option>
            </select>
          </Field>
          <Field label="المبلغ"><input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="الدرج" hint="سيبها دفتري لو مفيش فلوس اتحركت فعلاً.">
            <select className={inputCls} value={drawer} onChange={(e) => setDrawer(e.target.value)}>
              <option value="">دفتري فقط (بدون حركة درج)</option>
              {(drawers.data ?? []).map((d) => <option key={d.id} value={d.code}>{d.name} · {formatEGP(toMinor(d.balance))}</option>)}
            </select>
          </Field>
          <Field label="ملاحظة"><input className={inputCls} dir="auto" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="sm:col-span-2 lg:col-span-4"><ErrorText error={save.error} /></div>
          <div className="sm:col-span-2 lg:col-span-4"><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : 'تسجيل'}</Button></div>
        </form>
      </Card>

      {!!balances.data?.length && <Card className="mb-4 overflow-x-auto">
        <h2 className="p-4 pb-0 font-semibold">أرصدة العملاء</h2>
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['العميل', 'داخل', 'خارج', 'الصافي', 'الحركات'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{balances.data.map((b) => <tr key={b.customer_id} className="border-b border-line last:border-0">
            <td className="p-3"><p dir="auto">{b.customer_name}</p><bdi className="text-xs text-muted">{b.customer_phone}</bdi></td>
            <td className="p-3">{m(b.total_in)}</td><td className="p-3">{m(b.total_out)}</td>
            <td className="p-3 font-semibold">{toMinor(b.net) > 0 ? <Chip tone="warn">عندنا {m(b.net)}</Chip> : toMinor(b.net) < 0 ? <Chip tone="danger">عليه {formatEGP(-toMinor(b.net))}</Chip> : <Chip tone="ok">متعادل</Chip>}</td>
            <td className="p-3">{b.entries}</td>
          </tr>)}</tbody>
        </table>
      </Card>}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">السجل</h2>
        <input aria-label="بحث" className={`${inputCls} !w-64`} dir="auto" placeholder="ابحث بالعميل أو الموبايل أو الرقم" value={find} onChange={(e) => setFind(e.target.value)} />
      </div>
      {entries.isLoading && <State kind="loading" />}
      {entries.isError && <State kind="error" text="تعذّر تحميل السجل." action={<Button onClick={() => void entries.refetch()}>حاول تاني</Button>} />}
      {entries.isSuccess && rows.length === 0 && <State kind="empty" title="لا توجد حركات" />}
      {rows.length > 0 && <Card className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['الرقم', 'التاريخ', 'العميل', 'الاتجاه', 'المبلغ', 'الدرج', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((e) => <tr key={e.id} className="border-b border-line last:border-0">
          <td className="p-3"><bdi>{e.entry_no}</bdi></td><td className="p-3">{formatCairo(e.created_at)}</td>
          <td className="p-3" dir="auto">{e.customers?.name}{e.note && <p className="text-xs text-muted">{e.note}</p>}</td>
          <td className="p-3">{e.direction === 'in' ? <Chip tone="ok">داخل</Chip> : <Chip tone="warn">خارج</Chip>}</td>
          <td className="p-3">{m(e.amount)}</td><td className="p-3">{e.drawer_code ? (drawers.data?.find((d) => d.code === e.drawer_code)?.name ?? e.drawer_code) : 'دفتري'}</td>
          <td className="p-3">{e.status === 'cancelled' ? <Chip tone="danger">ملغية</Chip> : <Chip tone="ok">نشطة</Chip>}{e.cancel_reason && <p className="text-xs text-muted" dir="auto">{e.cancel_reason}</p>}</td>
          <td className="p-3">{e.status === 'active' && <Button small variant="danger" onClick={() => setCancel({ id: e.id, no: e.entry_no })}>إلغاء</Button>}</td>
        </tr>)}</tbody>
      </table></Card>}

      {cancel && <CancelDialog title={`إلغاء الحركة ${cancel.no}`} text="بترجع الفلوس للدرج أو منه بقيد عكسي. محتاج وردية مفتوحة."
        run={async (reason) => { const { error } = await supabase.rpc('cancel_inout', { p_id: cancel.id, p_reason: reason }); if (error) throw error }}
        onClose={() => setCancel(null)} onDone={async () => { setCancel(null); await refresh() }} />}
    </div>
  )
}
