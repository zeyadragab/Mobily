import { useCallback, useState } from 'react'

export const ACCENTS = [
  { key: 'blue', label: 'أزرق', color: '#0064d2' },
  { key: 'green', label: 'أخضر', color: '#1a8f4c' },
  { key: 'violet', label: 'بنفسجي', color: '#6d3fd1' },
  { key: 'orange', label: 'برتقالي', color: '#d9620b' },
  { key: 'rose', label: 'وردي', color: '#d02a5c' },
] as const

export const WALLS = [
  { key: 'ribbon', label: 'شرائط', css: 'linear-gradient(135deg,#1f3bb8,#d02d7a 60%,#ff9a3d)' },
  { key: 'tide', label: 'موج', css: 'linear-gradient(135deg,#1d55dc,#0ba9bd 55%,#4c33d8)' },
  { key: 'ember', label: 'جمر', css: 'linear-gradient(135deg,#c4501a,#b8304e 55%,#c98a12)' },
  { key: 'grove', label: 'غابة', css: 'linear-gradient(135deg,#1c8f55,#138a86 55%,#5e9e1f)' },
  { key: 'aurora', label: 'شفق', css: 'linear-gradient(135deg,#2b3a8c,#34469e 55%,#1c2766)' },
  { key: 'bloom', label: 'زهرة', css: 'linear-gradient(135deg,#2c46c8,#c2306c 55%,#c4501f)' },
  { key: 'ash', label: 'رماد', css: 'linear-gradient(135deg,#4a4b52,#232428)' },
  { key: 'sand', label: 'رمل', css: 'linear-gradient(135deg,#c9a27c,#3a2a1e)' },
  { key: 'sage', label: 'مريمية', css: 'linear-gradient(135deg,#8fae92,#1f2c23)' },
] as const

const store = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage blocked */ } }
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }

/** Light / dark, accent colour and solid (no blur) mode. Saved in this browser only; public/theme.js applies them before first paint. */
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const [accent, setAccentState] = useState(() => read('accent') ?? ACCENTS[0].color)
  const [wall, setWallState] = useState<string>(() => document.documentElement.getAttribute('data-wall') ?? 'ribbon')
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

  const setWall = useCallback((key: string) => {
    setWallState(key)
    document.documentElement.setAttribute('data-wall', key)
    store('wall', key)
  }, [])

  const setAccent = useCallback((color: string) => {
    setAccentState(color)
    if (color === ACCENTS[0].color) document.documentElement.style.removeProperty('--accent')
    else document.documentElement.style.setProperty('--accent', color)
    store('accent', color)
  }, [])

  return { dark, toggle, accent, setAccent, solid, toggleSolid, wall, setWall }
}
