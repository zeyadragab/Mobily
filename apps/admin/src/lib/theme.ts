import { useCallback, useState } from 'react'

export const ACCENTS = [
  { key: 'blue', label: 'أزرق', color: '#0064d2' },
  { key: 'green', label: 'أخضر', color: '#1a8f4c' },
  { key: 'violet', label: 'بنفسجي', color: '#6d3fd1' },
  { key: 'orange', label: 'برتقالي', color: '#d9620b' },
  { key: 'rose', label: 'وردي', color: '#d02a5c' },
] as const

const store = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage blocked */ } }
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }

/** Light / dark, accent colour and solid (no blur) mode. Saved in this browser only; public/theme.js applies them before first paint. */
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const [accent, setAccentState] = useState(() => read('accent') ?? ACCENTS[0].color)
  const [solid, setSolid] = useState(() => document.documentElement.classList.contains('is-solid'))

  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
      store('theme', next ? 'dark' : 'light')
      return next
    })
  }, [])

  const toggleSolid = useCallback(() => {
    setSolid((s) => {
      const next = !s
      document.documentElement.classList.toggle('is-solid', next)
      store('solid', next ? '1' : '0')
      return next
    })
  }, [])

  const setAccent = useCallback((color: string) => {
    setAccentState(color)
    if (color === ACCENTS[0].color) document.documentElement.style.removeProperty('--accent')
    else document.documentElement.style.setProperty('--accent', color)
    store('accent', color)
  }, [])

  return { dark, toggle, accent, setAccent, solid, toggleSolid }
}
