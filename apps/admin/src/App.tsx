import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import Shell from './components/Shell'
import { RequireRole } from './components/RequireRole'
import { State } from './components/State'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import { NAV } from './lib/roles'
import Wallpaper from './components/Wallpaper'
import { usePointerFx } from './lib/fx'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Products = lazy(() => import('./pages/Products'))
const Inventory = lazy(() => import('./pages/Inventory'))
const SupplierAccounts = lazy(() => import('./pages/SupplierAccounts'))
const Devices = lazy(() => import('./pages/Devices'))
const Repairs = lazy(() => import('./pages/Repairs'))
const Maintenance = lazy(() => import('./pages/Maintenance'))
const Sales = lazy(() => import('./pages/Sales'))
const Cash = lazy(() => import('./pages/Cash'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Transactions = lazy(() => import('./pages/Transactions'))
const OnlineOrders = lazy(() => import('./pages/OnlineOrders'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'))
const Approvals = lazy(() => import('./pages/Approvals'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const Customers = lazy(() => import('./pages/Customers'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Supply = lazy(() => import('./pages/Supply'))
const Offers = lazy(() => import('./pages/Offers'))
const Returns = lazy(() => import('./pages/Returns'))
const Security = lazy(() => import('./pages/Security'))
const WalletOps = lazy(() => import('./pages/WalletOps'))
const Bills = lazy(() => import('./pages/Bills'))
const Installments = lazy(() => import('./pages/Installments'))
const InOut = lazy(() => import('./pages/InOut'))
const TradeIn = lazy(() => import('./pages/TradeIn'))
const EmployeeAccounts = lazy(() => import('./pages/EmployeeAccounts'))
const Attendance = lazy(() => import('./pages/Attendance'))
const Team = lazy(() => import('./pages/Team'))
const MobileTax = lazy(() => import('./pages/MobileTax'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Campaigns = lazy(() => import('./pages/Campaigns'))
const Notifications = lazy(() => import('./pages/Notifications'))

const PAGES: Record<string, React.ReactNode> = {
  '/supplier-accounts': <SupplierAccounts />,
  '/devices': <Devices />,
  '/repairs': <Repairs />,
  '/maintenance': <Maintenance />,
  '/sales': <Sales />,
  '/cash': <Cash />,
  '/expenses': <Expenses />,
  '/transactions': <Transactions />,
  '/products': <Products />,
  '/inventory': <Inventory />,
  '/online-orders': <OnlineOrders />,
  '/suppliers': <Suppliers />,
  '/purchase-orders': <PurchaseOrders />,
  '/approvals': <Approvals />,
  '/audit': <AuditLog />,
  '/security': <Security />,
  '/customers': <Customers />,
  '/accounts': <Accounts />,
  '/supply': <Supply />,
  '/offers': <Offers />,
  '/returns': <Returns />,
  '/wallet-ops': <WalletOps />,
  '/bills': <Bills />,
  '/installments': <Installments />,
  '/inout': <InOut />,
  '/trade-in': <TradeIn />,
  '/employee-accounts': <EmployeeAccounts />,
  '/attendance': <Attendance />,
  '/team': <Team />,
  '/mobile-tax': <MobileTax />,
  '/reports': <Reports />,
  '/settings': <Settings />,
  '/campaigns': <Campaigns />,
  '/notifications': <Notifications />,
}

export default function App() {
  usePointerFx()
  return (
    <>
      <Wallpaper />
      <AppRoutes />
    </>
  )
}

function AppRoutes() {
  const { session, loading, roles, canPage, recovery } = useAuth()

  if (recovery && session) return <ResetPassword />
  if (loading) return <State kind="loading" />
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  if (roles.length === 0) {
    return (
      <State
        kind="error"
        title="لا توجد صلاحيات لحسابك"
        text="اطلب من المالك إضافة دور لحسابك ثم أعد تسجيل الدخول."
      />
    )
  }
  return (
    <Suspense fallback={<State kind="loading" />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          {NAV.filter((n) => PAGES[n.to]).map((n) => (
            <Route
              key={n.to}
              path={n.to.slice(1)}
              element={canPage(n.to) ? <RequireRole roles={n.roles}>{PAGES[n.to]}</RequireRole> : <State kind="error" title="غير مصرح" text="المالك قفل هذه الصفحة على حسابك." />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
