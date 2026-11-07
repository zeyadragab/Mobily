import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { inputCls } from './ui'

export const normSerial = (s: string) => s.replace(/\s+/g, '').toUpperCase()

/** Pick specific devices (IMEI / serial) of one tracked item by typing or scanning. */
export default function SerialPicker({ variantId, value, onChange }: { variantId: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const avail = useQuery({
    queryKey: ['available-serials', variantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('available_serials', { p_variant: variantId })
      if (error) throw error
      return (data as { serial: string }[]).map((r) => r.serial)
    },
  })
  const list = avail.data ?? []
  const listId = `serials-${variantId}`

  function add() {
    const s = normSerial(text)
    if (!s) return
    if (value.includes(s)) { setMsg('تمت إضافته بالفعل.'); return }
    if (!list.includes(s)) { setMsg('هذا السيريال غير متاح في المخزون لهذا الصنف.'); return }
    onChange([...value, s])
    setText('')
    setMsg(null)
  }

  return (
    <div className="w-full space-y-2">
      <div className="flex gap-2">
        <input className={inputCls} dir="ltr" list={listId} placeholder="امسح أو اكتب IMEI / السيريال ثم Enter" aria-label="IMEI أو السيريال"
          value={text} onChange={(e) => { setText(e.target.value); setMsg(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="rounded-lg border border-line px-3 text-sm hover:bg-bg" onClick={add}>إضافة</button>
      </div>
      <datalist id={listId}>{list.filter((s) => !value.includes(s)).slice(0, 50).map((s) => <option key={s} value={s} />)}</datalist>
      {avail.isError && <p className="text-xs text-danger">تعذّر تحميل السيريالات المتاحة.</p>}
      {!avail.isLoading && list.length === 0 && <p className="text-xs text-danger">لا توجد أجهزة مسجلة بالمخزون لهذا الصنف. سجّلها من صفحة "الأجهزة".</p>}
      {msg && <p role="alert" className="text-xs text-danger">{msg}</p>}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((s) => (
            <li key={s} className="flex items-center gap-1 rounded-full border border-line bg-bg px-3 py-1 font-mono text-xs" dir="ltr">
              {s}
              <button type="button" aria-label={`إزالة ${s}`} className="text-danger" onClick={() => onChange(value.filter((x) => x !== s))}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
