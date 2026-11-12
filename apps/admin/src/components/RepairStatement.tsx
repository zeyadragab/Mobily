import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatEGP, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { downloadCsv, repairNumber, REPAIR_STATUS, type RepairStatus } from '../lib/repairs'
import { Button, Card, Chip, ErrorText, Field, inputCls } from './ui'
import { State } from './State'

type Order = { id: string; order_number: number; device_model: string; customer_name: string; status: RepairStatus; received_at: string; quote_total: number | string }
type Bal = { order_id: string; paid: number | string; remaining: number | string }

/** Customer statement: every repair for one phone number with what was charged, paid and still due. */
export default function RepairStatement({ onOpen }: { onOpen: (id: string) => void }) {
  const [phone, setPhone] = useState('')
  const load = useMutation({
    mutationFn: async () => {
      const digits = phone.replace(/[^\d+]/g, '')
      if (digits.length < 7) throw new Error('اكتب رقم الموبايل كامل.')
      const o = await supabase.from('repair_orders').select('id,order_number,device_model,customer_name,status,received_at,quote_total')
        .eq('customer_phone', digits).order('order_number', { ascending: false }).limit(200)
      if (o.error) throw o.error
      const orders = o.data as unknown as Order[]
      if (orders.length === 0) return { orders, bal: new Map<string, Bal>() }
      const b = await supabase.from('repair_balances').select('order_id,paid,remaining').in('order_id', orders.map((x) => x.id))
      if (b.error) throw b.error
      return { orders, bal: new Map((b.data as Bal[]).map((x) => [x.order_id, x])) }
    },
  })
  const rows = load.data?.orders ?? []
  const sum = (f: (o: Order) => number) => rows.reduce((s, o) => s + f(o), 0)
  const bal = (o: Order) => load.data?.bal.get(o.id)
  const charged = sum((o) => toMinor(o.quote_total))
  const paid = sum((o) => toMinor(bal(o)?.paid ?? 0))

  return (
    <div>
      <form className="mb-4 flex max-w-xl items-end gap-2" onSubmit={(e) => { e.preventDefault(); load.mutate() }}>
        <Field label="رقم موبايل العميل" className="flex-1"><input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Button variant="primary" disabled={load.isPending}>{load.isPending ? 'جارٍ التحميل…' : 'عرض كشف الحساب'}</Button>
      </form>
      <ErrorText error={load.error} />
      {load.isSuccess && rows.length === 0 && <State kind="empty" title="مفيش أوامر صيانة للرقم ده" />}
      {rows.length > 0 && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
            <Card className="p-4"><p className="text-xs text-muted">إجمالي المطلوب</p><p className="text-2xl font-bold">{formatEGP(charged)}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted">إجمالي المدفوع</p><p className="text-2xl font-bold">{formatEGP(paid)}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted">المتبقي على العميل</p><p className="text-2xl font-bold">{formatEGP(charged - paid)}</p></Card>
          </div>
          <div className="mb-2 flex justify-between"><p className="font-semibold" dir="auto">{rows[0].customer_name}</p>
            <Button small onClick={() => downloadCsv('repair-statement.csv', ['الأمر', 'الجهاز', 'الحالة', 'الاستلام', 'الإجمالي', 'المدفوع', 'المتبقي'],
              rows.map((o) => [repairNumber(o.order_number), o.device_model, REPAIR_STATUS[o.status], formatCairo(o.received_at), o.quote_total, bal(o)?.paid ?? 0, bal(o)?.remaining ?? o.quote_total]))}>تصدير CSV</Button></div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-muted"><tr className="border-b border-line">{['الأمر', 'الجهاز', 'الحالة', 'الإجمالي', 'المدفوع', 'المتبقي'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
              <tbody>{rows.map((o) => {
                const rem = toMinor(bal(o)?.remaining ?? o.quote_total)
                return (
                  <tr key={o.id} className="border-b border-line last:border-0">
                    <td className="p-3"><Button small onClick={() => onOpen(o.id)}><bdi>{repairNumber(o.order_number)}</bdi></Button></td>
                    <td className="p-3" dir="auto">{o.device_model}</td>
                    <td className="p-3"><Chip tone={o.status === 'delivered' || o.status === 'ready' ? 'ok' : 'info'}>{REPAIR_STATUS[o.status]}</Chip></td>
                    <td className="p-3">{formatEGP(toMinor(o.quote_total))}</td>
                    <td className="p-3">{formatEGP(toMinor(bal(o)?.paid ?? 0))}</td>
                    <td className="p-3">{rem === 0 ? <Chip tone="ok">مسدد</Chip> : <Chip tone="warn">{formatEGP(rem)}</Chip>}</td>
                  </tr>)
              })}</tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
