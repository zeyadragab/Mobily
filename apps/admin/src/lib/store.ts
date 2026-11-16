import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { setPrintStore } from './print'

export const MODULES = {
  wallets: 'إرسال واستقبال (المحافظ)',
  bills: 'فواتير وخدمات',
  maintenance: 'الصيانة',
  installments: 'الأقساط',
  tradein: 'المستعمل والتبديل',
  inout: 'داخل وخارج',
  online: 'طلبات الموقع',
} as const
export type ModuleKey = keyof typeof MODULES

/** Sidebar paths that belong to a module. A switched-off module hides its pages. */
export const MODULE_PATHS: Record<ModuleKey, string[]> = {
  wallets: ['/wallet-ops'],
  bills: ['/bills'],
  maintenance: ['/maintenance', '/repairs'],
  installments: ['/installments'],
  tradein: ['/trade-in'],
  inout: ['/inout'],
  online: ['/online-orders'],
}

export const PAPERS = { '58mm': 'إيصال 58 مم', '80mm': 'إيصال 80 مم', A5: 'ورقة A5', A4: 'ورقة A4' } as const
export const LABELS = { '58x40': '58 × 40 مم', '50x40': '50 × 40 مم', '50x28': '50 × 28 مم', '38x25': '38 × 25 مم' } as const
export const FOOTERS = {
  footer_sale: 'فاتورة البيع',
  footer_return: 'إيصال المرتجع',
  footer_repair: 'إيصال الصيانة',
  footer_installment: 'إيصال القسط',
  footer_wallet: 'إيصال التحويل',
  footer_bill: 'إيصال الفواتير والخدمات',
  footer_tradein: 'عقد شراء المستعمل',
} as const
export type FooterKey = keyof typeof FOOTERS

export type StoreSettings = {
  store_name: string
  phone: string
  address: string
  tax_number: string
  paper: keyof typeof PAPERS
  label: keyof typeof LABELS
  show_logo: boolean
  show_previous_balance: boolean
  modules: Record<ModuleKey, boolean>
} & Record<FooterKey, string>

const DEFAULTS: StoreSettings = {
  store_name: '', phone: '', address: '', tax_number: '', paper: '80mm', label: '50x28', show_logo: false, show_previous_balance: true,
  footer_sale: '', footer_return: '', footer_repair: '', footer_installment: '', footer_wallet: '', footer_bill: '', footer_tradein: '',
  modules: { wallets: true, bills: true, maintenance: true, installments: true, tradein: true, inout: true, online: true },
}

/** Store data, printing options and module switches. Also feeds the print header and footer. */
export function useStoreSettings() {
  const q = useQuery({
    queryKey: ['store-settings'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('store_settings').select('data').maybeSingle()
      if (error) throw error
      const d = (data?.data ?? {}) as Partial<StoreSettings>
      return { ...DEFAULTS, ...d, modules: { ...DEFAULTS.modules, ...(d.modules ?? {}) } } as StoreSettings
    },
  })
  useEffect(() => { if (q.data) setPrintStore(q.data) }, [q.data])
  return q
}

export function hiddenByModules(s: StoreSettings | undefined) {
  const hidden = new Set<string>()
  if (!s) return hidden
  for (const k of Object.keys(MODULE_PATHS) as ModuleKey[]) if (s.modules[k] === false) MODULE_PATHS[k].forEach((p) => hidden.add(p))
  return hidden
}
