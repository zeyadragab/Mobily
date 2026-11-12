import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { useRepairTemplates, type RepairDetail, type RepairOrderPart, type RepairPart, type RepairPartLevel } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { Button, Chip, ErrorText, Field, inputCls } from './ui'

type Line = { part_id: string; qty: number }

/** Technician step: write the issue, labour cost and the spare parts needed. Parts that stock
 *  cannot cover are turned into manager requests by the database when this is saved. */
export default function RepairQuoteForm({ order, current, onSaved }: {
  order: RepairDetail; current: RepairOrderPart[]; onSaved: (openedRequests: number) => Promise<void>
}) {
  const [diagnosis, setDiagnosis] = useState(order.diagnosis ?? '')
  const [labor, setLabor] = useState(order.quoted_at ? fromMinor(toMinor(order.labor_cost)) : '')
  const [lines, setLines] = useState<Line[]>(current.map((line) => ({ part_id: line.part_id, qty: line.qty })))
  const [pick, setPick] = useState('')
  const templates = useRepairTemplates()
  const parts = useQuery({
    queryKey: ['repair-parts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_parts').select('id,name,sku,unit_price,is_active').eq('is_active', true).order('name')
      if (error) throw error
      return data as RepairPart[]
    },
  })
  const levels = useQuery({
    queryKey: ['repair-part-levels', order.branch_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_part_levels').select('part_id,on_hand').eq('branch_id', order.branch_id)
      if (error) throw error
      return data as Pick<RepairPartLevel, 'part_id' | 'on_hand'>[]
    },
  })
  const catalog = parts.data ?? []
  const stock = (partId: string) => levels.data?.find((level) => level.part_id === partId)?.on_hand ?? 0
  const partOf = (partId: string) => catalog.find((part) => part.id === partId)
  const partsMinor = lines.reduce((sum, line) => sum + line.qty * toMinor(partOf(line.part_id)?.unit_price ?? 0), 0)
  let laborMinor = 0
  try { laborMinor = labor.trim() ? toMinor(labor) : 0 } catch { laborMinor = NaN }

  const save = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(laborMinor) || laborMinor < 0) throw new Error('اكتب تكلفة المصنعية بشكل صحيح (أرقام فقط).')
      const { data, error } = await supabase.rpc('submit_repair_quote', {
        p_id: order.id, p_revision: order.revision,
        p_quote: { diagnosis: diagnosis.trim(), labor_cost: fromMinor(laborMinor), parts: lines },
      })
      if (error) throw error
      return data as number
    },
    onSuccess: onSaved,
  })

  function addPart() {
    if (!pick || lines.some((line) => line.part_id === pick)) return
    setLines([...lines, { part_id: pick, qty: 1 }])
    setPick('')
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-bg p-3">
      <h3 className="font-semibold">التشخيص والتسعير</h3>
      {(templates.data ?? []).some((t) => t.is_active) && (
        <Field label="قالب جاهز (اختياري)" hint="بيملّي المصنعية، وتقدر تعدّلها.">
          <select className={inputCls} defaultValue="" onChange={(event) => {
            const t = templates.data?.find((item) => item.id === event.target.value)
            if (!t) return
            setLabor(fromMinor(toMinor(t.default_labor)))
            if (!diagnosis.trim()) setDiagnosis(t.name)
          }}>
            <option value="">اختار قالب…</option>
            {templates.data?.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name} — {formatEGP(toMinor(t.default_labor))}</option>)}
          </select>
        </Field>
      )}
      <Field label="المشكلة اللي لقيتها في الجهاز" hint="الكلام ده هو اللي هيتقال للعميل.">
        <textarea className={inputCls} rows={3} maxLength={1500} required value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
      </Field>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">قطع الغيار المطلوبة</p>
        {lines.length === 0 && <p className="text-sm text-muted">مفيش قطع مضافة. سيبها فاضية لو الإصلاح مش محتاج قطع.</p>}
        <ul className="space-y-2">
          {lines.map((line) => {
            const part = partOf(line.part_id)
            const enough = stock(line.part_id) >= line.qty
            return <li key={line.part_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-32 flex-1" dir="auto">{part?.name ?? '—'}</span>
              <input aria-label="الكمية" className={`${inputCls} !w-20`} type="number" min={1} max={50} dir="ltr" value={line.qty}
                onChange={(event) => setLines(lines.map((item) => item.part_id === line.part_id ? { ...item, qty: Math.max(1, Math.min(50, Number(event.target.value) || 1)) } : item))} />
              <span className="w-24 text-end">{formatEGP(line.qty * toMinor(part?.unit_price ?? 0))}</span>
              {levels.isSuccess && <Chip tone={enough ? 'ok' : 'warn'}>{enough ? `متوفر (${stock(line.part_id)})` : `ناقص · المتاح ${stock(line.part_id)}`}</Chip>}
              <Button small type="button" variant="danger" onClick={() => setLines(lines.filter((item) => item.part_id !== line.part_id))}>حذف</Button>
            </li>
          })}
        </ul>
        <div className="mt-2 flex gap-2">
          <select className={inputCls} value={pick} onChange={(event) => setPick(event.target.value)} aria-label="اختار قطعة">
            <option value="">اختار قطعة غيار…</option>
            {catalog.filter((part) => !lines.some((line) => line.part_id === part.id)).map((part) => <option key={part.id} value={part.id}>{part.name} — {formatEGP(toMinor(part.unit_price))}</option>)}
          </select>
          <Button type="button" onClick={addPart} disabled={!pick}>إضافة</Button>
        </div>
        {parts.isSuccess && catalog.length === 0 && <p className="mt-1 text-xs text-muted">لسه مفيش قطع غيار مسجلة. المدير يضيفها من "قطع الغيار".</p>}
        {lines.some((line) => stock(line.part_id) < line.qty) && levels.isSuccess &&
          <p className="mt-2 text-xs text-warn">القطع الناقصة هتتبعت للمدير كطلب تلقائيًا أول ما تحفظ.</p>}
      </div>
      <Field label="مصنعية الفني (جنيه)">
        <input className={inputCls} inputMode="decimal" dir="ltr" placeholder="0" value={labor} onChange={(event) => setLabor(event.target.value)} />
      </Field>
      <p className="flex justify-between text-base font-bold"><span>إجمالي التكلفة للعميل</span>
        <span>{Number.isFinite(laborMinor) ? formatEGP(laborMinor + partsMinor) : '—'}</span></p>
      <ErrorText error={save.error} />
      <div className="flex justify-end">
        <Button variant="primary" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ وإرسال للكاشير لإبلاغ العميل'}</Button>
      </div>
    </form>
  )
}
