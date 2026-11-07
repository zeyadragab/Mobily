export type AppRole =
  | 'owner' | 'manager' | 'cashier' | 'warehouse' | 'accountant' | 'web_admin'

export const ROLE_LABEL: Record<AppRole, string> = {
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
export const NAV: { to: string; label: string; icon: string; roles: AppRole[]; group: string }[] = [
  { to: '/', label: 'الرئيسية', icon: 'home', roles: ALL, group: 'عام' },
  { to: '/sales', label: 'المبيعات', icon: 'receipt', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/cash', label: 'الدرج', icon: 'wallet', roles: ['owner', 'manager', 'cashier', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/expenses', label: 'المصروفات', icon: 'coins', roles: ['owner', 'manager', 'accountant'], group: 'التشغيل اليومي' },
  { to: '/products', label: 'المنتجات', icon: 'box', roles: ALL, group: 'المتجر' },
  { to: '/inventory', label: 'المخزون', icon: 'stock', roles: ALL, group: 'المتجر' },
  { to: '/online-orders', label: 'طلبات الموقع', icon: 'globe', roles: ['owner', 'manager', 'cashier', 'warehouse'], group: 'المتجر' },
  { to: '/devices', label: 'الأجهزة (IMEI)', icon: 'box', roles: ['owner', 'manager', 'cashier', 'warehouse', 'accountant'], group: 'المتجر' },
  { to: '/suppliers', label: 'الموردون', icon: 'truck', roles: BUYING, group: 'المشتريات' },
  { to: '/supplier-accounts', label: 'حسابات الموردين', icon: 'coins', roles: ['owner', 'manager', 'accountant'], group: 'المشتريات' },
  { to: '/purchase-orders', label: 'طلبات الشراء', icon: 'cart', roles: BUYING, group: 'المشتريات' },
  { to: '/transactions', label: 'كل المعاملات', icon: 'swap', roles: ['owner', 'accountant'], group: 'الرقابة' },
  { to: '/approvals', label: 'الموافقات', icon: 'check', roles: ['owner', 'manager', 'accountant'], group: 'الرقابة' },
  { to: '/audit', label: 'سجل العمليات', icon: 'log', roles: ['owner', 'accountant'], group: 'الرقابة' },
]

export const CAN_EDIT_CATALOG: AppRole[] = ['owner', 'manager', 'web_admin']
export const CAN_BUY: AppRole[] = ['owner', 'manager']
export const CAN_STOCK: AppRole[] = ['owner', 'manager', 'warehouse']
export const CAN_SEE_COST: AppRole[] = ['owner', 'manager', 'accountant', 'warehouse']
