import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useProducts, useStock, variantLabel } from '../lib/data'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'

type Trace = {
  serial: string; status: string; item: string; cost: number | null; supplier: string | null; po_number: string | null
  received_at: string; sold_at: string | null; warranty_until: string | null; invoice_number: string | null
  online_order: string | null; customer: string | null; events: { event: string; at: string; detail: string | null }[]
}
type Dev = { id: string; serial: string; status: string; cost: number | string; received_at: string; warranty_until: string | null; variant_id: string }

const STATUS_AR: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'danger' }> = {
  in_stock: { label: 'بالمخزون', tone: 'ok' }, sold: { label: 'مباع', tone: 'info' },
  inspection: { label: 'تحت الفحص', tone: 'warn' }, damaged: { label: 'تالف', tone: 'danger' },
}
const EVENT_AR: Record<string, string> = {
  registered: 'تم تسجيله', received: 'استلام من المورد', sold: 'بيع', returned: 'مرتجع من العميل',
  inspected_sellable: 'فحص: صالح للبيع', inspected_damaged: 'فحص: تالف', written_off: 'إتلاف',
}

export default function Devices() {
  const { hasRole } = useAuth()
  const canSeeAll = hasRole('owner', 'manager', 'accountant', 'warehouse')
  const canRegister = hasRole('owner', 'manager', 'warehouse')
  const canWriteOff = hasRole('owner', 'manager')
  const qc = useQueryClient()
  const products = useProducts()
  const stock = useStock()

  const [serial, setSerial] = useState('')
  const [trace, setTrace] = useState<Trace | null | undefined>(undefined)
  const [lookupErr, setLookupErr] = useState<unknown>(null)
  const [registering, setRegistering] = useState(false)
  const [status, setStatus] = useState('in_stock')
  const [search, setSearch] = useState('')
  const [writeOff, setWriteOff] = useState<Dev | null>(null)
  const [reason, setReason] = useState('')

  const lookup = useMutation({
    mutationFn: async (s: string) => {
      const { data, error } = await supabase.rpc('trace_device', { p_serial: s })
      if (error) throw error
      return data as Trace | null
    },
    onSuccess: setTrace,
    onError: (e) => { setLookupErr(e); setTrace(undefined) },
  })
  function submit(e: FormEvent) { e.preventDefault(); setLookupErr(null); if (serial.trim()) lookup.mutate(serial) }

  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products.data ?? []) for (const v of p.variants) m.set(v.id, variantLabel(p, v))
    return m
  }, [products.data])

  const devs = useQuery({
    queryKey: ['devices'],
    enabled: canSeeAll,
    queryFn: async () => {
      const { data, error } = await supabase.from('devices').select('id,serial,status,cost,received_at,warranty_until,variant_id').order('received_at', { ascending: false }).limit(2000)
      if (error) throw error
      return data as Dev[]
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toUpperCase()
    return (devs.data ?? []).filter((d) => (status === 'all' || d.status === status) && (!s || d.serial.includes(s) || (names.get(d.variant_id) ?? '').toUpperCase().includes(s))).slice(0, 300)
  }, [devs.data, status, search, names])

  // tracked items whose stock is not yet linked to serial numbers
  const unlinked = useMemo(() => {
    const out: { id: string; label: string; n: number }[] = []
    for (const p of products.data ?? []) {
      if (!p.track_serial) continue
      for (const v of p.variants) {
        const inStock = (devs.data ?? []).filter((d) => d.variant_id === v.id && d.status === 'in_stock').length
        const n = (stock.data?.get(v.id) ?? 0) - inStock
        if (n > 0) out.push({ id: v.id, label: variantLabel(p, v), n })
      }
    }
    return out
  }, [products.data, stock.data, devs.data])

  const off = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('write_off_device', { p_device: writeOff!.id, p_reason: reason })
      if (error) throw error
    },
    onSuccess: () => { setWriteOff(null); setReason(''); ['devices', 'stock', 'movements'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })) },
  })

  const warranty = (iso: string | null) => (!iso ? null : iso >= new Date().toISOString().slice(0, 10) ? <Chip tone="ok">ساري حتى {iso}</Chip> : <Chip tone="danger">انتهى {iso}</Chip>)

  return (
    <div>
      <PageHeader title="الأجهزة (IMEI / السيريال)" subtitle="تتبّع كل جهاز: من أي مورد ووصل بكام، ومن اشتراه، والضمان، وأي مرتجع."
        actions={canRegister && <Button variant="primary" onClick={() => setRegistering(true)}>+ تسجيل أجهزة</Button>} />

      <Card className="mb-6 p-4">
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input className={`${inputCls} min-w-0 flex-1 sm:max-w-md`} dir="ltr" placeholder="ابحث برقم IMEI أو السيريال" aria-label="IMEI أو السيريال" value={serial} onChange={(e) => setSerial(e.target.value)} />
          <Button variant="primary" disabled={lookup.isPending || !serial.trim()}>{lookup.isPending ? '…' : 'تتبّع'}</Button>
        </form>
        <div className="mt-3"><ErrorText error={lookupErr} /></div>
        {trace === null && <p className="mt-3 text-sm text-muted">لا يوجد جهاز بهذا الرقم.</p>}
        {trace && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-lg font-bold" dir="ltr">{trace.serial}</h2>
              <Chip tone={STATUS_AR[trace.status]?.tone ?? 'info'}>{STATUS_AR[trace.status]?.label ?? trace.status}</Chip>
              {warranty(trace.warranty_until)}
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">الصنف</dt><dd dir="auto">{trace.item}</dd></div>
              <div><dt className="text-xs text-muted">وصل المخزن</dt><dd>{formatCairo(trace.received_at)}</dd></div>
              {trace.supplier && <div><dt className="text-xs text-muted">المورد</dt><dd dir="auto">{trace.supplier}{trace.po_number ? ` · ${trace.po_number}` : ''}</dd></div>}
              {trace.cost != null && <div><dt className="text-xs text-muted">تكلفة الجهاز</dt><dd>{formatEGP(toMinor(trace.cost))}</dd></div>}
              {trace.sold_at && <div><dt className="text-xs text-muted">تاريخ البيع</dt><dd>{formatCairo(trace.sold_at)}{trace.invoice_number ? ` · فاتورة ${trace.invoice_number}` : trace.online_order ? ` · طلب ${trace.online_order}` : ''}</dd></div>}
              {trace.customer && <div><dt className="text-xs text-muted">العميل</dt><dd dir="auto">{trace.customer}</dd></div>}
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-semibold">سجل الجهاز</h3>
              <ol className="space-y-1 border-s border-line ps-4 text-sm">
                {trace.events.map((e, i) => (
                  <li key={i} className="relative"><span className="absolute -start-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
                    <span className="font-medium">{EVENT_AR[e.event] ?? e.event}</span><span className="text-muted"> · {formatCairo(e.at)}{e.detail ? ` · ${e.detail}` : ''}</span></li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Card>

      {canSeeAll && unlinked.length > 0 && (
        <div role="status" className="mb-6 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <p className="font-semibold text-warn">مخزون بدون سيريال (لن يمكن بيعه قبل تسجيل السيريال)</p>
          <ul className="mt-1 space-y-0.5">{unlinked.map((u) => <li key={u.id} dir="auto">{u.label}: {u.n} وحدة</li>)}</ul>
          {canRegister && <Button small className="mt-2" onClick={() => setRegistering(true)}>تسجيل السيريالات الآن</Button>}
        </div>
      )}

      {canSeeAll && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث بالسيريال أو الصنف" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={`${inputCls} sm:w-44`} aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">كل الحالات</option>
              {Object.entries(STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {devs.isLoading && <State kind="loading" />}
          {devs.isError && <State kind="error" text="تعذّر تحميل الأجهزة. تأكد من تطبيق آخر تحديثات قاعدة البيانات." />}
          {devs.data && rows.length === 0 && <State kind="empty" title="لا توجد أجهزة مطابقة" />}
          {rows.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted"><tr className="border-b border-line">{['السيريال', 'الصنف', 'الحالة', 'التكلفة', 'الدخول', 'الضمان', ''].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="border-b border-line last:border-0">
                      <td className="p-3 font-mono text-xs" dir="ltr"><button className="underline" onClick={() => { setSerial(d.serial); setLookupErr(null); lookup.mutate(d.serial); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{d.serial}</button></td>
                      <td className="p-3" dir="auto">{names.get(d.variant_id) ?? '—'}</td>
                      <td className="p-3"><Chip tone={STATUS_AR[d.status]?.tone ?? 'info'}>{STATUS_AR[d.status]?.label ?? d.status}</Chip></td>
                      <td className="whitespace-nowrap p-3">{formatEGP(toMinor(d.cost))}</td>
                      <td className="whitespace-nowrap p-3">{formatCairo(d.received_at, false)}</td>
                      <td className="p-3">{warranty(d.warranty_until) ?? '—'}</td>
                      <td className="p-3">{canWriteOff && d.status === 'in_stock' && <Button small variant="danger" onClick={() => { setWriteOff(d); setReason(''); off.reset() }}>إتلاف</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {devs.data && devs.data.length > 300 && <p className="mt-2 text-xs text-muted">يعرض أول 300 نتيجة. استخدم البحث.</p>}
        </>
      )}

      {registering && <Register onClose={() => setRegistering(false)} />}

      <Modal open={!!writeOff} onClose={() => setWriteOff(null)} title="إتلاف جهاز"
        footer={<><Button onClick={() => setWriteOff(null)}>إلغاء</Button><Button variant="danger" disabled={off.isPending || !reason.trim()} onClick={() => off.mutate()}>تأكيد الإتلاف</Button></>}>
        {writeOff && (
          <div className="space-y-3">
            <ErrorText error={off.error} />
            <p className="text-sm" dir="auto">الجهاز <span className="font-mono" dir="ltr">{writeOff.serial}</span> سيخرج من المخزون كتالف.</p>
            <Field label="السبب *"><input className={inputCls} dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Register({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const products = useProducts()
  const [f, setF] = useState({ variant: '', mode: 'new', cost: '', text: '', note: '' })
  const [err, setErr] = useState<unknown>(null)
  const tracked = (products.data ?? []).filter((p) => p.track_serial).flatMap((p) => p.variants.map((v) => ({ id: v.id, label: variantLabel(p, v) })))
  const serials = f.text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)

  const save = useMutation({
    mutationFn: async () => {
      if (!f.variant) throw new Error('اختر الصنف.')
      if (serials.length === 0) throw new Error('أدخل سيريال واحدًا على الأقل.')
      let cost = 0
      try { cost = toMinor(f.cost || '0') } catch { throw new Error('التكلفة رقم صحيح.') }
      const { data, error } = await supabase.rpc('register_devices', {
        p_variant: f.variant, p_serials: serials, p_cost: Number(fromMinor(cost)), p_mode: f.mode, p_note: f.note || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => { ['devices', 'stock', 'movements', 'available-serials', 'transactions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose() },
    onError: setErr,
  })

  return (
    <Modal open onClose={onClose} title="تسجيل أجهزة (IMEI / سيريال)"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => { setErr(null); save.mutate() }}>{save.isPending ? 'جارٍ الحفظ…' : `تسجيل ${serials.length || ''} جهاز`}</Button></>}>
      <div className="space-y-3">
        <ErrorText error={err} />
        {tracked.length === 0 && <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">لا توجد أصناف مفعّل عليها "تتبع بالسيريال/IMEI". فعّلها من صفحة المنتجات أولًا.</p>}
        <Field label="الصنف *">
          <select className={inputCls} value={f.variant} onChange={(e) => setF({ ...f, variant: e.target.value })}>
            <option value="">— اختر —</option>{tracked.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="نوع التسجيل">
          <select className={inputCls} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            <option value="new">أجهزة جديدة تُضاف للمخزون (بدون أمر شراء)</option>
            <option value="existing">ربط السيريال بوحدات موجودة بالفعل في المخزون</option>
          </select>
        </Field>
        <Field label="تكلفة الجهاز الواحد"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        <Field label="السيريال / IMEI (سطر لكل جهاز)" hint={`${serials.length} جهاز. يمكن اللصق من ملف أو الماسح.`}>
          <textarea className={`${inputCls} font-mono`} dir="ltr" rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        </Field>
        <Field label="ملاحظة"><input className={inputCls} dir="auto" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
