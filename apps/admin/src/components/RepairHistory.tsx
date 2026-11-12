import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'
import { downloadCsv, repairNumber, REPAIR_STATUS, type RepairStatus } from '../lib/repairs'
import { Button, Card, Chip, inputCls } from './ui'
import { State } from './State'

type Row = {
  id: number; order_id: string; status: RepairStatus; note: string | null; actor_name: string; occurred_at: string
  repair_orders: { order_number: number; device_model: string; customer_name: string } | null
}

/** Log of every repair event (status, custody, payments, delivery), newest first. */
export default function RepairHistory({ onOpen }: { onOpen: (orderId: string) => void }) {
  const [search, setSearch] = useState('')
  const q = useQuery({
    queryKey: ['repairs', 'history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_events')
        .select('id,order_id,status,note,actor_name,occurred_at,repair_orders(order_number,device_model,customer_name)')
        .order('id', { ascending: false }).limit(300)
      if (error) throw error
      return data as unknown as Row[]
    },
  })
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((r) => !s || [r.note, r.actor_name, r.repair_orders?.device_model, r.repair_orders?.customer_name,
      r.repair_orders ? repairNumber(r.repair_orders.order_number) : ''].some((v) => String(v ?? '').toLowerCase().includes(s)))
  }, [q.data, search])

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-md flex-1`} aria-label="بحث في السجل" placeholder="دوّر في السجل" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button disabled={rows.length === 0} onClick={() => downloadCsv('repair-history.csv', ['الوقت', 'الأمر', 'الجهاز', 'العميل', 'الحالة', 'التفاصيل', 'بواسطة'],
          rows.map((r) => [formatCairo(r.occurred_at), r.repair_orders ? repairNumber(r.repair_orders.order_number) : '', r.repair_orders?.device_model, r.repair_orders?.customer_name, REPAIR_STATUS[r.status], r.note, r.actor_name]))}>تصدير CSV</Button>
      </div>
      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل السجل." />}
      {q.isSuccess && rows.length === 0 && <State kind="empty" title="مفيش حركات مطابقة" />}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-muted"><tr className="border-b border-line">{['الوقت', 'الأمر', 'الحالة', 'التفاصيل', 'بواسطة'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap p-3">{formatCairo(r.occurred_at)}</td>
                <td className="p-3">{r.repair_orders && <><Button small onClick={() => onOpen(r.order_id)}><bdi>{repairNumber(r.repair_orders.order_number)}</bdi></Button>
                  <p className="mt-1 text-xs text-muted" dir="auto">{r.repair_orders.device_model}</p></>}</td>
                <td className="p-3"><Chip tone={r.status === 'delivered' || r.status === 'ready' ? 'ok' : 'info'}>{REPAIR_STATUS[r.status]}</Chip></td>
                <td className="p-3" dir="auto">{r.note ?? '—'}</td>
                <td className="p-3" dir="auto">{r.actor_name || '—'}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
