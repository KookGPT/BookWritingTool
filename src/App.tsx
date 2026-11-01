import { NavLink, Route, Routes } from 'react-router-dom'
import Settings from './Settings'
import Write from './Write'
import { useBook } from './store'

const tools = ['Write', 'Timeline', 'Ideas', 'Map', 'Wiki'] as const

const Soon = ({ name }: { name: string }) => (
  <div className="page"><h1>{name}</h1><p className="muted">Coming in a later phase.</p></div>
)

export default function App() {
  const { book, dirty, ready } = useBook()
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
          {tools.filter((t) => t !== 'Write').map((t) => <Route key={t} path={`/${t.toLowerCase()}`} element={<Soon name={t} />} />)}
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
