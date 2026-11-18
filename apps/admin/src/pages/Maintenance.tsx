import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import RepairOrderDialog from '../components/RepairOrderDialog'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, PageHeader } from '../components/ui'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import {
  PART_REQUEST_STATUS, repairNumber, REPAIR_LIST_COLUMNS, REPAIR_STATUS,
  type RepairBranch, type RepairOrder, type RepairPart, type RepairPartLevel, type RepairPartRequest, type RepairStatus,
} from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'

const QUEUES: { key: string; label: string; statuses: RepairStatus[]; hint: string }[] = [
  { key: 'new', label: 'جديدة', statuses: ['received'], hint: 'الكاشير استلمها، لسه ما اتفحصتش' },
  { key: 'diagnosing', label: 'قيد الفحص', statuses: ['diagnosing'], hint: 'محتاجة تشخيص وتسعير' },
  { key: 'quoted', label: 'بانتظار العميل', statuses: ['awaiting_approval'], hint: 'التسعيرة اتبعتت للكاشير' },
  { key: 'parts', label: 'بانتظار قطعة', statuses: ['awaiting_part'], hint: 'القطعة عند المدير أو في الطريق' },
  { key: 'working', label: 'شغل جاري', statuses: ['repairing', 'testing'], hint: 'إصلاح واختبار' },
  { key: 'done', label: 'خلصت', statuses: ['ready', 'cancelled', 'unrepairable'], hint: 'جاهزة أو راجعة للعميل' },
]

export default function Maintenance() {
  const { hasRole } = useAuth()
  const canManage = hasRole('owner', 'manager')
  const [tab, setTab] = useState<'work' | 'requests' | 'parts'>('work')
  const requests = useQuery({
    queryKey: ['maintenance', 'requests'],
    refetchInterval: 30_000,
    queryFn: () => loadRequests(),
  })
  const pending = requests.data?.filter((request) => request.status === 'pending').length ?? 0
  const tabs = [
    { key: 'work' as const, label: 'أجهزة الصيانة' },
    { key: 'requests' as const, label: `طلبات القطع${pending ? ` (${pending})` : ''}` },
    ...(canManage ? [{ key: 'parts' as const, label: 'قطع الغيار والمخزون' }] : []),
  ]
  return (
    <div>
      <PageHeader title="لوحة الصيانة" subtitle="الفني يفحص الجهاز ويسعّره، والمدير يوافق على القطع الناقصة، والكاشير يبلّغ العميل." />
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${tab === item.key ? 'border-accent btn-gel' : 'border-line bg-surface'}`}>{item.label}</button>)}
      </div>
      {tab === 'work' && <WorkQueue />}
      {tab === 'requests' && <PartRequests query={requests} canManage={canManage} />}
      {tab === 'parts' && canManage && <PartsCatalog />}
    </div>
  )
}

async function loadRequests() {
  const { data, error } = await supabase.from('repair_part_requests')
    .select('id,order_id,branch_id,part_id,qty,status,requested_at,decision_note,repair_parts(name),repair_orders(order_number,device_model)')
    .in('status', ['pending', 'approved']).order('requested_at', { ascending: true }).limit(200)
  if (error) throw error
  return data as unknown as RepairPartRequest[]
}

function WorkQueue() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [queue, setQueue] = useState('new')
  const [selected, setSelected] = useState<string | null>(null)
  const branches = useQuery({
    queryKey: ['repair-branches', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('repair_branches')
      if (error) throw error
      return data as RepairBranch[]
    },
  })
  const orders = useQuery({
    queryKey: ['maintenance', 'orders', userId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_orders').select(REPAIR_LIST_COLUMNS)
        .is('delivered_at', null).order('order_number', { ascending: false }).limit(300)
      if (error) throw error
      return data as RepairOrder[]
    },
  })
  const all = orders.data ?? []
  const current = QUEUES.find((item) => item.key === queue) ?? QUEUES[0]
  const rows = all.filter((order) => current.statuses.includes(order.status))
  if (orders.isLoading || branches.isLoading) return <State kind="loading" />
  if (orders.isError || branches.isError) return <State kind="error" text="تعذّر تحميل الصيانة. تأكد من تطبيق آخر تحديث لقاعدة البيانات."
    action={<Button onClick={() => { void orders.refetch(); void branches.refetch() }}>حاول تاني</Button>} />

  return <>
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {QUEUES.map((item) => {
        const count = all.filter((order) => item.statuses.includes(order.status)).length
        return <button key={item.key} onClick={() => setQueue(item.key)} aria-pressed={queue === item.key}
          className={`rounded-2xl border p-3 text-start transition ${queue === item.key ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:bg-bg'}`}>
          <span className="block text-2xl font-bold">{count}</span>
          <span className="block text-sm font-medium">{item.label}</span>
          <span className="block text-xs text-muted">{item.hint}</span>
        </button>
      })}
    </div>
    {rows.length === 0 ? <State kind="empty" title="مفيش أجهزة هنا دلوقتي" /> : <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['الأمر والجهاز', 'العميل', 'الحالة', 'الفني', 'التكلفة', 'موعد التسليم'].map((label) => <th key={label} scope="col" className="p-3 text-start font-medium">{label}</th>)}
        </tr></thead>
        <tbody>{rows.map((order) => <tr key={order.id} className="border-b border-line last:border-0">
          <td className="p-3">
            <Button small onClick={() => setSelected(order.id)} aria-label={`فتح أمر ${repairNumber(order.order_number)}`}><bdi>{repairNumber(order.order_number)}</bdi></Button>
            <p className="mt-1" dir="auto">{order.device_model}</p>
          </td>
          <td className="p-3" dir="auto">{order.customer_name}</td>
          <td className="p-3"><Chip tone={order.status === 'ready' ? 'ok' : 'info'}>{REPAIR_STATUS[order.status]}</Chip></td>
          <td className="p-3" dir="auto">{order.technician || 'غير محدد'}</td>
          <td className="p-3">{order.quoted_at ? formatEGP(toMinor(order.quote_total)) : '—'}</td>
          <td className="p-3">{order.due_at ? formatCairo(order.due_at) : 'غير محدد'}</td>
        </tr>)}</tbody>
      </table>
    </Card>}
    {selected && <RepairOrderDialog id={selected} branches={branches.data ?? []} onClose={() => setSelected(null)} />}
  </>
}

function PartRequests({ query, canManage }: { query: ReturnType<typeof useQuery<RepairPartRequest[]>>; canManage: boolean }) {
  const client = useQueryClient()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const act = useMutation({
    mutationFn: async (input: { id: string; action: 'approved' | 'rejected' | 'receive' }) => {
      const { error } = input.action === 'receive'
        ? await supabase.rpc('receive_repair_part_request', { p_request: input.id })
        : await supabase.rpc('decide_repair_part_request', { p_request: input.id, p_decision: input.action, p_note: notes[input.id] ?? '' })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['maintenance'] }), client.invalidateQueries({ queryKey: ['repairs'] }),
        client.invalidateQueries({ queryKey: ['repair-part-levels'] }),
      ])
    },
  })
  if (query.isLoading) return <State kind="loading" />
  if (query.isError) return <State kind="error" text="تعذّر تحميل طلبات القطع." action={<Button onClick={() => void query.refetch()}>حاول تاني</Button>} />
  if (!query.data?.length) return <State kind="empty" title="مفيش طلبات قطع مفتوحة" />
  return <div className="space-y-3">
    <ErrorText error={act.error} />
    {query.data.map((request) => <Card key={request.id} className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold" dir="auto">{request.repair_parts?.name} × {request.qty}</h3>
        <Chip tone={request.status === 'pending' ? 'warn' : 'info'}>{PART_REQUEST_STATUS[request.status]}</Chip>
      </div>
      <p className="text-sm text-muted" dir="auto">
        لجهاز {request.repair_orders?.device_model} · <bdi>{request.repair_orders ? repairNumber(request.repair_orders.order_number) : ''}</bdi> · {formatCairo(request.requested_at)}
      </p>
      {canManage && request.status === 'pending' && <div className="flex flex-wrap items-end gap-2">
        <Field label="ملاحظة (إلزامية عند الرفض)" className="min-w-48 flex-1">
          <input className={inputCls} maxLength={500} value={notes[request.id] ?? ''} onChange={(event) => setNotes({ ...notes, [request.id]: event.target.value })} />
        </Field>
        <Button variant="danger" disabled={act.isPending || !(notes[request.id] ?? '').trim()} onClick={() => act.mutate({ id: request.id, action: 'rejected' })}>رفض</Button>
        <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate({ id: request.id, action: 'approved' })}>موافقة</Button>
      </div>}
      {canManage && request.status === 'approved' &&
        <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate({ id: request.id, action: 'receive' })}>استلمت القطعة (تضاف للمخزن وتتصرف على الجهاز)</Button>}
    </Card>)}
  </div>
}

function PartsCatalog() {
  const client = useQueryClient()
  const { hasRole } = useAuth()
  const canSeeCost = hasRole('owner', 'manager', 'accountant')   // cost is hidden from cashiers and technicians by the database
  const canSetCost = hasRole('owner', 'manager')
  const costs = useQuery({
    queryKey: ['repair-part-costs'],
    enabled: canSeeCost,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('repair_part_costs')
      if (error) throw error
      return new Map((data as { part_id: string; cost: number | string }[]).map((r) => [r.part_id, toMinor(r.cost)]))
    },
  })
  const [branchId, setBranchId] = useState('')
  const [editing, setEditing] = useState<RepairPart | null>(null)
  const branches = useQuery({
    queryKey: ['all-branches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('branches').select('id,name').eq('is_active', true).order('name')
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })
  const activeBranch = branchId || branches.data?.[0]?.id || ''
  const parts = useQuery({
    queryKey: ['repair-parts-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_parts').select('id,name,sku,unit_price,is_active').order('name')
      if (error) throw error
      return data as RepairPart[]
    },
  })
  const levels = useQuery({
    queryKey: ['repair-part-levels', activeBranch],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_part_levels').select('part_id,on_hand').eq('branch_id', activeBranch)
      if (error) throw error
      return data as Pick<RepairPartLevel, 'part_id' | 'on_hand'>[]
    },
  })
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ['repair-parts'] }), client.invalidateQueries({ queryKey: ['repair-parts-all'] }),
    client.invalidateQueries({ queryKey: ['repair-part-levels'] }), client.invalidateQueries({ queryKey: ['repair-part-costs'] }),
  ])
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      let price: string
      try { price = fromMinor(toMinor(String(form.get('price') ?? '').trim())) } catch { throw new Error('اكتب سعر البيع بشكل صحيح (أرقام فقط).') }
      let cost: string | null = null
      const rawCost = String(form.get('cost') ?? '').trim()
      if (canSetCost && rawCost) {
        try { cost = fromMinor(toMinor(rawCost)) } catch { throw new Error('اكتب تكلفة القطعة بشكل صحيح (أرقام فقط).') }
      }
      const id = editing?.id ?? crypto.randomUUID()
      const { error } = await supabase.rpc('save_repair_part', {
        p_id: id, p_name: form.get('name'), p_sku: form.get('sku'),
        p_price: price, p_active: form.get('active') === 'on',
      })
      if (error) throw error
      if (cost !== null) {
        const { error: costError } = await supabase.rpc('set_repair_part_cost', { p_part: id, p_cost: Number(cost) })
        if (costError) throw costError
      }
    },
    onSuccess: async () => { setEditing(null); await refresh() },
  })
  const adjust = useMutation({
    mutationFn: async (input: { part: string; qty: number; reason: 'receipt' | 'adjustment'; note: string }) => {
      const { error } = await supabase.rpc('adjust_repair_part_stock', {
        p_part: input.part, p_branch: activeBranch, p_qty: input.qty, p_reason: input.reason, p_note: input.note,
      })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save.mutate(new FormData(event.currentTarget))
  }
  return <div className="space-y-4">
    <Card className="p-4">
      <form key={editing?.id ?? 'new'} onSubmit={submit}
        className={`grid gap-3 sm:items-end ${canSetCost ? 'sm:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]' : 'sm:grid-cols-[2fr_1fr_1fr_auto_auto]'}`}>
        <Field label={editing ? 'تعديل قطعة' : 'قطعة غيار جديدة'}><input className={inputCls} name="name" required maxLength={120} defaultValue={editing?.name} placeholder="مثلاً: شاشة آيفون 11" /></Field>
        <Field label="SKU (اختياري)"><input className={inputCls} name="sku" maxLength={60} dir="ltr" defaultValue={editing?.sku ?? ''} /></Field>
        <Field label="سعر البيع للعميل"><input className={inputCls} name="price" required inputMode="decimal" dir="ltr" defaultValue={editing ? fromMinor(toMinor(editing.unit_price)) : ''} /></Field>
        {canSetCost && <Field label="تكلفة القطعة علينا" hint="بتتسجل على الأمر وقت الإضافة. تغييرها ما بيغيّرش أوامر قديمة.">
          <input className={inputCls} name="cost" inputMode="decimal" dir="ltr" placeholder="سيبها فاضية لو ما اتغيرتش"
            defaultValue={editing && costs.data?.has(editing.id) ? fromMinor(costs.data.get(editing.id) ?? 0) : ''} /></Field>}
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={editing?.is_active ?? true} /> مفعّلة</label>
        <div className="flex gap-2">
          <Button variant="primary" disabled={save.isPending}>{editing ? 'حفظ' : 'إضافة'}</Button>
          {editing && <Button type="button" onClick={() => setEditing(null)}>إلغاء</Button>}
        </div>
      </form>
      <div className="mt-2"><ErrorText error={save.error} /></div>
    </Card>
    <Field label="فرع المخزون" className="max-w-xs">
      <select className={inputCls} value={activeBranch} onChange={(event) => setBranchId(event.target.value)}>
        {branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
    </Field>
    <ErrorText error={adjust.error} />
    {parts.isLoading && <State kind="loading" />}
    {parts.isError && <State kind="error" text="تعذّر تحميل قطع الغيار." action={<Button onClick={() => void parts.refetch()}>حاول تاني</Button>} />}
    {parts.isSuccess && parts.data.length === 0 && <State kind="empty" title="لسه ما سجلتش قطع غيار" />}
    {!!parts.data?.length && <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['القطعة', 'السعر', ...(canSeeCost ? ['التكلفة'] : []), 'المتاح بالفرع', 'حركة مخزون', ''].map((label, index) => <th key={index} scope="col" className="p-3 text-start font-medium">{label}</th>)}
        </tr></thead>
        <tbody>{parts.data.map((part) => <PartRow key={part.id} part={part} cost={canSeeCost ? (costs.data?.get(part.id) ?? 0) : null} onHand={levels.data?.find((level) => level.part_id === part.id)?.on_hand ?? 0}
          busy={adjust.isPending} onEdit={() => setEditing(part)} onAdjust={(qty, reason, note) => adjust.mutate({ part: part.id, qty, reason, note })} />)}</tbody>
      </table>
    </Card>}
  </div>
}

function PartRow({ part, cost, onHand, busy, onEdit, onAdjust }: {
  part: RepairPart; cost: number | null; onHand: number; busy: boolean; onEdit: () => void
  onAdjust: (qty: number, reason: 'receipt' | 'adjustment', note: string) => void
}) {
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const value = Number.parseInt(qty, 10)
  const valid = Number.isInteger(value) && value !== 0
  return <tr className="border-b border-line last:border-0">
    <td className="p-3"><p dir="auto">{part.name}</p>{part.sku && <bdi className="text-xs text-muted">{part.sku}</bdi>} {!part.is_active && <Chip>موقوفة</Chip>}</td>
    <td className="p-3">{formatEGP(toMinor(part.unit_price))}</td>
    {cost !== null && <td className="p-3">{cost > 0 ? formatEGP(cost) : <span className="text-muted">لم تُسجَّل</span>}</td>}
    <td className="p-3"><Chip tone={onHand > 0 ? 'ok' : 'danger'}>{onHand}</Chip></td>
    <td className="p-3"><div className="flex flex-wrap gap-2">
      <input aria-label="الكمية" className={`${inputCls} !w-20`} inputMode="numeric" dir="ltr" placeholder="الكمية" value={qty} onChange={(event) => setQty(event.target.value)} />
      <input aria-label="ملاحظة" className={`${inputCls} !w-40`} maxLength={300} placeholder="ملاحظة" value={note} onChange={(event) => setNote(event.target.value)} />
      <Button small disabled={busy || !valid || value < 0} onClick={() => { onAdjust(value, 'receipt', note); setQty(''); setNote('') }}>وارد</Button>
      <Button small disabled={busy || !valid || !note.trim()} onClick={() => { onAdjust(value, 'adjustment', note); setQty(''); setNote('') }}>تسوية ±</Button>
    </div></td>
    <td className="p-3"><Button small onClick={onEdit}>تعديل</Button></td>
  </tr>
}
