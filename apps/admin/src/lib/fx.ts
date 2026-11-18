import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Pointer effects: the wallpaper layers shift a few pixels (--mx, --my on the root) and a soft glint
 * follows the pointer across the glass panel under it (--gx, --gy). Call once at the app root.
 */
export function usePointerFx(): void {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    let frame = 0
    const on = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const root = document.documentElement.style
        root.setProperty('--mx', String((e.clientX / window.innerWidth - 0.5) * 2))
        root.setProperty('--my', String((e.clientY / window.innerHeight - 0.5) * 2))
        const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.glass')
        if (!el) return
        const r = el.getBoundingClientRect()
        el.style.setProperty('--gx', `${e.clientX - r.left}px`)
        el.style.setProperty('--gy', `${e.clientY - r.top}px`)
      })
    }
    window.addEventListener('pointermove', on, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', on)
    }
  }, [])
}

/**
 * Staggers the entrance of a page. Every .gcard on the page (outside dialogs) is stamped once, top to bottom
 * and left to right, so blocks rise one after another. A short-lived observer also stamps cards that appear
 * after the lazy page chunk or its first data arrives; after that, cards that re-render do not replay it.
 */
export function useReveal(key: string): void {
  useLayoutEffect(() => {
    const main = document.getElementById('main')
    if (!main) return
    let count = 0
    const stamp = () => {
      const fresh = Array.from(main.querySelectorAll<HTMLElement>('.gcard:not([data-r])')).filter((el) => !el.closest('dialog'))
      if (fresh.length === 0) return
      fresh.sort((a, b) => {
        const ra = a.getBoundingClientRect()
        const rb = b.getBoundingClientRect()
        return Math.abs(ra.top - rb.top) > 24 ? ra.top - rb.top : ra.left - rb.left
      })
      fresh.forEach((el) => {
        el.dataset.r = '1'
        el.style.setProperty('--d', `${60 + Math.min(count++, 14) * 85}ms`)
      })
    }
    stamp()
    const mo = new MutationObserver(stamp)
    mo.observe(main, { childList: true, subtree: true })
    const stop = window.setTimeout(() => mo.disconnect(), 4000)
    return () => {
      mo.disconnect()
      window.clearTimeout(stop)
    }
  }, [key])
}

/** Everything that happens on a route change: entrance, scroll to top, focus moved to <main>. */
export function useRouteFx(route: string): void {
  useReveal(route)
  const first = useRef(true)
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    if (first.current) {
      first.current = false
      return
    }
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [route])
}
