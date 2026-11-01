import { useState } from 'react'
import { Link } from 'react-router-dom'
import { plain, useBook } from './store'

const snippet = (text: string, q: string) => {
  const i = text.toLowerCase().indexOf(q)
  return text.slice(Math.max(0, i - 40), i + q.length + 60).trim()
}

export default function Search() {
  const { book } = useBook()
  const [raw, setRaw] = useState('')
  const q = raw.trim().toLowerCase()

  const hits: { key: string; kind: string; title: string; text: string; to: string }[] = []
  if (q) {
    for (const c of book.chapters) {
      const t = `${c.title} ${plain(c.body)} ${c.notes}`
      if (t.toLowerCase().includes(q)) hits.push({ key: c.id, kind: 'chapter', title: c.title, text: snippet(t, q), to: `/write?c=${c.id}` })
    }
    for (const w of book.wiki) {
      const t = `${w.name} ${Object.values(w.fields).join(' ')} ${w.notes}`
      if (t.toLowerCase().includes(q)) hits.push({ key: w.id, kind: w.type, title: w.name, text: snippet(t, q), to: `/wiki/${w.id}` })
    }
    for (const s of book.scenes) {
      const t = `${s.title} ${s.summary}`
      if (t.toLowerCase().includes(q)) hits.push({ key: s.id, kind: 'scene', title: s.title, text: snippet(t, q), to: '/scenes' })
    }
    for (const i of book.ideas)
      if (i.text.toLowerCase().includes(q)) hits.push({ key: i.id, kind: 'idea', title: i.text.slice(0, 50), text: snippet(i.text, q), to: '/ideas' })
  }

  return (
    <div className="page wide">
      <h1>Search</h1>
      <input id="search-input" autoFocus value={raw} placeholder="Search chapters, wiki, scenes, ideas..." onChange={(e) => setRaw(e.target.value)} />
      {q && <small className="muted">{hits.length} result{hits.length === 1 ? '' : 's'}</small>}
      {hits.map((h) => (
        <Link key={h.kind + h.key} to={h.to} className="item">
          <span><small className="muted">{h.kind.toUpperCase()}</small> {h.title}</span>
          <small className="muted">…{h.text}…</small>
        </Link>
      ))}
    </div>
  )
}
