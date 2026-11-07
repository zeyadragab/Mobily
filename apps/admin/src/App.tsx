import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import Shell from './components/Shell'
import { RequireRole } from './components/RequireRole'
import { State } from './components/State'
import Login from './pages/Login'
import { NAV } from './lib/roles'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Products = lazy(() => import('./pages/Products'))
const Inventory = lazy(() => import('./pages/Inventory'))
const SupplierAccounts = lazy(() => import('./pages/SupplierAccounts'))
const Devices = lazy(() => import('./pages/Devices'))
const Sales = lazy(() => import('./pages/Sales'))
const Cash = lazy(() => import('./pages/Cash'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Transactions = lazy(() => import('./pages/Transactions'))
const OnlineOrders = lazy(() => import('./pages/OnlineOrders'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'))
const Approvals = lazy(() => import('./pages/Approvals'))
const AuditLog = lazy(() => import('./pages/AuditLog'))

const PAGES: Record<string, React.ReactNode> = {
  '/supplier-accounts': <SupplierAccounts />,
  '/devices': <Devices />,
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
}

export default function App() {
  const { session, loading, roles } = useAuth()

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
              element={<RequireRole roles={n.roles}>{PAGES[n.to]}</RequireRole>}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
