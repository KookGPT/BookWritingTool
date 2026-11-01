import { Fragment, useState } from 'react'
import { type Scene, uid, useBook } from './store'

const STATUSES = ['planned', 'drafting', 'done'] as const

function SceneForm({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const { book, update } = useBook()
  const patch = (p: Partial<Scene>) =>
    update((b) => ({ ...b, scenes: b.scenes.map((s) => (s.id === scene.id ? { ...s, ...p } : s)) }))
  const chars = book.wiki.filter((w) => w.type === 'character')
  const places = book.wiki.filter((w) => w.type === 'location')
  const here = scene.characters ?? []
  const i = book.scenes.findIndex((s) => s.id === scene.id)
  const move = (d: number) =>
    update((b) => {
      const ss = [...b.scenes]
      ;[ss[i], ss[i + d]] = [ss[i + d], ss[i]]
      return { ...b, scenes: ss }
    })

  return (
    <div className="panel">
      <input className="title" value={scene.title} onChange={(e) => patch({ title: e.target.value })} />
      <textarea rows={4} placeholder="What happens?" value={scene.summary} onChange={(e) => patch({ summary: e.target.value })} />
      <label>In-story date<input value={scene.when ?? ''} onChange={(e) => patch({ when: e.target.value })} /></label>
      <div className="row">
        <label>Status
          <select value={scene.status ?? 'planned'} onChange={(e) => patch({ status: e.target.value as Scene['status'] })}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Chapter
          <select value={scene.chapterId ?? ''} onChange={(e) => patch({ chapterId: e.target.value || undefined })}>
            <option value="">none</option>
            {book.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label>POV
          <select value={scene.pov ?? ''} onChange={(e) => patch({ pov: e.target.value || undefined })}>
            <option value="">none</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Location
          <select value={scene.location ?? ''} onChange={(e) => patch({ location: e.target.value || undefined })}>
            <option value="">none</option>
            {places.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <div>
        <small className="muted">CHARACTERS (add them in the Wiki first)</small>
        <div className="row">
          {chars.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={here.includes(c.id)}
                onChange={() => patch({ characters: here.includes(c.id) ? here.filter((x) => x !== c.id) : [...here, c.id] })} />
              {c.name}
            </label>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="alt" disabled={i === 0} onClick={() => move(-1)}>← Earlier</button>
        <button className="alt" disabled={i === book.scenes.length - 1} onClick={() => move(1)}>Later →</button>
        <button className="alt" onClick={onClose}>Close</button>
        <button className="danger" onClick={() => {
          if (!confirm('Delete this scene?')) return
          update((b) => ({ ...b, scenes: b.scenes.filter((s) => s.id !== scene.id) }))
          onClose()
        }}>Delete</button>
      </div>
    </div>
  )
}

export default function Timeline() {
  const { book, update } = useBook()
  const [view, setView] = useState<'board' | 'lanes'>('board')
  const [sel, setSel] = useState<string | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const scene = book.scenes.find((s) => s.id === sel)
  const name = (id?: string) => book.wiki.find((w) => w.id === id)?.name

  const add = () => {
    const s: Scene = { id: uid(), title: `Scene ${book.scenes.length + 1}`, summary: '', status: 'planned', characters: [] }
    update((b) => ({ ...b, scenes: [...b.scenes, s] }))
    setSel(s.id)
  }
  const setStatus = (status: Scene['status']) => {
    if (!drag) return
    update((b) => ({ ...b, scenes: b.scenes.map((s) => (s.id === drag ? { ...s, status } : s)) }))
    setDrag(null)
  }

  // Lanes: one row per character who appears (or is POV) in any scene, one column per scene in order.
  const laneIds = [...new Set(book.scenes.flatMap((s) => [...(s.characters ?? []), ...(s.pov ? [s.pov] : [])]))]

  return (
    <div className="page wider">
      <div className="row" style={{ alignItems: 'center' }}>
        <h1 className="grow">Timeline</h1>
        <button onClick={add}>+ Scene</button>
        <button className="alt" onClick={() => setView(view === 'board' ? 'lanes' : 'board')}>
          {view === 'board' ? 'Show lanes' : 'Show board'}
        </button>
      </div>
      {scene && <SceneForm key={scene.id} scene={scene} onClose={() => setSel(null)} />}
      {view === 'board' ? (
        <div className="board">
          {STATUSES.map((st) => (
            <div key={st} className="col" onDragOver={(e) => e.preventDefault()} onDrop={() => setStatus(st)}>
              <small className="muted">{st.toUpperCase()}</small>
              {book.scenes.filter((s) => (s.status ?? 'planned') === st).map((s) => (
                <div key={s.id} draggable onDragStart={() => setDrag(s.id)} onClick={() => setSel(s.id)}
                  className={`item ${s.id === sel ? 'sel' : ''}`}>
                  <b>{s.title}</b>
                  <small className="muted">{[s.when, name(s.pov) && `POV ${name(s.pov)}`, name(s.location)].filter(Boolean).join(' · ')}</small>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : laneIds.length ? (
        <div className="lanes" style={{ gridTemplateColumns: `120px repeat(${book.scenes.length}, 90px)` }}>
          <span />
          {book.scenes.map((s, n) => (
            <button key={s.id} className="alt head" title={s.title} onClick={() => setSel(s.id)}>{n + 1}. {s.title}</button>
          ))}
          {laneIds.map((id) => (
            <Fragment key={id}>
              <b>{name(id) ?? '(deleted)'}</b>
              {book.scenes.map((s) => {
                const on = (s.characters ?? []).includes(id) || s.pov === id
                return <div key={s.id + id} className={`cell ${on ? 'on' : ''} ${s.pov === id ? 'pov' : ''}`} onClick={() => setSel(s.id)} />
              })}
            </Fragment>
          ))}
        </div>
      ) : (
        <p className="muted">Lanes show which characters are in which scenes. Add scenes, then tick characters (create them in the Wiki first).</p>
      )}
    </div>
  )
}
