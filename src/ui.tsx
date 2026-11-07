import { type ReactNode, useEffect, useState } from 'react'

// One header for every page: title left, actions right, a one-line hint underneath.
export function PageHead({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="page-head"><h1>{title}</h1>{children && <div className="page-actions">{children}</div>}</div>
      {hint && <p className="page-hint">{hint}</p>}
    </>
  )
}

// State kept in localStorage (a remembered tab, a setting). Never throws: private mode just forgets.
export const readLocal = <T,>(key: string, init: T): T => { try { const s = localStorage.getItem(key); return s === null ? init : (JSON.parse(s) as T) } catch { return init } }
export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => readLocal(key, init))
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private mode */ } }, [key, v])
  return [v, setV]
}

// A steady colour for an id (POV characters, wiki avatars), so the same person is the same colour everywhere.
const HUES = ['#7aa7d9', '#e2a94d', '#b69cf0', '#e5796a', '#7cc4a0', '#d98fb8', '#9aa7a0']
export const colorOf = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length] }
