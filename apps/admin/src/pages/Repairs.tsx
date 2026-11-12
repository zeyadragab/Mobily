import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import CombinedInvoice from '../components/CombinedInvoice'
import RepairBoard from '../components/RepairBoard'
import RepairHistory from '../components/RepairHistory'
import RepairIntake from '../components/RepairIntake'
import RepairOrderDialog from '../components/RepairOrderDialog'
import RepairStatement from '../components/RepairStatement'
import RepairTemplates from '../components/RepairTemplates'
import WarrantyChecker from '../components/WarrantyChecker'
import { State } from '../components/State'
import { Button, Card, Chip, Field, inputCls, PageHeader } from '../components/ui'
import { needsCustomerContact, repairNumber, REPAIR_LIST_COLUMNS, REPAIR_STATUS, type RepairBranch, type RepairOrder } from '../lib/repairs'
import { formatEGP, toMinor } from '../lib/money'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, formatCairo } from '../lib/time'

const PAGE_SIZE = 30
const FILTERS = {
  inform: 'بانتظار إبلاغ العميل',
  open: 'الأجهزة اللي في العهدة',
  today: 'موعدها النهارده',
  overdue: 'متأخرة عن الموعد',
  all: 'كل الأوامر',
  ...REPAIR_STATUS,
}

export default function Repairs() {
  const { session } = useAuth()
  const userId = session?.user.id
  const client = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const [filter, setFilter] = useState('open')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [intake, setIntake] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'board' | 'list' | 'history' | 'statement' | 'templates'>('board')
  const [warranty, setWarranty] = useState(false)
  const [combined, setCombined] = useState(false)
  const TABS = [
    { key: 'board', label: 'لوحة التذاكر' }, { key: 'list', label: 'قائمة الأوامر' }, { key: 'history', label: 'سجل العمليات' },
    { key: 'statement', label: 'كشف حساب' }, { key: 'templates', label: 'قوالب الصيانة' },
  ] as const
  const branches = useQuery({
    queryKey: ['repair-branches', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('repair_branches')
      if (error) throw error
      return data as RepairBranch[]
    },
  })
  const availableBranches = branches.data ?? []
  const receivingBranches = availableBranches.filter((branch) => branch.can_receive)
  const orders = useQuery({
    queryKey: ['repairs', userId, branchId, filter, search, page],
    refetchInterval: 60_000,
    enabled: tab === 'list',
    queryFn: async () => {
      const checkedAt = new Date()
      let query = supabase.from('repair_orders').select(REPAIR_LIST_COLUMNS, { count: 'exact' })
      if (branchId) query = query.eq('branch_id', branchId)
      if (filter === 'open' || filter === 'today' || filter === 'overdue') query = query.is('delivered_at', null)
      if (filter === 'today') query = query.eq('due_day', cairoBusinessDate(checkedAt))
      else if (filter === 'overdue') query = query.lt('due_at', checkedAt.toISOString())
      else if (filter === 'inform') query = query.eq('status', 'awaiting_approval').not('quoted_at', 'is', null).is('customer_informed_at', null)
      else if (filter !== 'open' && filter !== 'all') query = query.eq('status', filter)
      const term = search.trim().replace(/[\\%_*]/g, '\\$&')
      if (term) query = query.ilike('search_text', `%${term}%`)
      const { data, error, count } = await query.order('order_number', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (error) throw error
      return { rows: data as RepairOrder[], count: count ?? 0, checkedAt: checkedAt.getTime() }
    },
  })
  const rows = orders.data?.rows ?? []
  const total = orders.data?.count ?? 0
  const checkedAt = orders.data?.checkedAt ?? 0

  return (
    <div>
      <PageHeader title="الصيانة" subtitle="استلام أجهزة العملاء، ومتابعة العهدة وحالة الإصلاح ومواعيد التسليم."
        actions={<>
          <Button onClick={() => setWarranty(true)}>مدقق الضمان</Button>
          <Button onClick={() => setCombined(true)}>فاتورة تجميعية</Button>
          {receivingBranches.length > 0 && <Button variant="primary" onClick={() => setIntake(true)}>+ استلام جهاز</Button>}
        </>} />
      <div role="tablist" aria-label="أقسام الصيانة" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${tab === item.key ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface'}`}>{item.label}</button>)}
      </div>
      {tab === 'board' && <RepairBoard branchId={branchId} onOpen={setSelected} />}
      {tab === 'history' && <RepairHistory onOpen={setSelected} />}
      {tab === 'statement' && <RepairStatement onOpen={setSelected} />}
      {tab === 'templates' && <RepairTemplates />}
      {tab === 'list' && <>
      <Card className="mb-4 grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr]">
        <Field label="بحث في أوامر الصيانة">
          <input className={inputCls} placeholder="رقم الأمر، العميل، رقم الموبايل، السيريال أو IMEI" maxLength={120}
            value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} />
        </Field>
        <Field label="الفرع">
          <select className={inputCls} value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(0) }}>
            <option value="">كل الفروع المتاحة</option>
            {availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        <Field label="الحالة والموعد">
          <select className={inputCls} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0) }}>
            {Object.entries(FILTERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </Card>
      {(orders.isLoading || branches.isLoading) && <State kind="loading" />}
      {(orders.isError || branches.isError) && <State kind="error" text="تعذّر تحميل الصيانة. تأكد من تطبيق آخر تحديث لقاعدة البيانات."
        action={<Button onClick={() => { void orders.refetch(); void branches.refetch() }}>حاول تاني</Button>} />}
      {orders.isSuccess && branches.isSuccess && rows.length === 0 && <State kind="empty" title="مفيش أوامر صيانة مطابقة" />}
      {rows.length > 0 && <Card className="overflow-x-auto">
        <table className="w-full min-w-[690px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['الأمر والجهاز', 'العميل', 'الحالة', 'الفني والفرع', 'موعد التسليم'].map((label) => <th key={label} scope="col" className="p-3 text-start font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{rows.map((order) => {
            const late = !order.delivered_at && order.due_at && new Date(order.due_at).getTime() < checkedAt
            return <tr key={order.id} className="border-b border-line last:border-0">
              <td className="p-3">
                <Button small onClick={() => setSelected(order.id)} aria-label={`فتح أمر ${repairNumber(order.order_number)}`}><bdi>{repairNumber(order.order_number)}</bdi></Button>
                <p className="mt-1" dir="auto">{order.device_model}</p>
              </td>
              <td className="p-3"><p dir="auto">{order.customer_name}</p><bdi className="text-xs text-muted">{order.customer_phone}</bdi></td>
              <td className="p-3">
                <Chip tone={order.status === 'ready' || order.status === 'delivered' ? 'ok' : 'info'}>{REPAIR_STATUS[order.status]}</Chip>
                {needsCustomerContact(order) && <p className="mt-1"><Chip tone="warn">اتصل بالعميل · {formatEGP(toMinor(order.quote_total))}</Chip></p>}
              </td>
              <td className="p-3"><p dir="auto">{order.technician || 'غير محدد'}</p><p className="text-xs text-muted">{availableBranches.find((branch) => branch.id === order.branch_id)?.name}</p></td>
              <td className="p-3">
                <p>{order.due_at ? formatCairo(order.due_at) : 'لسه غير محدد'}</p>
                {late && <Chip tone="danger">متأخر</Chip>}
              </td>
            </tr>
          })}</tbody>
        </table>
      </Card>}
      {(page > 0 || total > PAGE_SIZE) && <div className="mt-4 flex items-center justify-end gap-3 text-sm">
        <Button small disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</Button>
        <span>صفحة {page + 1}</span>
        <Button small disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>التالي</Button>
      </div>}
      </>}
      {warranty && <WarrantyChecker onClose={() => setWarranty(false)} />}
      {combined && <CombinedInvoice onClose={() => setCombined(false)} />}
      {intake && <RepairIntake branches={receivingBranches} branchId={receivingBranches.some((branch) => branch.id === branchId) ? branchId : ''}
        onClose={() => setIntake(false)} onReceived={(id) => {
          setIntake(false)
          setSelected(id)
          void client.invalidateQueries({ queryKey: ['repairs'] })
        }} />}
      {selected && <RepairOrderDialog id={selected} branches={availableBranches} onClose={() => setSelected(null)} />}
    </div>
  )
}
