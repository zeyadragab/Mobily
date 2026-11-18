import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { Kpi } from '../components/WalletBits'
import { money } from '../lib/installments'
import { formatEGP, toMinor } from '../lib/money'
import { useTaxReminders, type TaxRow } from '../lib/people'
import { downloadCsv, whatsappDigits } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate } from '../lib/time'

const STATUS = { open: 'مفتوح', paid: 'تم السداد', cancelled: 'ملغي' } as const

/** Follow-up list for the import tax on customers' phones. No money moves here: it only reminds the shop who to chase. */
export default function MobileTax() {
  const qc = useQueryClient()
  const today = cairoBusinessDate()
  const reminders = useTaxReminders()
  const [filter, setFilter] = useState<keyof typeof STATUS | 'all'>('open')
  const [find, setFind] = useState('')
  const [form, setForm] = useState<TaxRow | 'new' | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['tax-reminders'] })
  const setStatus = useMutation({
    mutationFn: async (v: { id: string; status: keyof typeof STATUS }) => {
      const { error } = await supabase.rpc('set_tax_reminder_status', { p_id: v.id, p_status: v.status })
      if (error) throw error
    },
    onSuccess: refresh,
  })

  const all = reminders.data ?? []
  const open = all.filter((r) => r.status === 'open')
  const overdue = open.filter((r) => r.due_date <= today)
  const q = find.trim().toLowerCase()
  const rows = all.filter((r) => (filter === 'all' || r.status === filter)
    && (!q || `${r.customer_name} ${r.phone ?? ''} ${r.device ?? ''} ${r.imei ?? ''}`.toLowerCase().includes(q)))

  return (
    <div>
      <PageHeader title="ضريبة الموبايل" subtitle="قائمة متابعة بس: مين عليه ضريبة جهاز مستورد وميعادها. مفيش فلوس بتتحرك من هنا."
        actions={<>
          <Button onClick={() => downloadCsv('mobile-tax.csv', ['العميل', 'الموبايل', 'الجهاز', 'IMEI', 'المبلغ', 'الميعاد', 'الحالة', 'ملاحظة'],
            all.map((r) => [r.customer_name, r.phone, r.device, r.imei, r.amount, r.due_date, STATUS[r.status], r.note]))}>تصدير CSV</Button>
          <Button variant="primary" onClick={() => setForm('new')}>تذكير جديد</Button>
        </>} />
      <ErrorText error={setStatus.error} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="تذكيرات مفتوحة" value={String(open.length)} />
        <Kpi label="متأخرة أو مستحقة اليوم" value={String(overdue.length)} tone={overdue.length ? 'danger' : undefined} />
        <Kpi label="إجمالي المفتوح" value={formatEGP(open.reduce((s, r) => s + toMinor(r.amount), 0))} tone="warn" />
        <Kpi label="تم سدادها" value={String(all.filter((r) => r.status === 'paid').length)} tone="ok" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['open', 'paid', 'cancelled', 'all'] as const).map((f) => (
          <Button key={f} small variant={filter === f ? 'primary' : 'ghost'} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'الكل' : STATUS[f]}</Button>
        ))}
        <input aria-label="بحث" className={`${inputCls} !w-64`} dir="auto" placeholder="ابحث بالاسم أو الموبايل أو IMEI" value={find} onChange={(e) => setFind(e.target.value)} />
      </div>

      {reminders.isLoading && <State kind="loading" />}
      {reminders.isError && <State kind="error" text="تعذّر تحميل التذكيرات." action={<Button onClick={() => void reminders.refetch()}>حاول تاني</Button>} />}
      {reminders.isSuccess && rows.length === 0 && <State kind="empty" title="لا توجد تذكيرات" />}
      {rows.length > 0 && <Card className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['العميل', 'الجهاز', 'المبلغ', 'الميعاد', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r) => {
          const late = r.status === 'open' && r.due_date <= today
          const wa = r.phone ? `https://wa.me/${whatsappDigits(r.phone)}?text=${encodeURIComponent(
            `أهلاً ${r.customer_name}، تذكير بميعاد سداد ضريبة الموبايل${r.device ? ` (${r.device})` : ''} بتاريخ ${r.due_date}${toMinor(r.amount) ? ` والمبلغ ${formatEGP(toMinor(r.amount))}` : ''}.`)}` : null
          return <tr key={r.id} className="border-b border-line last:border-0">
            <td className="p-3"><p dir="auto">{r.customer_name}</p>{r.phone && <bdi className="text-xs text-muted">{r.phone}</bdi>}</td>
            <td className="p-3" dir="auto">{r.device ?? '—'}{r.imei && <p className="text-xs text-muted"><bdi>{r.imei}</bdi></p>}{r.note && <p className="text-xs text-muted">{r.note}</p>}</td>
            <td className="p-3">{toMinor(r.amount) ? formatEGP(toMinor(r.amount)) : '—'}</td>
            <td className="p-3"><bdi>{r.due_date}</bdi>{late && <span className="ms-2"><Chip tone="danger">{r.due_date < today ? 'متأخر' : 'النهارده'}</Chip></span>}</td>
            <td className="p-3"><Chip tone={r.status === 'paid' ? 'ok' : r.status === 'cancelled' ? 'neutral' : 'warn'}>{STATUS[r.status]}</Chip></td>
            <td className="p-3"><div className="flex flex-wrap gap-2">
              {wa && r.status === 'open' && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-[10px] border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow-soft hover:bg-bg">واتساب</a>}
              {r.status === 'open' && <Button small variant="primary" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'paid' })}>تم السداد</Button>}
              {r.status === 'open' && <Button small onClick={() => setForm(r)}>تعديل</Button>}
              {r.status !== 'open' && <Button small disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'open' })}>إعادة فتح</Button>}
              {r.status !== 'cancelled' && <Button small variant="danger" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: 'cancelled' })}>إلغاء</Button>}
            </div></td>
          </tr>
        })}</tbody>
      </table></Card>}

      {form && <ReminderForm row={form === 'new' ? null : form} onClose={() => setForm(null)} onDone={async () => { setForm(null); await refresh() }} />}
    </div>
  )
}

function ReminderForm({ row, onClose, onDone }: { row: TaxRow | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(row?.customer_name ?? '')
  const [phone, setPhone] = useState(row?.phone ?? '')
  const [device, setDevice] = useState(row?.device ?? '')
  const [imei, setImei] = useState(row?.imei ?? '')
  const [amount, setAmount] = useState(row ? String(row.amount) : '')
  const [due, setDue] = useState(row?.due_date ?? cairoBusinessDate())
  const [note, setNote] = useState(row?.note ?? '')
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('save_tax_reminder', {
        p_id: row?.id ?? null, p_customer_name: name.trim(), p_phone: phone.trim() || null, p_device: device.trim() || null,
        p_imei: imei.trim() || null, p_amount: money(amount, { zero: true }), p_due_date: due, p_note: note.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title={row ? 'تعديل تذكير' : 'تذكير ضريبة جديد'}
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="اسم العميل"><input className={inputCls} dir="auto" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="الموبايل"><input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="الجهاز"><input className={inputCls} dir="auto" maxLength={120} value={device} onChange={(e) => setDevice(e.target.value)} /></Field>
        <Field label="IMEI (15 رقم)"><input className={inputCls} dir="ltr" inputMode="numeric" maxLength={15} value={imei} onChange={(e) => setImei(e.target.value)} /></Field>
        <Field label="مبلغ الضريبة"><input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="ميعاد السداد"><input className={inputCls} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="ملاحظة" className="sm:col-span-2"><input className={inputCls} dir="auto" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
