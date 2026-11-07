import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const inputCls =
  'w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-sm outline-none transition focus:border-accent disabled:opacity-50'

export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string
  children: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
  small?: boolean
}
export function Button({ variant = 'ghost', small, className = '', ...p }: BtnProps) {
  const v = {
    primary: 'bg-accent text-accent-fg hover:opacity-90',
    ghost: 'border border-line bg-surface hover:bg-bg',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  }[variant]
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
      } ${v} ${className}`}
    />
  )
}

const TONES = {
  neutral: 'border-line text-muted',
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-info/40 bg-info/10 text-info',
}
export function Chip({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-1.5rem)] rounded-2xl border border-line bg-surface p-0 text-fg backdrop:bg-black/60 ${
        wide ? 'max-w-4xl' : 'max-w-lg'
      }`}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button aria-label="إغلاق" onClick={onClose} className="rounded-lg px-2 py-1 text-muted hover:text-fg">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null
  const m = error instanceof Error ? error.message : (error as { message?: string }).message ?? 'حدث خطأ'
  return (
    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {translateError(m)}
    </p>
  )
}

const ERR: [RegExp, string][] = [
  [/row-level security|permission denied|not allowed/i, 'ليس لديك صلاحية لهذا الإجراء.'],
  [/duplicate key.*sku/i, 'رمز الصنف (SKU) مستخدم من قبل.'],
  [/duplicate key.*barcode/i, 'الباركود مستخدم من قبل.'],
  [/foreign key/i, 'لا يمكن الحذف لوجود سجلات مرتبطة. أوقفه بدلاً من ذلك.'],
  [/stock cannot go negative/i, 'لا يمكن أن يصبح المخزون سالبًا.'],
  [/exceeds ordered/i, 'الكمية المستلمة أكبر من المطلوبة.'],
  [/requester cannot approve/i, 'لا يمكنك اعتماد طلبك أنت (فصل الأدوار).'],
  [/locked/i, 'الطلبية مقفلة للتعديل بعد الإرسال للموافقة.'],
  [/order has no lines/i, 'أضف صنفًا واحدًا على الأقل.'],
  [/supplier is inactive/i, 'المورد موقوف.'],
  [/changed after approval/i, 'تغيّرت الطلبية بعد الموافقة. أعد إرسالها للموافقة.'],
  [/no open cash session/i, 'افتح الدرج أولًا من صفحة "الدرج" قبل أي دفع نقدي.'],
  [/already open/i, 'الدرج مفتوح بالفعل.'],
  [/not enough stock/i, 'الكمية المطلوبة أكبر من المتاح في المخزون.'],
  [/payments must equal/i, 'مجموع الدفعات يجب أن يساوي إجمالي الفاتورة.'],
  [/payments required/i, 'أدخل طريقة الدفع.'],
  [/discount exceeds/i, 'الخصم أكبر من قيمة الفاتورة.'],
  [/payment exceeds remaining/i, 'المبلغ أكبر من المتبقي على المصروف.'],
  [/expense is not open/i, 'المصروف بانتظار موافقة المالك أو مرفوض.'],
  [/note required when there is a difference/i, 'اكتب سبب الفرق بين المعدود والمتوقع.'],
  [/item unavailable/i, 'أحد الأصناف غير متاح أو موقوف.'],
  [/return exceeds sold quantity/i, 'الكمية المرتجعة أكبر من المباعة (أو سبق إرجاعها).'],
  [/invoice not returnable/i, 'هذه الفاتورة غير قابلة للإرجاع.'],
  [/line is not awaiting inspection/i, 'هذه القطعة تم فحصها بالفعل.'],
  [/reason required/i, 'السبب مطلوب.'],
  [/supplier_invoices_supplier_id_invoice_number/i, 'رقم الفاتورة مسجل من قبل لهذا المورد.'],
  [/devices_serial_key|duplicate serial in list/i, 'سيريال / IMEI مسجل من قبل أو مكرر في القائمة.'],
  [/invalid serial/i, 'سيريال غير صحيح (من 5 إلى 40 حرفًا/رقمًا).'],
  [/serial numbers required/i, 'أدخل السيريال / IMEI لكل جهاز.'],
  [/serial numbers must match/i, 'عدد السيريالات يجب أن يساوي الكمية.'],
  [/device not available/i, 'أحد الأجهزة غير متاح في المخزون (تم بيعه أو غير مسجل).'],
  [/device does not belong to this line/i, 'هذا الجهاز لا يخص بند الفاتورة المحدد.'],
  [/device is in a pending return/i, 'هذا الجهاز في مرتجع بانتظار الموافقة.'],
  [/device is not in stock/i, 'الجهاز ليس بالمخزون.'],
  [/tracked variant/i, 'هذا الصنف مُتتبَّع بالسيريال: استخدم صفحة الأجهزة لتسجيل أو إتلاف الأجهزة.'],
  [/more devices than untracked stock/i, 'عدد السيريالات أكبر من الوحدات غير المسجلة بالمخزون.'],
  [/item is not serial-tracked/i, 'هذا الصنف غير مفعّل عليه التتبع بالسيريال.'],
  [/sales_invoice_lines_invoice_id_variant_id/i, 'صنف مكرر في الفاتورة.'],
  [/no received goods/i, 'الطلبية لم تُستلم بعد، لا يمكن تسجيل فاتورة عليها.'],
  [/invoice is not open for payment/i, 'الفاتورة بانتظار موافقة المالك أو مرفوضة.'],
  [/does not belong to this supplier/i, 'هذا العنصر لا يخص هذا المورد.'],
]
export function translateError(m: string) {
  const known = ERR.find(([re]) => re.test(m))?.[1]
  if (known) return known
  // Messages we wrote ourselves are Arabic and safe to show. Anything else (database / network
  // internals) must never reach the screen: show a generic message instead.
  return /[؀-ۿ]/.test(m) ? m : 'تعذّر إتمام العملية. حاول مرة أخرى، وإن تكرر الخطأ أبلغ المسؤول.'
}

const ICONS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  stock: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  truck: 'M1 5h13v11H1zM14 9h5l3 3v4h-8zM6 19a2 2 0 1 0 0-.01M18 19a2 2 0 1 0 0-.01',
  cart: 'M6 6h15l-2 9H8zM6 6L5 3H2M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01',
  check: 'M20 6L9 17l-5-5',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l3-3h11M17 14h2',
  coins: 'M12 3c4 0 7 1.3 7 3s-3 3-7 3-7-1.3-7-3 3-3 7-3zM5 6v6c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3 3 7 3s7-1.3 7-3v-6',
  swap: 'M7 7h13l-3-3M17 17H4l3 3',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  log: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
}
export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.box} />
    </svg>
  )
}
