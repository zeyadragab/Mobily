import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { NAV, ROLE_LABEL } from '../lib/roles'
import { Icon } from './ui'

const GLASS = 'bg-surface/70 backdrop-blur-2xl backdrop-saturate-150'

export default function Shell() {
  const { roles, fullName, hasRole, signOut } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch { /* storage blocked */ }
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const items = NAV.filter((n) => hasRole(...n.roles))
  const groups = [...new Set(items.map((i) => i.group))]
  const current = items.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)))

  const brand = (
    <div className="flex items-center gap-3 px-5 pb-2 pt-5">
      <span aria-hidden="true" className="flex gap-1.5" dir="ltr">
        <i className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <i className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <i className="h-3 w-3 rounded-full bg-[#28c840]" />
      </span>
      <span className="text-[15px] font-bold tracking-tight">إدارة المتجر</span>
    </div>
  )

  const nav = (
    <nav aria-label="التنقل الرئيسي" className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 px-3 text-[11px] font-semibold text-muted">{g}</p>
          {items
            .filter((i) => i.group === g)
            .map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition duration-150 active:scale-[0.98] ${
                    isActive ? 'bg-accent font-semibold text-accent-fg shadow-soft' : 'text-fg/80 hover:bg-fg/[0.06] hover:text-fg'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon name={n.icon} className={`h-[18px] w-[18px] transition ${isActive ? '' : 'text-accent group-hover:scale-110'}`} />
                    {n.label}
                  </>
                )}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  )

  const user = (
    <div className="space-y-2.5 border-t border-line/70 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-accent/80 to-accent text-sm font-bold text-accent-fg shadow-soft">
          {(fullName || '؟').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" dir="auto">{fullName || 'مستخدم'}</p>
          <p className="truncate text-xs text-muted">{roles.map((r) => ROLE_LABEL[r]).join('، ')}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={toggleTheme} aria-pressed={dark}
          className="flex-1 rounded-[10px] border border-line bg-surface/80 px-3 py-2 text-sm shadow-soft transition hover:bg-bg active:scale-[0.97]">
          {dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
        </button>
        <button onClick={signOut}
          className="flex-1 rounded-[10px] border border-line bg-surface/80 px-3 py-2 text-sm shadow-soft transition hover:bg-bg active:scale-[0.97]">
          خروج
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <aside className={`sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-line/70 lg:flex ${GLASS}`}>
        {brand}
        {nav}
        {user}
      </aside>

      <header className={`sticky top-0 z-20 flex items-center justify-between border-b border-line/70 px-4 py-3 lg:hidden ${GLASS}`}>
        <span className="font-bold">{current?.label ?? 'إدارة المتجر'}</span>
        <button
          aria-label="القائمة"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="rounded-[10px] border border-line bg-surface/80 px-3 py-1.5 text-sm shadow-soft active:scale-95"
        >
          ☰
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 animate-fade bg-black/35 backdrop-blur-sm" />
          <aside
            className={`absolute inset-y-0 start-0 flex w-72 animate-sheet flex-col shadow-window ${GLASS}`}
            onClick={(e) => e.stopPropagation()}
          >
            {brand}
            {nav}
            {user}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <div key={pathname} className="mx-auto max-w-6xl animate-page">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
