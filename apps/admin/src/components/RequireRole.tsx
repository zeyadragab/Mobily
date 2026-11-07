import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { AppRole } from '../lib/roles'
import { State } from './State'

export function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { hasRole } = useAuth()
  if (!hasRole(...roles)) {
    return <State kind="error" title="غير مصرح" text="ليس لديك صلاحية لفتح هذه الصفحة." />
  }
  return <>{children}</>
}
