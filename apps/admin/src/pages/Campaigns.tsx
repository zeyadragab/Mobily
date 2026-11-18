import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { whatsappDigits } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'

const AUDIENCE = {
  all: 'كل العملاء',
  regular: 'العملاء العاديون',
  vip: 'العملاء المميزون',
  wholesale: 'عملاء الجملة',
  technician: 'فنيو الصيانة',
  debtors: 'عملاء عليهم مديونية',
} as const
type Audience = keyof typeof AUDIENCE

type Campaign = { id: string; name: string; message: string; audience: Audience; created_at: string }
type Recipient = { customer_id: string; sent_at: string | null; customers: { name: string; phone: string; marketing_opt_out: boolean } | null }

/** {الاسم} in the message becomes the customer's name. */
const fill = (msg: string, name: string) => msg.replaceAll('{الاسم}', name)

export default function Campaigns() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<Campaign | null>(null)

  const list = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wa_campaigns').select('id,name,message,audience,created_at').order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as Campaign[]
    },
  })

  return (
    <div>
      <PageHeader title="حملات واتساب" subtitle="رسالة واحدة لمجموعة عملاء. كل محادثة بتتفتح من جهازك وإنت اللي بتضغط إرسال. العميل اللي طلب إيقاف الرسائل مش بيدخل في أي حملة."
        actions={<Button variant="primary" onClick={() => setOpen(true)}>+ حملة جديدة</Button>} />
      {list.isLoading && <State kind="loading" />}
      {list.isError && <State kind="error" text="تعذّر تحميل الحملات. تأكد من تطبيق آخر تحديث لقاعدة البيانات." action={<Button onClick={() => void list.refetch()}>حاول تاني</Button>} />}
      {list.isSuccess && list.data.length === 0 && <State kind="empty" title="لسه مفيش حملات" text="اعمل حملة لعرض جديد أو لتذكير العملاء بالمديونية."
        action={<Button variant="primary" onClick={() => setOpen(true)}>+ حملة جديدة</Button>} />}
      <div className="stagger grid gap-3 sm:grid-cols-2">
        {(list.data ?? []).map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold" dir="auto">{c.name}</p>
              <Chip tone="info">{AUDIENCE[c.audience]}</Chip>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted" dir="auto">{c.message}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted">{formatCairo(c.created_at)}</span>
              <Button small onClick={() => setCurrent(c)}>فتح قائمة الإرسال</Button>
            </div>
          </Card>
        ))}
      </div>
      {open && <NewCampaign onClose={() => setOpen(false)} onDone={() => { setOpen(false); void qc.invalidateQueries({ queryKey: ['campaigns'] }) }} />}
      {current && <SendList campaign={current} onClose={() => setCurrent(null)} />}
    </div>
  )
}

function NewCampaign({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', message: 'أهلًا {الاسم}، ', audience: 'all' as Audience })
  const save = useMutation({
    mutationFn: async () => {
      if (f.name.trim().length < 2) throw new Error('اكتب اسم الحملة.')
      if (f.message.trim().length < 5) throw new Error('اكتب نص الرسالة.')
      const { error } = await supabase.rpc('create_wa_campaign', { p_name: f.name, p_message: f.message, p_audience: f.audience })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title="حملة جديدة"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'إنشاء الحملة'}</Button></>}>
      <div className="space-y-3">
        <ErrorText error={save.error} />
        <Field label="اسم الحملة"><input className={inputCls} dir="auto" autoFocus maxLength={80} placeholder="مثال: عرض رمضان" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="المرسل إليهم">
          <select className={inputCls} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as Audience })}>
            {Object.entries(AUDIENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="نص الرسالة" hint="اكتب {الاسم} في المكان اللي عايز اسم العميل يظهر فيه.">
          <textarea className={`${inputCls} min-h-32`} dir="auto" maxLength={1000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </Field>
        <div className="rounded-xl bg-bg p-3 text-sm">
          <p className="mb-1 text-xs text-muted">معاينة</p>
          <p className="whitespace-pre-wrap" dir="auto">{fill(f.message, 'أحمد')}</p>
        </div>
      </div>
    </Modal>
  )
}

function SendList({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const q = useQuery({
    queryKey: ['campaigns', campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('wa_campaign_recipients').select('customer_id,sent_at,customers(name,phone,marketing_opt_out)').eq('campaign_id', campaign.id).limit(2000)
      if (error) throw error
      return data as unknown as Recipient[]
    },
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['campaigns', campaign.id] })
  const mark = useMutation({
    // The tab is opened in the click itself (a later window.open would be stopped by the popup blocker),
    // and only pointed at WhatsApp once the server accepted the send (opt-out and daily cap are checked there).
    mutationFn: async ({ r, tab }: { r: Recipient; tab: Window | null }) => {
      const { error } = await supabase.rpc('mark_wa_sent', { p_campaign: campaign.id, p_customer: r.customer_id })
      if (error) { tab?.close(); throw error }
      const url = `https://wa.me/${whatsappDigits(r.customers?.phone ?? '')}?text=${encodeURIComponent(fill(campaign.message, r.customers?.name ?? ''))}`
      if (tab) { tab.opener = null; tab.location.href = url } else window.location.href = url
    },
    onSuccess: () => { setErr(null); refresh() },
    onError: setErr,
  })
  const optOut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('set_marketing_opt_out', { p_customer: id, p_out: true })
      if (error) throw error
    },
    onSuccess: refresh,
    onError: setErr,
  })
  const rows = useMemo(() => (q.data ?? []).filter((r) => !term.trim() || `${r.customers?.name} ${r.customers?.phone}`.includes(term.trim())), [q.data, term])
  const sent = (q.data ?? []).filter((r) => r.sent_at).length

  return (
    <Modal open onClose={onClose} title={`قائمة الإرسال · ${campaign.name}`} footer={<Button onClick={onClose}>إغلاق</Button>}>
      <div className="space-y-3">
        <ErrorText error={err} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Chip tone="ok">تم {sent}</Chip><Chip>الباقي {(q.data?.length ?? 0) - sent}</Chip>
          <input aria-label="بحث" className={`${inputCls} !w-auto flex-1`} dir="auto" placeholder="بحث بالاسم أو الرقم" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {q.isLoading && <State kind="loading" />}
        {q.isError && <State kind="error" text="تعذّر تحميل القائمة." />}
        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {rows.map((r) => {
            const stopped = r.customers?.marketing_opt_out
            return (
              <li key={r.customer_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5 text-sm">
                <span className="min-w-0 flex-1" dir="auto">{r.customers?.name} <bdi className="text-xs text-muted">{r.customers?.phone}</bdi></span>
                {stopped ? <Chip tone="warn">أوقف الرسائل</Chip>
                  : r.sent_at ? <Chip tone="ok">تم {formatCairo(r.sent_at)}</Chip>
                  : <>
                    <Button small variant="primary" disabled={mark.isPending} onClick={() => mark.mutate({ r, tab: window.open('', '_blank') })}>فتح واتساب</Button>
                    <Button small disabled={optOut.isPending} onClick={() => optOut.mutate(r.customer_id)}>العميل طلب الإيقاف</Button>
                  </>}
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted">في حد أقصى يومي لعدد الرسائل (من الإعدادات) عشان رقم المحل ما يتحظرش.</p>
      </div>
    </Modal>
  )
}
