import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import Ideas from './Ideas'
import Settings from './Settings'
import Timeline from './Timeline'
import Wiki from './Wiki'
import Write from './Write'
import { useBook } from './store'

const tools = ['Write', 'Timeline', 'Ideas', 'Map', 'Wiki'] as const

const Soon = ({ name }: { name: string }) => (
  <div className="page"><h1>{name}</h1><p className="muted">Coming in a later phase.</p></div>
)

export default function App() {
  const { book, dirty, ready } = useBook()
  const nav = useNavigate()
  // In-app hotkey: browsers can't register OS-wide shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        nav('/ideas')
        setTimeout(() => document.getElementById('idea-input')?.focus())
      }
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [nav])
  if (!ready) return null
  return (
    <div className="app">
      <nav>
        <h3>{book.title}{dirty && ' ●'}</h3>
        {tools.map((t) => <NavLink key={t} to={`/${t.toLowerCase()}`}>{t}</NavLink>)}
        <NavLink to="/settings" className="bottom">Settings and Sync</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Soon name="Welcome" />} />
          <Route path="/write" element={<Write />} />
          <Route path="/wiki/:id?" element={<Wiki />} />
          <Route path="/ideas" element={<Ideas />} />
          <Route path="/timeline" element={<Timeline />} />
          {tools.filter((t) => !['Write', 'Wiki', 'Ideas', 'Timeline'].includes(t)).map((t) => <Route key={t} path={`/${t.toLowerCase()}`} element={<Soon name={t} />} />)}
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
