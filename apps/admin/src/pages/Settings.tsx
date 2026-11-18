import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { State } from '../components/State'
import { Button, Card, ErrorText, Field, inputCls, PageHeader } from '../components/ui'
import { printDocument, setPrintStore } from '../lib/print'
import { FOOTERS, LABELS, MODULES, PAPERS, useStoreSettings, type FooterKey, type ModuleKey, type StoreSettings } from '../lib/store'
import { supabase } from '../lib/supabase'

const TABS = { store: 'بيانات المتجر', print: 'الطباعة', modules: 'الأقسام', limits: 'الحدود والموافقات' } as const
type Tab = keyof typeof TABS

const LIMITS: { key: string; label: string; hint: string; unit: string }[] = [
  { key: 'max_discount_pct', label: 'أقصى خصم للكاشير', hint: 'فوق النسبة دي يلزم رقم سري لمدير', unit: '%' },
  { key: 'return_approval_threshold', label: 'مرتجع يحتاج موافقة', hint: 'مرتجع بالمبلغ ده أو أكتر يروح للمالك', unit: 'جنيه' },
  { key: 'expense_approval_threshold', label: 'مصروف يحتاج موافقة', hint: 'مصروف بالمبلغ ده أو أكتر يروح للمالك', unit: 'جنيه' },
  { key: 'supplier_payment_threshold', label: 'دفعة مورد تحتاج موافقة', hint: '', unit: 'جنيه' },
  { key: 'drawer_transfer_pin_threshold', label: 'حركة درج أو حساب تحتاج رقم سري', hint: '', unit: 'جنيه' },
  { key: 'uncoded_pin_threshold', label: 'بيع بدون كود يحتاج رقم سري', hint: '', unit: 'جنيه' },
  { key: 'wallet_pin_threshold', label: 'تحويل محفظة يحتاج رقم سري', hint: 'للكاشير فقط', unit: 'جنيه' },
  { key: 'tradein_cashier_limit', label: 'أقصى شراء مستعمل للكاشير', hint: '', unit: 'جنيه' },
  { key: 'idle_lock_minutes', label: 'قفل الشاشة بعد عدم النشاط', hint: '', unit: 'دقيقة' },
  { key: 'idle_logout_minutes', label: 'تسجيل الخروج بعد عدم النشاط', hint: '', unit: 'دقيقة' },
  { key: 'wa_daily_cap', label: 'أقصى رسائل حملات في اليوم', hint: '', unit: 'رسالة' },
]

export default function Settings() {
  const { hasRole } = useAuth()
  const owner = hasRole('owner')
  const qc = useQueryClient()
  const settings = useStoreSettings()
  const [tab, setTab] = useState<Tab>('store')
  const [f, setF] = useState<StoreSettings | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (settings.data && !f) setF(settings.data) }, [settings.data, f])

  const save = useMutation({
    mutationFn: async () => {
      if (!f) return
      if (f.store_name.trim().length < 2) throw new Error('اكتب اسم المتجر.')
      const { error } = await supabase.rpc('save_store_settings', { p_data: f })
      if (error) throw error
    },
    onSuccess: () => { if (f) setPrintStore(f); setSaved(true); void qc.invalidateQueries({ queryKey: ['store-settings'] }) },
  })
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => { setSaved(false); setF((p) => (p ? { ...p, [k]: v } : p)) }

  if (settings.isLoading || !f) return settings.isError
    ? <State kind="error" text="تعذّر تحميل الإعدادات. تأكد من تطبيق آخر تحديث لقاعدة البيانات." action={<Button onClick={() => void settings.refetch()}>حاول تاني</Button>} />
    : <State kind="loading" />

  return (
    <div>
      <PageHeader title="الإعدادات" subtitle="بيانات المتجر على الفواتير، مقاسات الطباعة، الأقسام الظاهرة، وحدود الموافقات."
        actions={tab !== 'limits' && <>
          {saved && <span role="status" className="self-center text-sm text-ok">تم الحفظ</span>}
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
        </>} />
      <div role="tablist" aria-label="أقسام الإعدادات" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${tab === t ? 'border-accent bg-accent font-semibold text-accent-fg' : 'border-line bg-surface hover:bg-bg'}`}>{TABS[t]}</button>
        ))}
      </div>
      <ErrorText error={save.error} />

      {tab === 'store' && (
        <Card className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="اسم المتجر *"><input className={inputCls} dir="auto" maxLength={80} value={f.store_name} onChange={(e) => set('store_name', e.target.value)} /></Field>
          <Field label="رقم التليفون"><input className={inputCls} dir="ltr" maxLength={40} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="العنوان" className="sm:col-span-2"><input className={inputCls} dir="auto" maxLength={200} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="الرقم الضريبي (اختياري)"><input className={inputCls} dir="ltr" maxLength={40} value={f.tax_number} onChange={(e) => set('tax_number', e.target.value)} /></Field>
          <p className="self-end pb-2 text-xs text-muted">البيانات دي بتظهر أعلى كل فاتورة وإيصال مطبوع.</p>
        </Card>
      )}

      {tab === 'print' && (
        <div className="space-y-4">
          <Card className="grid gap-3 p-5 sm:grid-cols-2">
            <Field label="مقاس ورق الفواتير والإيصالات">
              <select className={inputCls} value={f.paper} onChange={(e) => set('paper', e.target.value as StoreSettings['paper'])}>
                {Object.entries(PAPERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="مقاس ملصق الباركود">
              <select className={inputCls} value={f.label} onChange={(e) => set('label', e.target.value as StoreSettings['label'])}>
                {Object.entries(LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.show_previous_balance} onChange={(e) => set('show_previous_balance', e.target.checked)} /> إظهار الرصيد السابق للعميل على الفاتورة</label>
            <div className="text-end">
              <Button onClick={() => { void save.mutateAsync().then(() => printDocument('تجربة طباعة', '<h1>تجربة طباعة</h1><p class="muted">لو البيانات والمقاس مظبوطين يبقى الإعدادات تمام.</p><table><tr><th>الصنف</th><th>الكمية</th><th>السعر</th></tr><tr><td>صنف تجربة</td><td>1</td><td>100.00</td></tr></table><p class="total">الإجمالي: 100.00 جنيه</p>', { footer: 'sale' })).catch(() => undefined) }}>حفظ وطباعة تجربة</Button>
            </div>
          </Card>
          <Card className="grid gap-3 p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">النص أسفل كل مستند</h2>
            {(Object.keys(FOOTERS) as FooterKey[]).map((k) => (
              <Field key={k} label={FOOTERS[k]}>
                <textarea className={`${inputCls} min-h-20`} dir="auto" maxLength={500} value={f[k]} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
          </Card>
        </div>
      )}

      {tab === 'modules' && (
        <Card className="p-5">
          <p className="mb-3 text-sm text-muted">القسم المقفول بيختفي من القائمة الجانبية لكل المستخدمين. البيانات القديمة بتفضل محفوظة.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(MODULES) as ModuleKey[]).map((k) => (
              <li key={k}>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
                  <span>{MODULES[k]}</span>
                  <input type="checkbox" role="switch" aria-checked={f.modules[k]} checked={f.modules[k]} onChange={(e) => set('modules', { ...f.modules, [k]: e.target.checked })} />
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'limits' && <Limits owner={owner} />}
    </div>
  )
}

function Limits({ owner }: { owner: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('key,value')
      if (error) throw error
      return new Map((data as { key: string; value: number | string }[]).map((r) => [r.key, String(Number(r.value))]))
    },
  })
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async (key: string) => {
      const v = Number(edit[key])
      if (!edit[key]?.trim() || !Number.isFinite(v) || v < 0) throw new Error('أدخل رقمًا صحيحًا.')
      const { error } = await supabase.rpc('save_app_setting', { p_key: key, p_value: v })
      if (error) throw error
      return key
    },
    onSuccess: (key) => { setDone(key); setEdit((e) => { const n = { ...e }; delete n[key]; return n }); void qc.invalidateQueries({ queryKey: ['settings'] }) },
  })
  if (q.isLoading) return <State kind="loading" />
  if (q.isError) return <State kind="error" text="تعذّر تحميل الحدود." />
  const rows = LIMITS.filter((l) => q.data?.has(l.key))
  return (
    <Card className="p-5">
      {!owner && <p className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">المالك فقط يقدر يغيّر الحدود. إنت شايفها للاطلاع.</p>}
      <ErrorText error={save.error} />
      <ul className="divide-y divide-line">
        {rows.map((l) => {
          const cur = q.data?.get(l.key) ?? ''
          const val = edit[l.key] ?? cur
          return (
            <li key={l.key} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.label}</p>
                {l.hint && <p className="text-xs text-muted">{l.hint}</p>}
              </div>
              <input aria-label={l.label} className={`${inputCls} !w-32`} dir="ltr" inputMode="decimal" disabled={!owner} value={val}
                onChange={(e) => { setDone(null); setEdit({ ...edit, [l.key]: e.target.value }) }} />
              <span className="w-12 text-xs text-muted">{l.unit}</span>
              {owner && <Button small disabled={save.isPending || val === cur} onClick={() => save.mutate(l.key)}>حفظ</Button>}
              {done === l.key && <span role="status" className="text-xs text-ok">تم</span>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
