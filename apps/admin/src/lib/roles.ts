export type AppRole =
  | 'owner' | 'manager' | 'cashier' | 'warehouse' | 'accountant' | 'web_admin' | 'technician'

export const ROLE_LABEL: Record<AppRole, string> = {
  technician: 'الفني',
  owner: 'المالك',
  manager: 'المدير',
  cashier: 'الكاشير',
  warehouse: 'المخزن',
  accountant: 'المحاسب',
  web_admin: 'مسؤول الموقع',
}

const ALL: AppRole[] = ['owner', 'manager', 'cashier', 'warehouse', 'accountant', 'web_admin']
const BUYING: AppRole[] = ['owner', 'manager', 'accountant', 'warehouse']

// UI visibility only. The database (RLS) is the real enforcement.
export const NAV: { to: string; label: string; icon: string; roles: AppRole[]; group: string; soon?: string }[] = [
  { to: '/', label: 'الرئيسية', icon: 'home', roles: [...ALL, 'technician'], group: 'عام' },
  { to: '/maintenance', label: 'لوحة الصيانة', icon: 'repair', roles: ['owner', 'manager', 'technician'], group: 'التشغيل اليومي' },
  { to: '/sales', label: 'المبيعات', icon: 'receipt', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/offers', label: 'العروض والباقات', icon: 'coins', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/repairs', label: 'الصيانة', icon: 'repair', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/customers', label: 'العملاء والديون', icon: 'users', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/cash', label: 'الورديات والأدراج', icon: 'wallet', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/accounts', label: 'الأرصدة والحسابات', icon: 'coins', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/returns', label: 'مرتجعات العملاء', icon: 'swap', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/expenses', label: 'المصروفات', icon: 'coins', roles: ['owner', 'manager', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/products', label: 'المنتجات', icon: 'box', roles: ALL, group: 'المتجر' },
  { to: '/inventory', label: 'المخزون', icon: 'stock', roles: ALL, group: 'المتجر' },
  { to: '/online-orders', label: 'طلبات الموقع', icon: 'globe', roles: ['owner', 'manager', 'cashier', 'warehouse'], group: 'المتجر' },
  { to: '/devices', label: 'الأجهزة (IMEI)', icon: 'box', roles: ['owner', 'manager', 'cashier', 'warehouse', 'accountant'], group: 'المتجر' },
  { to: '/supply', label: 'التوريد والجرد', icon: 'truck', roles: ['owner', 'manager', 'warehouse', 'accountant'], group: 'المشتريات' },
  { to: '/suppliers', label: 'الموردون', icon: 'truck', roles: BUYING, group: 'المشتريات' },
  { to: '/supplier-accounts', label: 'حسابات الموردين', icon: 'coins', roles: ['owner', 'manager', 'accountant'], group: 'المشتريات' },
  { to: '/purchase-orders', label: 'طلبات الشراء', icon: 'cart', roles: BUYING, group: 'المشتريات' },
  { to: '/transactions', label: 'كل المعاملات', icon: 'swap', roles: ['owner', 'accountant'], group: 'الرقابة' },
  { to: '/approvals', label: 'الموافقات', icon: 'check', roles: ['owner', 'manager', 'accountant'], group: 'الرقابة' },
  { to: '/audit', label: 'سجل العمليات', icon: 'log', roles: ['owner', 'accountant'], group: 'الرقابة' },
  { to: '/security', label: 'الأمان', icon: 'shield', roles: ['owner', 'manager', 'accountant'], group: 'الرقابة' },
  { to: '/wallet-ops', label: 'إرسال واستقبال', icon: 'swap', roles: ['owner', 'manager', 'cashier'], group: 'التشغيل اليومي' },
  { to: '/bills', label: 'فواتير وخدمات', icon: 'coins', roles: ['owner', 'manager', 'cashier'], group: 'التشغيل اليومي' },
  { to: '/trade-in', label: 'المستعمل والتبديل', icon: 'box', roles: ['owner', 'manager', 'cashier'], group: 'التشغيل اليومي' },
  { to: '/inout', label: 'داخل وخارج', icon: 'swap', roles: ['owner', 'manager'], group: 'التشغيل اليومي' },
  { to: '/installments', label: 'الأقساط', icon: 'coins', roles: ['owner', 'manager', 'cashier'], group: 'التشغيل اليومي' },
  { to: '/notifications', label: 'التنبيهات والمهام', icon: 'check', roles: ['owner', 'manager', 'cashier', 'accountant', 'warehouse'], group: 'الإدارة' },
  { to: '/mobile-tax', label: 'ضريبة الموبايل', icon: 'log', roles: ['owner', 'manager', 'cashier'], group: 'الإدارة' },
  { to: '/attendance', label: 'الحضور والانصراف', icon: 'check', roles: [...ALL, 'technician'], group: 'الإدارة' },
  { to: '/team', label: 'إدارة الفريق', icon: 'users', roles: ['owner', 'manager'], group: 'الإدارة' },
  { to: '/employee-accounts', label: 'حسابات الموظفين', icon: 'users', roles: ['owner', 'manager', 'accountant'], group: 'الإدارة' },
  { to: '/reports', label: 'التقارير', icon: 'stock', roles: ['owner', 'manager', 'accountant'], group: 'الإدارة' },
  { to: '/campaigns', label: 'حملات واتساب', icon: 'globe', roles: ['owner', 'manager'], group: 'الإدارة' },
  { to: '/settings', label: 'الإعدادات', icon: 'shield', roles: ['owner', 'manager'], group: 'الإدارة' },
]

export const CAN_EDIT_CATALOG: AppRole[] = ['owner', 'manager', 'web_admin']
export const CAN_BUY: AppRole[] = ['owner', 'manager']
export const CAN_STOCK: AppRole[] = ['owner', 'manager', 'warehouse']
export const CAN_SEE_COST: AppRole[] = ['owner', 'manager', 'accountant', 'warehouse']
