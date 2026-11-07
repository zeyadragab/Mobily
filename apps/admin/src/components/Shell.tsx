import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { NAV, ROLE_LABEL } from '../lib/roles'
import { Icon } from './ui'

export default function Shell() {
  const { roles, fullName, hasRole, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch { /* storage blocked */ }
  }
  const items = NAV.filter((n) => hasRole(...n.roles))
  const groups = [...new Set(items.map((i) => i.group))]

  const nav = (
    <nav aria-label="التنقل الرئيسي" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 px-3 text-xs font-medium text-muted">{g}</p>
          {items
            .filter((i) => i.group === g)
            .map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                    isActive ? 'bg-accent font-semibold text-accent-fg' : 'text-muted hover:bg-bg hover:text-fg'
                  }`
                }
              >
                <Icon name={n.icon} />
                {n.label}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  )

  const user = (
    <div className="space-y-2 border-t border-line p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">
          {(fullName || '؟').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" dir="auto">{fullName || 'مستخدم'}</p>
          <p className="truncate text-xs text-muted">{roles.map((r) => ROLE_LABEL[r]).join('، ')}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={toggleTheme} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm hover:bg-bg">
          {dark ? '☀ فاتح' : '🌙 داكن'}
        </button>
        <button onClick={signOut} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm hover:bg-bg">
          خروج
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-line bg-surface lg:flex">
        <div className="px-6 py-5 text-lg font-bold">إدارة المتجر</div>
        {nav}
        {user}
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <span className="font-bold">إدارة المتجر</span>
        <button
          aria-label="القائمة"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
        >
          ☰
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside
            className="absolute inset-y-0 start-0 flex w-72 flex-col bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            {nav}
            {user}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
