import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { NAV, ROLE_LABEL } from '../lib/roles'
import { Icon } from './ui'
import { useTheme } from '../lib/theme'
import { useRouteFx } from '../lib/fx'
import TopBar, { AlertBanner } from './TopBar'
import IdleLock from './IdleLock'

type Item = (typeof NAV)[number]

/** Moves the highlight lens under the item marked aria-current="page", with a spring. */
function useLens(track: RefObject<HTMLElement | null>, lens: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const place = () => {
      const t = track.current
      const l = lens.current
      if (!t || !l) return
      const a = t.querySelector<HTMLElement>('[aria-current="page"]')
      if (!a || a.offsetWidth === 0) {
        l.style.opacity = '0'
        return
      }
      const rtl = document.documentElement.dir === 'rtl'
      const x = rtl ? a.offsetLeft + a.offsetWidth - t.clientWidth : a.offsetLeft
      l.style.width = `${a.offsetWidth}px`
      l.style.height = `${a.offsetHeight}px`
      l.style.transform = `translate(${x}px, ${a.offsetTop}px)`
      l.style.opacity = '1'
    }
    place()
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => window.removeEventListener('resize', place)
  }, [track, lens, key])
}

function NavList({ items, groups, routeKey, onPick }: { items: Item[]; groups: string[]; routeKey: string; onPick: () => void }) {
  const track = useRef<HTMLElement>(null)
  const lens = useRef<HTMLSpanElement>(null)
  useLens(track, lens, routeKey)
  return (
    <nav ref={track} aria-label="التنقل الرئيسي" className="relative flex-1 space-y-4 overflow-y-auto px-3 py-3">
      <span ref={lens} className="lens" aria-hidden="true" />
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 px-3.5 text-[11px] font-semibold text-muted">{g}</p>
          {items
            .filter((i) => i.group === g)
            .map((n) => n.soon ? (
              <div key={n.to} aria-disabled="true" title="هذه الصفحة تحت التنفيذ" className="flex cursor-not-allowed items-center gap-3 rounded-full px-3.5 py-2 text-sm text-muted/70">
                <Icon name={n.icon} className="ico h-[18px] w-[18px] opacity-50" />
                <span className="flex-1">{n.label}</span>
                <span className="rounded-full bg-fg/[0.08] px-2 py-0.5 text-[10px]">{n.soon}</span>
              </div>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onPick} className="nav-item">
                <Icon name={n.icon} className="ico h-[18px] w-[18px] transition" />
                {n.label}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  )
}

export default function Shell() {
  const { roles, fullName, hasRole, canPage, signOut } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const { dark, toggle: toggleTheme } = useTheme()
  useRouteFx(pathname)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const items = NAV.filter((n) => hasRole(...n.roles) && canPage(n.to))
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

  const user = (
    <div className="space-y-2.5 border-t border-line p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-accent/70 to-accent text-sm font-bold text-accent-fg shadow-soft [box-shadow:inset_0_0_0_1px_rgb(255_255_255/0.25)]">
          {(fullName || '؟').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" dir="auto">{fullName || 'مستخدم'}</p>
          <p className="truncate text-xs text-muted">{roles.map((r) => ROLE_LABEL[r]).join('، ')}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={toggleTheme} aria-pressed={dark}
          className="btn-glass flex-1 rounded-full px-3 py-2 text-sm active:scale-[0.97]">
          {dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
        </button>
        <button onClick={signOut}
          className="btn-glass flex-1 rounded-full px-3 py-2 text-sm active:scale-[0.97]">
          خروج
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <IdleLock />
      <a href="#main" className="fixed start-4 top-[-60px] z-[100] rounded-xl bg-[var(--glass-thick)] px-4 py-2 text-fg focus:top-4">
        تخطي إلى المحتوى
      </a>

      <aside className="glass sticky top-3.5 m-3.5 hidden h-[calc(100dvh-28px)] w-64 shrink-0 animate-[reveal_900ms_var(--ease-io)_both] flex-col self-start rounded-[32px] lg:flex">
        {brand}
        <NavList items={items} groups={groups} routeKey={pathname} onPick={() => setOpen(false)} />
        {user}
      </aside>

      <header className="glass sticky top-2 z-20 mx-2 mt-2 flex items-center justify-between rounded-full py-2 ps-5 pe-2 lg:hidden">
        <span className="font-bold">{current?.label ?? 'إدارة المتجر'}</span>
        <button
          aria-label="القائمة"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="btn-glass rounded-full px-4 py-1.5 text-sm active:scale-95"
        >
          ☰
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 animate-fade bg-[var(--scrim)] backdrop-blur-sm" />
          <aside
            className="glass glass--thick absolute inset-y-3 start-3 flex w-72 max-w-[calc(100vw-24px)] animate-sheet flex-col rounded-[32px]"
            onClick={(e) => e.stopPropagation()}
          >
            {brand}
            <NavList items={items} groups={groups} routeKey={`m${pathname}`} onPick={() => setOpen(false)} />
            {user}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <TopBar />
        <main id="main" tabIndex={-1} className="px-4 py-6 outline-none lg:px-8 lg:py-6">
          <AlertBanner />
          <div key={pathname} className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
