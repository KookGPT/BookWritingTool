import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import CalendarPage from './CalendarPage'
import Icon, { type IconName } from './Icon'
import Ideas from './Ideas'
import Insights from './Insights'
import Palette from './Palette'
import Manuscript from './Manuscript'
import Search from './Search'
import Settings from './Settings'
import Scenes from './Scenes'
import TimelinePage from './TimelinePage'
import Trash from './Trash'
import Wiki from './Wiki'
import Write from './Write'
import { useBook } from './store'
import { loadSettings, runSync, useSyncStatus } from './sync'

// The Globe (src/world/) and the old image maps (MapView.tsx) are hidden on request; their code is kept. Their addresses open the map.
const MapTestPage = lazy(() => import('./flatworld/MapTestPage'))

const NAV: { label: string; items: [path: string, name: string, icon: IconName][] }[] = [
  { label: 'Write', items: [['write', 'Write', 'pen'], ['manuscript', 'Manuscript', 'book']] },
  { label: 'Plan', items: [['timeline', 'Timeline', 'timeline'], ['scenes', 'Scenes', 'list'], ['calendar', 'Calendar', 'calendar'], ['ideas', 'Ideas', 'idea']] },
  { label: 'World', items: [['wiki', 'Wiki', 'wiki'], ['map-test', 'Map', 'mountain']] },
  { label: 'Review', items: [['insights', 'Insights', 'insights'], ['search', 'Search', 'search']] },
]

const stored = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export default function App() {
  const { book, dirty, ready } = useBook()
  const nav = useNavigate()
  const [theme, setTheme] = useState(() => stored('theme', 'dark'))
  const [collapsed, setCollapsed] = useState(() => stored('nav-collapsed', '') === '1')
  useEffect(() => { document.documentElement.dataset.theme = theme; keep('theme', theme) }, [theme])
  useEffect(() => keep('nav-collapsed', collapsed ? '1' : ''), [collapsed])

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

  const configured = !!loadSettings().token
  const syncState = !configured ? 'off' : sync.busy ? 'busy' : /^Error/.test(sync.text) ? 'err' : dirty ? 'pending' : 'ok'
  const syncLabel = { off: 'Set up sync', busy: 'Syncing...', err: 'Sync problem', pending: 'Unsynced changes', ok: 'Synced' }[syncState]

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      {palette && <Palette onClose={() => setPalette(false)} />}
      <button className="skip" onClick={() => document.getElementById('main')?.focus()}>Skip to content</button>
      <nav className="side" aria-label="Main">
        <div className="brand"><Icon name="mountain" size={22} /><span className="label">{book.title}</span></div>
        <button className="cmdk" onClick={() => setPalette(true)} aria-label="Open command palette">
          <Icon name="search" /><span className="label">Search or jump...</span><kbd>Ctrl K</kbd>
        </button>
        {NAV.map((g) => (
          <div key={g.label} style={{ display: 'contents' }}>
            <div className="group-label">{g.label}</div>
            {g.items.map(([path, name, icon]) => (
              <NavLink key={path} to={`/${path}`} className="navlink" title={name} aria-label={name}>
                <Icon name={icon} /><span className="label">{name}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="foot">
          <button
            className={`syncpill ${syncState}`} title={sync.text || syncLabel}
            onClick={() => (configured ? runSync() : nav('/settings'))} aria-live="polite"
          >
            <Icon name="refresh" /><span className="label">{syncLabel}</span>
          </button>
          <NavLink to="/trash" className="navlink" title="Trash" aria-label="Trash"><Icon name="trash" /><span className="label">Trash</span></NavLink>
          <NavLink to="/settings" className="navlink" title="Settings and sync" aria-label="Settings and sync"><Icon name="settings" /><span className="label">Settings</span></NavLink>
          <div className="tools">
            <button className="ghost icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button className="ghost icon" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Collapse sidebar">
              <Icon name={collapsed ? 'right' : 'left'} />
            </button>
          </div>
        </div>
      </nav>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/write" replace />} />
          <Route path="/write" element={<Write />} />
          <Route path="/manuscript" element={<Manuscript />} />
          <Route path="/wiki/:id?" element={<Wiki />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/ideas" element={<Ideas />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/scenes" element={<Scenes />} />
          <Route path="/globe" element={<Navigate to="/map-test" replace />} />
          <Route path="/map-test" element={<Suspense fallback={null}><MapTestPage /></Suspense>} />
          <Route path="/map" element={<Navigate to="/map-test" replace />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/search" element={<Search />} />
          <Route path="/trash" element={<Trash />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
