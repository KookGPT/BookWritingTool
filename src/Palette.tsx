import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type Chapter, uid, useBook } from './store'
import { runSync } from './sync'

interface Item { label: string; run: () => void }

export default function Palette({ onClose }: { onClose: () => void }) {
  const { book, update } = useBook()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const newChapter = () => {
    const c: Chapter = { id: uid(), title: `Chapter ${book.chapters.length + 1}`, body: '', status: 'draft', notes: '' }
    update((b) => ({ ...b, chapters: [...b.chapters, c] }))
    nav(`/write?c=${c.id}`)
  }
  const items: Item[] = [
    { label: 'New chapter', run: newChapter },
    { label: 'New idea', run: () => { nav('/ideas'); setTimeout(() => document.getElementById('idea-input')?.focus()) } },
    { label: 'Sync now', run: () => runSync() },
    ...['Today', 'Write', 'Manuscript', 'Timeline', 'Scenes', 'Calendar', 'Ideas', 'Globe', 'Map', 'Wiki', 'Insights', 'Search', 'Trash', 'Settings'].map((n) => ({ label: `Go to ${n}`, run: () => nav(`/${n.toLowerCase()}`) })),
    ...book.chapters.map((c) => ({ label: `Chapter: ${c.title}`, run: () => nav(`/write?c=${c.id}`) })),
    ...book.wiki.map((w) => ({ label: `${w.type}: ${w.name}`, run: () => nav(`/wiki/${w.id}`) })),
    ...book.scenes.map((s) => ({ label: `Scene: ${s.title}`, run: () => nav('/scenes') })),
    ...book.events.map((e) => ({ label: `Event: ${e.title}`, run: () => nav(`/timeline?e=${e.id}`) })),
  ]
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = items.filter((i) => words.every((w) => i.label.toLowerCase().includes(w))).slice(0, 12)
  const pick = (i?: Item) => { if (i) { onClose(); i.run() } }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input} value={q} placeholder="Type a command, chapter, or wiki entry..."
          onChange={(e) => { setQ(e.target.value); setIdx(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(idx + 1, shown.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(idx - 1, 0)) }
            else if (e.key === 'Enter') pick(shown[idx])
          }}
        />
        {shown.map((i, n) => (
          <div key={i.label} className={`opt ${n === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(n)} onClick={() => pick(i)}>{i.label}</div>
        ))}
        {!shown.length && <p className="muted">No matches.</p>}
      </div>
    </div>
  )
}
