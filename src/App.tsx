import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import Ideas from './Ideas'
import Insights from './Insights'
import MapView from './MapView'
import Search from './Search'
import Settings from './Settings'
import Timeline from './Timeline'
import Trash from './Trash'
import Wiki from './Wiki'
import Write from './Write'
import { useBook } from './store'

const tools = ['Write', 'Timeline', 'Ideas', 'Map', 'Wiki', 'Insights', 'Search'] as const

export default function App() {
  const { book, dirty, ready } = useBook()
  const nav = useNavigate()
  // In-app hotkeys: browsers can't register OS-wide shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
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
  // Browser storage is the working copy; warn before closing with unpushed work.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    addEventListener('beforeunload', h)
    return () => removeEventListener('beforeunload', h)
  }, [dirty])
  if (!ready) return null
  return (
    <div className="app">
      <nav>
        <h3>{book.title}{dirty && ' ●'}</h3>
        {tools.map((t) => <NavLink key={t} to={`/${t.toLowerCase()}`}>{t}</NavLink>)}
        <NavLink to="/trash" className="bottom">Trash</NavLink>
        <NavLink to="/settings">Settings and Sync</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/write" replace />} />
          <Route path="/write" element={<Write />} />
          <Route path="/wiki/:id?" element={<Wiki />} />
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
