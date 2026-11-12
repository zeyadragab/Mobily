import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatEGP, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { BOARD_COLUMNS, needsCustomerContact, repairNumber, REPAIR_LIST_COLUMNS, REPAIR_STATUS, type RepairOrder } from '../lib/repairs'
import { Chip, inputCls } from './ui'
import { State } from './State'

type Bal = { order_id: string; paid: number | string; remaining: number | string }

/** Kanban view of every repair still in the shop. Click a card to open the order. */
export default function RepairBoard({ branchId, onOpen }: { branchId: string; onOpen: (id: string) => void }) {
  const { hasRole } = useAuth()
  const seesMoney = hasRole('owner', 'manager', 'cashier', 'accountant')
  const [search, setSearch] = useState('')

  const orders = useQuery({
    queryKey: ['repairs', 'board', branchId],
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase.from('repair_orders').select(REPAIR_LIST_COLUMNS).is('delivered_at', null)
      if (branchId) q = q.eq('branch_id', branchId)
      const { data, error } = await q.order('order_number', { ascending: false }).limit(300)
      if (error) throw error
      return { rows: data as unknown as RepairOrder[], at: Date.now() }
    },
  })
  const ids = (orders.data?.rows ?? []).map((o) => o.id)
  const balances = useQuery({
    queryKey: ['repairs', 'board-balances', ids.join(',')],
    enabled: seesMoney && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_balances').select('order_id,paid,remaining').in('order_id', ids)
      if (error) throw error
      return new Map((data as Bal[]).map((b) => [b.order_id, b]))
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (orders.data?.rows ?? []).filter(
      (o) => !s || [repairNumber(o.order_number), o.customer_name, o.customer_phone, o.device_model].some((v) => v.toLowerCase().includes(s)),
    )
  }, [orders.data, search])
  const now = orders.data?.at ?? 0

  return (
    <div>
      <input className={`${inputCls} mb-4 max-w-md`} aria-label="بحث في اللوحة" placeholder="دوّر برقم الأمر أو العميل أو الموبايل أو الجهاز"
        value={search} onChange={(e) => setSearch(e.target.value)} />
      {orders.isLoading && <State kind="loading" />}
      {orders.isError && <State kind="error" text="تعذّر تحميل اللوحة." />}
      {orders.isSuccess && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {BOARD_COLUMNS.map((col) => {
            const list = rows.filter((o) => col.statuses.includes(o.status))
            return (
              <section key={col.key} aria-label={col.label} className={`flex min-h-48 flex-col rounded-2xl border p-3 ${col.tone}`}>
                <header className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{col.label}</h3>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium">{list.length}</span>
                </header>
                {list.length === 0 && <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">لا توجد تذاكر</p>}
                <ul className="space-y-2">
                  {list.map((o) => {
                    const late = o.due_at && new Date(o.due_at).getTime() < now
                    const bal = balances.data?.get(o.id)
                    const priced = toMinor(o.quote_total) > 0
                    return (
                      <li key={o.id}>
                        <button onClick={() => onOpen(o.id)} className="w-full rounded-xl border border-line bg-surface p-3 text-start text-sm transition hover:border-accent focus-visible:outline focus-visible:outline-2">
                          <div className="flex items-center justify-between gap-2">
                            <bdi className="font-mono text-xs text-muted">{repairNumber(o.order_number)}</bdi>
                            {late && <Chip tone="danger">متأخر</Chip>}
                          </div>
                          <p className="mt-1 font-semibold" dir="auto">{o.device_model}</p>
                          <p className="text-muted" dir="auto">{o.customer_name}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Chip tone={o.status === 'ready' ? 'ok' : 'info'}>{REPAIR_STATUS[o.status]}</Chip>
                            {needsCustomerContact(o) && <Chip tone="warn">اتصل بالعميل</Chip>}
                            {priced && <Chip>{formatEGP(toMinor(o.quote_total))}</Chip>}
                            {priced && bal && (toMinor(bal.remaining) === 0 ? <Chip tone="ok">مدفوع</Chip> : toMinor(bal.paid) > 0 ? <Chip tone="warn">متبقي {formatEGP(toMinor(bal.remaining))}</Chip> : null)}
                          </div>
                          {o.due_at && <p className="mt-1 text-xs text-muted">التسليم {formatCairo(o.due_at)}</p>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
