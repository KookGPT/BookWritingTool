import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PlanFields, PlanView } from './ScenePlan'
import SceneText from './SceneText'
import { trashIt } from './history'
import { fmt } from './calendar'
import { calendarOf, type Scene, uid, useBook } from './store'

const STATUSES = ['planned', 'drafting', 'done'] as const

function SceneForm({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const { book, update } = useBook()
  const patch = (p: Partial<Scene>) =>
    update((b) => ({ ...b, scenes: b.scenes.map((s) => (s.id === scene.id ? { ...s, ...p } : s)) }))
  const cal = calendarOf(book)
  const chars = book.wiki.filter((w) => w.type === 'character')
  const places = book.wiki.filter((w) => w.type === 'location')
  const here = scene.characters ?? []
  const status = scene.status ?? 'planned'
  const planned = status === 'planned'
  const placedIn = book.chapters.find((c) => c.body.includes(`data-scene="${scene.id}"`))?.title
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
      <div className="row" style={{ alignItems: 'center' }}>
        <span className={`stage ${status}`}>{status}</span>
        {planned && <button onClick={() => patch({ status: 'drafting' })}>Start drafting →</button>}
        {status === 'drafting' && <button onClick={() => patch({ status: 'done' })}>Mark done</button>}
        {!planned && <button className="alt" onClick={() => patch({ status: 'planned' })}>Back to planning</button>}
      </div>
      {planned ? <PlanFields scene={scene} /> : (
        <>
          <details>
            <summary>The plan</summary>
            <PlanView scene={scene} />
          </details>
          <div><small className="muted">SCENE TEXT{placedIn ? ` (also in ${placedIn})` : ''}</small><SceneText scene={scene} /></div>
          <label>Draft notes<textarea rows={4} placeholder="What changed from the plan? What needs fixing on revision?" value={scene.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} /></label>
          <div className="row" style={{ alignItems: 'end' }}>
            <label className="grow">Chapter
              <select value={scene.chapterId ?? ''} onChange={(e) => patch({ chapterId: e.target.value || undefined })}>
                <option value="">Not in a chapter yet</option>
                {book.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {scene.chapterId && <Link className="chip" to={`/write?c=${scene.chapterId}`}>Open chapter ›</Link>}
          </div>
        </>
      )}
      <details open={planned}>
        <summary>When, where and who</summary>
      <div className="row" style={{ alignItems: 'end' }}>
        <label>Year
          <input type="number" style={{ width: '6rem' }} value={scene.date?.y ?? ''} placeholder="-"
            onChange={(e) => e.target.value === '' ? patch({ date: undefined }) : patch({ date: { y: +e.target.value, m: scene.date?.m ?? 1, d: scene.date?.d ?? 1 } })} />
        </label>
        {scene.date && (
          <>
            <label>Month
              <select value={scene.date.m} onChange={(e) => patch({ date: { ...scene.date!, m: +e.target.value } })}>
                {cal.months.map((m, i) => <option key={i} value={i + 1}>{m.name}</option>)}
              </select>
            </label>
            <label>Day
              <input type="number" min={1} max={cal.months[scene.date.m - 1]?.days} style={{ width: '5rem' }} value={scene.date.d}
                onChange={(e) => patch({ date: { ...scene.date!, d: Math.min(Math.max(1, +e.target.value || 1), cal.months[scene.date!.m - 1]?.days ?? 1) } })} />
            </label>
          </>
        )}
        <label className="grow">Time note<input value={scene.when ?? ''} placeholder="dawn, midwinter feast..." onChange={(e) => patch({ when: e.target.value })} /></label>
      </div>
      <div className="row">
        {planned && (
          <label>Chapter
            <select value={scene.chapterId ?? ''} onChange={(e) => patch({ chapterId: e.target.value || undefined })}>
              <option value="">none</option>
              {book.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        )}
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
      </details>
      <div className="row">
        <button className="alt" disabled={i === 0} onClick={() => move(-1)}>← Earlier</button>
        <button className="alt" disabled={i === book.scenes.length - 1} onClick={() => move(1)}>Later →</button>
        <button className="alt" onClick={onClose}>Close</button>
        <button className="danger" onClick={() => {
          if (!confirm('Delete this scene? (It goes to Trash.)')) return
          trashIt('scenes', scene.title, scene)
          update((b) => ({ ...b, scenes: b.scenes.filter((s) => s.id !== scene.id) }))
          onClose()
        }}>Delete</button>
      </div>
    </div>
  )
}

export default function Scenes() {
  const { book, update } = useBook()
  const [view, setView] = useState<'board' | 'lanes'>('board')
  const [params] = useSearchParams()
  const [sel, setSel] = useState<string | null>(params.get('s'))
  const [drag, setDrag] = useState<string | null>(null)
  const scene = book.scenes.find((s) => s.id === sel)
  const name = (id?: string) => book.wiki.find((w) => w.id === id)?.name
  const chapterOf = (id?: string) => book.chapters.find((c) => c.id === id)?.title

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
        <h1 className="grow">Scenes</h1>
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
                  <small className="muted">{[s.date ? fmt(calendarOf(book), s.date) : s.when, name(s.pov) && `POV ${name(s.pov)}`, name(s.location)].filter(Boolean).join(' · ')}</small>
                  {st === 'planned'
                    ? (s.goal || s.summary) && <span className="card-sum">{s.goal ? `Wants: ${s.goal}` : s.summary}</span>
                    : <small className="muted">{chapterOf(s.chapterId) ?? 'Not in a chapter yet'}</small>}
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
