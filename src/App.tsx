import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import Graph from './Graph'
import Ideas from './Ideas'
import Insights from './Insights'
import MapView from './MapView'
import Palette from './Palette'
import Manuscript from './Manuscript'
import Search from './Search'
import Settings from './Settings'
import Timeline from './Timeline'
import Trash from './Trash'
import Wiki from './Wiki'
import Write from './Write'
import { useBook } from './store'
import { loadSettings, runSync, useSyncStatus } from './sync'

const tools = ['Write', 'Manuscript', 'Timeline', 'Ideas', 'Map', 'Wiki', 'Insights', 'Search'] as const

export default function App() {
  const { book, dirty, ready } = useBook()
  const nav = useNavigate()
  // In-app hotkeys: browsers can't register OS-wide shortcuts.
  const [palette, setPalette] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return }
      if (!e.ctrlKey || !e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'i' || k === 'f') {
        e.preventDefault()
        nav(k === 'i' ? '/ideas' : '/search')
        setTimeout(() => document.getElementById(k === 'i' ? 'idea-input' : 'search-input')?.focus())
      }
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [nav])
  const sync = useSyncStatus()
  // Auto-sync: on open, when returning to the app, and shortly after edits stop.
  useEffect(() => {
    if (!ready || loadSettings().auto === false) return
    const go = () => { if (document.visibilityState === 'visible') runSync() }
    go()
    addEventListener('focus', go)
    document.addEventListener('visibilitychange', go)
    return () => { removeEventListener('focus', go); document.removeEventListener('visibilitychange', go) }
  }, [ready])
  useEffect(() => {
    if (!dirty || loadSettings().auto === false) return
    const t = setTimeout(() => runSync(), 20_000)
    return () => clearTimeout(t)
  }, [dirty, book])
  // Browser storage is the working copy; warn before closing with unpushed work.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    addEventListener('beforeunload', h)
    return () => removeEventListener('beforeunload', h)
  }, [dirty])
  if (!ready) return null
  return (
    <div className="app">
      {palette && <Palette onClose={() => setPalette(false)} />}
      <nav>
        <h3>{book.title}{dirty && ' ●'}</h3>
        {tools.map((t) => <NavLink key={t} to={`/${t.toLowerCase()}`}>{t}</NavLink>)}
        <small className="muted bottom">Ctrl+K: command palette</small>
        <NavLink to="/trash">Trash</NavLink>
        <NavLink to="/settings">Settings and Sync</NavLink>
        {sync.text && <small className="muted syncmsg">{sync.busy ? '⟳ ' : ''}{sync.text}</small>}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/write" replace />} />
          <Route path="/write" element={<Write />} />
          <Route path="/manuscript" element={<Manuscript />} />
          <Route path="/wiki/:id?" element={<Wiki />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="/ideas" element={<Ideas />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/search" element={<Search />} />
          <Route path="/trash" element={<Trash />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
