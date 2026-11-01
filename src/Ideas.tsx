import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trashIt } from './history'
import { uid, useBook, type WikiEntry } from './store'

const TYPES = ['character', 'organization', 'location', 'event', 'item']
const tagsOf = (t: string) => [...t.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase())

export default function Ideas() {
  const { book, update } = useBook()
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [tag, setTag] = useState('')

  const add = () => {
    if (!text.trim()) return
    update((b) => ({ ...b, ideas: [{ id: uid(), text: text.trim(), tags: tagsOf(text), pinned: false }, ...b.ideas] }))
    setText('')
  }
  const drop = (id: string) => update((b) => ({ ...b, ideas: b.ideas.filter((i) => i.id !== id) }))
  const pin = (id: string) =>
    update((b) => ({ ...b, ideas: b.ideas.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i)) }))
  const toScene = (id: string, t: string) => {
    update((b) => ({ ...b, scenes: [...b.scenes, { id: uid(), title: t.slice(0, 60), summary: t }] }))
    drop(id)
  }
  const toWiki = (id: string, t: string, type: string) => {
    const w: WikiEntry = { id: uid(), type, name: t.replace(/#\w+/g, '').trim().slice(0, 40), fields: {}, notes: t }
    update((b) => ({ ...b, wiki: [...b.wiki, w] }))
    drop(id)
    nav(`/wiki/${w.id}`)
  }

  const allTags = [...new Set(book.ideas.flatMap((i) => i.tags))]
  const shown = book.ideas
    .filter((i) => !tag || i.tags.includes(tag))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))

  return (
    <div className="page wide">
      <h1>Ideas</h1>
      <div className="row">
        <input
          id="idea-input" className="grow" autoFocus value={text} placeholder="Jot an idea... use #tags, Enter to save"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button onClick={add}>Add</button>
      </div>
      {allTags.length > 0 && (
        <div className="row">
          <button className={tag ? 'alt' : ''} onClick={() => setTag('')}>all</button>
          {allTags.map((t) => <button key={t} className={tag === t ? '' : 'alt'} onClick={() => setTag(t)}>#{t}</button>)}
        </div>
      )}
      {shown.map((i) => (
        <div key={i.id} className="item">
          <span>{i.pinned && '📌 '}{i.text}</span>
          <div className="row">
            <button className="alt" onClick={() => pin(i.id)}>{i.pinned ? 'Unpin' : 'Pin'}</button>
            <button className="alt" onClick={() => toScene(i.id, i.text)}>→ Scene</button>
            <select value="" onChange={(e) => e.target.value && toWiki(i.id, i.text, e.target.value)}>
              <option value="">→ Wiki...</option>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className="danger" onClick={() => { trashIt('ideas', i.text.slice(0, 50), i); drop(i.id) }}>Delete</button>
          </div>
        </div>
      ))}
      {!shown.length && <p className="muted">No ideas yet. Press Ctrl+Shift+I anywhere to jump here.</p>}
    </div>
  )
}
