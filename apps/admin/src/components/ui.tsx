import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const inputCls =
  'w-full rounded-[10px] border border-line bg-surface px-3 py-2.5 text-sm shadow-soft outline-none disabled:opacity-50'

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
    primary: 'bg-accent text-accent-fg shadow-soft hover:brightness-110',
    ghost: 'border border-line bg-surface shadow-soft hover:bg-bg',
    danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger/10',
  }[variant]
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.7rem] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line/70 bg-surface shadow-soft ${className}`}>{children}</div>
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
      className={`m-auto w-[calc(100%-1.5rem)] overflow-hidden rounded-[18px] border border-line/60 bg-surface p-0 text-fg ${
        wide ? 'max-w-4xl' : 'max-w-lg'
      }`}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-center justify-between border-b border-line/70 bg-bg/60 px-5 py-3.5">
            <h2 className="text-base font-bold">{title}</h2>
            <button aria-label="إغلاق" onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/15 text-xs text-muted transition hover:bg-danger hover:text-white active:scale-90">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line/70 bg-bg/60 px-5 py-3">{footer}</div>}
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
  [/repair already open/i, 'فيه أمر صيانة مفتوح لنفس الجهاز في الفرع. ابحث بالسيريال أو IMEI.'],
  [/customer approval required/i, 'لازم العميل يوافق على التسعيرة الأول (من الكاشير) قبل بدء الإصلاح.'],
  [/parts not available/i, 'القطع المطلوبة لسه ما وصلتش المخزن.'],
  [/diagnosis required/i, 'اكتب المشكلة اللي لقيتها في الجهاز.'],
  [/invalid cost|invalid quantity/i, 'التكلفة أو الكمية غير صحيحة.'],
  [/part unavailable/i, 'إحدى القطع غير متاحة أو موقوفة.'],
  [/duplicate part/i, 'قطعة مكررة في التسعيرة.'],
  [/request is not pending|request is not approved/i, 'الطلب اتغيّرت حالته. حدّث الصفحة.'],
  [/repair has changed/i, 'اتحدّث الأمر من جهاز تاني. اقفل التفاصيل وافتحها تاني قبل الحفظ.'],
  [/repair intake date in past/i, 'موعد التسليم لازم يكون بعد وقت استلام الجهاز.'],
  [/invalid repair status transition/i, 'الحالة المختارة مش متاحة في الخطوة دي.'],
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
  [/repair balance due/i, 'لازم يتسدد المتبقي على الجهاز قبل التسليم.'],
  [/payment exceeds balance/i, 'المبلغ أكبر من المتبقي على الأمر.'],
  [/refund exceeds paid/i, 'المبلغ المردود أكبر من المدفوع.'],
  [/repair not quoted/i, 'الأمر لسه ما اتسعّرش.'],
  [/invalid warranty/i, 'مدة الضمان غير صحيحة.'],
  [/invalid search/i, 'اكتب 5 حروف على الأقل (سيريال أو IMEI) أو رقم أمر مثل RP-12.'],
  [/invalid payment/i, 'بيانات الدفع غير صحيحة.'],
  [/repair has changed/i, 'الأمر اتغيّر. حدّث الصفحة وحاول تاني.'],
  [/invalid repair status transition/i, 'الانتقال بين الحالات ده غير مسموح.'],
  [/insufficient drawer balance/i, 'رصيد الدرج لا يكفي لهذا التحويل.'],
  [/override required/i, 'هذا المبلغ يحتاج موافقة مدير بالرقم السري.'],
  [/note required when there is a difference/i, 'اكتب سبب الفرق قبل إغلاق الوردية.'],
  [/a cash session is already open/i, 'هناك وردية مفتوحة بالفعل.'],
  [/no change/i, 'الرصيد الحالي مطابق، لا يوجد تغيير.'],
  [/reason required/i, 'اكتب سبب التعديل.'],
  [/invalid drawers/i, 'اختر درجين صحيحين.'],
  [/invalid count/i, 'أرقام العدّ غير صحيحة.'],
  [/invalid shift employee/i, 'الموظف المختار لا يمكنه فتح وردية.'],
  [/customer required for credit sale/i, 'البيع الآجل يحتاج عميلًا مسجلًا. اختر العميل أولًا.'],
  [/credit limit exceeded/i, 'المبلغ يتجاوز حد الآجل المسموح للعميل. زوّد المدفوع أو اطلب من المالك رفع الحد.'],
  [/customer phone exists/i, 'رقم الهاتف مسجل لعميل آخر.'],
  [/customer not found/i, 'العميل غير موجود أو موقوف.'],
  [/invalid national id/i, 'الرقم القومي يجب أن يكون 14 رقمًا.'],
  [/invalid phone/i, 'رقم الهاتف غير صحيح.'],
  [/invalid customer name/i, 'اكتب اسم العميل.'],
  [/entry already reversed/i, 'هذا القيد تم إلغاؤه من قبل.'],
  [/entry cannot be reversed/i, 'هذا النوع من القيود لا يُلغى من هنا.'],
  [/sale already in progress/i, 'الفاتورة قيد الحفظ بالفعل. انتظر لحظة.'],
  [/too many held baskets/i, 'وصلت للحد الأقصى من الفواتير المعلّقة (20). أكمل أو احذف بعضها.'],
  [/basket is empty|invalid basket/i, 'لا يمكن تعليق فاتورة فارغة أو غير مكتملة.'],
  [/customer required for credit refund/i, 'الرد على حساب العميل يحتاج فاتورة بعميل مسجل.'],
  [/invalid reduction/i, 'الخصم من المرتجع غير صحيح (أكبر من قيمة المرتجع).'],
  [/reduction reason required/i, 'اكتب سبب الخصم من المرتجع.'],
  [/invalid condition/i, 'حالة القطعة غير صحيحة.'],
  [/offer unavailable/i, 'العرض منتهي أو غير مفعّل أو استُهلك حد استخدامه.'],
  [/offer does not apply/i, 'العرض لا ينطبق على أصناف الفاتورة.'],
  [/invalid uncoded item/i, 'بيانات الصنف بدون كود غير صحيحة.'],
  [/uncoded reason required/i, 'اكتب اسم الصنف وسبب البيع بدون كود.'],
  [/invalid price/i, 'سعر الوحدة غير صحيح.'],
  [/invoice number exists/i, 'رقم فاتورة المورد مستخدم قبل كده لنفس المورد.'],
  [/serials count must equal quantity/i, 'عدد السيريالات لازم يساوي الكمية.'],
  [/supply already in progress/i, 'التوريد بيتسجل بالفعل، استنى لحظة.'],
  [/a count is already open/i, 'فيه جرد مفتوح بالفعل. اعتمده أو ألغيه الأول.'],
  [/count is not open/i, 'الجرد ده مش مفتوح.'],
  [/reason required for every difference/i, 'لازم سبب لكل فرق قبل اعتماد الجرد.'],
  [/serial not in stock/i, 'السيريال ده مش موجود في المخزون.'],
  [/item not in this count/i, 'الصنف ده مش داخل هذا الجرد.'],
  [/use scanning for serial items/i, 'الأصناف بسيريال بتتعد بالمسح مش بإدخال رقم.'],
  [/use device write-off/i, 'الأجهزة بسيريال بتتشطب من صفحة الأجهزة.'],
  [/supplier required/i, 'اختر المورد للإرجاع.'],
  [/invalid imei/i, 'رقم IMEI غير صحيح: لازم 15 رقم برقم تحقق سليم.'],
  [/required field missing/i, 'فيه حقل مواصفات مطلوب ناقص.'],
  [/unknown attribute/i, 'حقل مواصفات غير موجود في هذا القسم.'],
  [/invalid field value/i, 'قيمة أحد حقول المواصفات غير صحيحة.'],
  [/category in use/i, 'القسم عليه منتجات، انقلها أولًا ثم احذفه.'],
  [/rows out of range/i, 'عدد الصفوف لازم يكون بين 1 و 2000.'],
  [/insufficient account balance/i, 'رصيد الحساب لا يكفي (أو سينزل تحت أقل رصيد مسموح).'],
  [/account daily limit exceeded/i, 'تجاوزت الحد اليومي لهذا الحساب.'],
  [/account monthly limit exceeded/i, 'تجاوزت الحد الشهري لهذا الحساب.'],
  [/account name exists/i, 'يوجد حساب بنفس الاسم.'],
  [/invalid account/i, 'الحساب غير صحيح أو موقوف.'],
  [/alert already reviewed/i, 'هذا التنبيه تمت مراجعته من قبل.'],
  [/credit invoice return not supported/i, 'مرتجع فواتير الآجل غير متاح بعد.'],
  [/rate limit exceeded/i, 'عدد العمليات كبير في وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.'],
  [/no open shift/i, 'لا توجد وردية مفتوحة. افتح الدرج أولاً ثم سجّل البيع.'],
  [/pin must be 6 to 8 digits/i, 'الرقم السري يجب أن يكون من 6 إلى 8 أرقام.'],
  [/pin too easy/i, 'الرقم السري سهل التخمين. اختر رقماً آخر.'],
  [/override invalid/i, 'تصريح المدير غير صالح أو انتهت مدته.'],
  [/cannot target yourself/i, 'لا يمكنك تنفيذ هذا الإجراء على حسابك.'],
  [/order not delivered/i, 'الأمر مش متسلّم، فمفيش تسليم يتلغى.'],
  [/repair has customer debt/i, 'على الأمر متبقي على حساب العميل. الغ التسليم الأول قبل تغيير العميل.'],
  [/reason too long/i, 'السبب أطول من 250 حرف.'],
  [/brand exists/i, 'الماركة دي موجودة بالفعل.'],
  [/invalid brand/i, 'اسم الماركة غير صحيح (من 1 إلى 60 حرف).'],
  [/invalid amount/i, 'المبلغ غير صحيح.'],
  [/invoice not eligible/i, 'الفاتورة دي مينفعش تتقسّط (مش مكتملة أو من غير عميل مسجل).'],
  [/invoice already scheduled/i, 'الفاتورة دي عليها خطة تقسيط فعلاً.'],
  [/no credit to schedule/i, 'مفيش متبقي آجل على الفاتورة دي يتقسّط.'],
  [/invalid installment count/i, 'عدد الأقساط من 1 إلى 60.'],
  [/invalid period/i, 'دورية الأقساط غير صحيحة.'],
  [/invalid date/i, 'التاريخ غير صحيح.'],
  [/installment not found|installment not open/i, 'القسط ده مش مفتوح للتحصيل.'],
  [/amount exceeds remaining/i, 'المبلغ أكبر من المتبقي على القسط.'],
  [/plan not active/i, 'الخطة دي مش جارية.'],
  [/plan has collections/i, 'عليها تحصيل. الغ التحصيل الأول قبل إلغاء الخطة.'],
  [/collection already cancelled/i, 'التحصيل ده اتلغى قبل كده.'],
  [/entry already cancelled/i, 'الحركة دي اتلغت قبل كده.'],
  [/invalid direction/i, 'اتجاه الحركة غير صحيح.'],
  [/tradein limit exceeded/i, 'سعر الشراء أكبر من حد الكاشير. محتاج مدير.'],
  [/seller name required/i, 'اكتب اسم البائع.'],
  [/serial already registered/i, 'السيريال ده مسجل في المحل قبل كده.'],
  [/trade-in already cancelled/i, 'الشراء ده اتلغى قبل كده.'],
  [/device is not in stock/i, 'الجهاز مش في المخزن (اتباع أو اتحرك). مينفعش الإلغاء.'],
  [/invalid item/i, 'الصنف غير صحيح أو موقوف.'],
  [/customer required$/i, 'اختر العميل.'],
  [/payment exceeds employee balance/i, 'المبلغ أكبر من رصيد الموظف المستحق له.'],
  [/advance exceeds limit/i, 'السلفة تتجاوز الحد المسموح (راتب شهر على الموظف).'],
  [/invalid employee name/i, 'اكتب اسم الموظف (حرفان على الأقل).'],
  [/invalid salary/i, 'الراتب غير صحيح.'],
  [/invalid pay day/i, 'يوم الراتب من 1 إلى 28.'],
  [/invalid start date/i, 'تاريخ البداية غير صحيح.'],
  [/profile already linked/i, 'هذا المستخدم مربوط بموظف آخر.'],
  [/employee not found/i, 'الموظف غير موجود أو غير نشط.'],
  [/entry already reversed/i, 'القيد ده اتعكس قبل كده.'],
  [/entry cannot be reversed/i, 'القيد ده مينفعش يتعكس.'],
  [/already checked in/i, 'تم تسجيل الحضور قبل كده.'],
  [/already checked out/i, 'تم تسجيل الانصراف قبل كده.'],
  [/not checked in/i, 'لا يوجد حضور مفتوح للانصراف.'],
  [/invalid time/i, 'الوقت غير صحيح.'],
  [/invalid date/i, 'التاريخ غير صحيح.'],
  [/cannot restrict owner/i, 'لا يمكن تقييد المالك.'],
  [/reminder not open/i, 'التذكير مش مفتوح.'],
  [/reminder not found/i, 'التذكير غير موجود.'],
  [/invalid imei/i, 'رقم IMEI غير صحيح (15 رقمًا).'],
  [/invalid customer name/i, 'اكتب اسم العميل.'],
]
export function translateError(m: string) {
  const known = ERR.find(([re]) => re.test(m))?.[1]
  if (known) return known
  // Messages we wrote ourselves are Arabic and safe to show. Anything else (database / network
  // internals) must never reach the screen: show a generic message instead.
  return /[؀-ۿ]/.test(m) ? m : 'تعذّر إتمام العملية. حاول مرة أخرى، وإن تكرر الخطأ أبلغ المسؤول.'
}

const ICONS: Record<string, string> = {
  repair: 'M14.7 6.3a4 4 0 0 0-5.2 5.2l-5.8 5.8a2.1 2.1 0 0 0 3 3l5.8-5.8a4 4 0 0 0 5.2-5.2L15 12l-3-3z',
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
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
}
export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.box} />
    </svg>
  )
}
