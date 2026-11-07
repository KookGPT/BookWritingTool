import { EditorContent } from '@tiptap/react'
import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { snapshot, trashIt } from './history'
import Icon from './Icon'
import { fmt } from './calendar'
import { canReorder, moveScene, sceneOrder } from './connect'
import { Toolbar, useJump, useProse } from './prose'
import { History, Room, useWriter, type Writer } from './Room'
import { PlanFields, PlanView, usePatchScene } from './ScenePlan'
import { addWords, calendarOf, patchScene, type Scene, setSceneBody, uid, useBook, words } from './store'
import { colorOf, PageHead } from './ui'

const STATUSES = ['planned', 'drafting', 'done'] as const

function SceneDetails({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const { book, update } = useBook()
  const patch = (p: Partial<Scene>) => update((b) => patchScene(b, scene.id, p))
  const cal = calendarOf(book)
  const chars = book.wiki.filter((w) => w.type === 'character')
  const places = book.wiki.filter((w) => w.type === 'location')
  const here = scene.characters ?? []
  const planned = (scene.status ?? 'planned') === 'planned'
  const order = sceneOrder(book)
  const i = order.findIndex((s) => s.id === scene.id)
  // One step in story order, for touch screens; the board's drag does the same thing.
  const moved = (d: -1 | 1) => (order[i + d] ? moveScene(book, scene.id, order[i + d].id, d > 0) : book)

  return (
    <>
      {!planned && <label>Draft notes<textarea rows={4} placeholder="What changed from the plan? What needs fixing on revision?" value={scene.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} /></label>}
      <div className="row" style={{ alignItems: 'end' }}>
        <label className="grow">Chapter
          <select value={scene.chapterId ?? ''} onChange={(e) => patch({ chapterId: e.target.value || undefined })}>
            <option value="">Not in a chapter yet</option>
            {book.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        {scene.chapterId && <Link className="chip" to={`/write?c=${scene.chapterId}`}>Open chapter ›</Link>}
      </div>
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
      </div>
      <label>Time note<input value={scene.when ?? ''} placeholder="dawn, midwinter feast..." onChange={(e) => patch({ when: e.target.value })} /></label>
      <div className="row">
        <label className="grow">POV
          <select value={scene.pov ?? ''} onChange={(e) => patch({ pov: e.target.value || undefined })}>
            <option value="">none</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="grow">Location
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
        <button className="alt" disabled={moved(-1) === book} onClick={() => update(() => moved(-1))}>← Earlier</button>
        <button className="alt" disabled={moved(1) === book} onClick={() => update(() => moved(1))}>Later →</button>
      </div>
      <h3>History</h3>
      <History id={scene.id} body={scene.body ?? ''} restore={(html) => update((b) => setSceneBody(b, scene.id, html))} />
      <button className="danger" onClick={() => {
        if (!confirm('Delete this scene? (It goes to Trash.)')) return
        trashIt('scenes', scene.title, scene)
        update((b) => ({ ...b, scenes: b.scenes.filter((s) => s.id !== scene.id) }))
        onClose()
      }}>Delete scene</button>
    </>
  )
}

function SceneRoom({ scene, w, onClose }: { scene: Scene; w: Writer; onClose: () => void }) {
  const update = useBook((s) => s.update)
  const count = useBook((s) => s.book.scenes.length)
  const patch = usePatchScene(scene.id)
  const status = scene.status ?? 'planned'
  const planned = status === 'planned'
  const body = scene.body ?? ''
  const onBody = (html: string) => {
    const old = useBook.getState().book.scenes.find((s) => s.id === scene.id)?.body ?? ''
    if (old) snapshot(scene.id, old)
    update((b) => addWords(setSceneBody(b, scene.id, html), old, html))
  }
  const { editor, scroller } = useProse({
    body, onBody, cast: [...(scene.pov ? [scene.pov] : []), ...(scene.characters ?? []), ...(scene.location ? [scene.location] : [])],
    typewriter: w.prefs.typewriter, onOpenComment: w.openNote, onAddComment: () => w.comment(editor),
  })
  useJump(editor, false)
  const left = <button className="ghost hide-in-focus" onClick={onClose}><Icon name="left" size={16} /> Scenes</button>
  return (
    <Room w={w} crumb={`${scene.title} · ${count} scene${count === 1 ? '' : 's'} in book`} left={left} doc={{ kind: 'scene', id: scene.id, body }} editor={editor}
      info={<SceneDetails scene={scene} onClose={onClose} />}
      story={!planned && <><h3>The plan</h3><PlanView scene={scene} /></>}>
      <div className="w-scroll" ref={scroller}>
        <div className="w-page">
          <input className="w-title" aria-label="Scene title" value={scene.title} onChange={(e) => patch({ title: e.target.value })} />
          <div className="w-meta">
            <span>{words(body)} words</span>
            <select aria-label="Stage" value={status} onChange={(e) => patch({ status: e.target.value as Scene['status'] })}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          {planned ? (
            <div className="room-plan">
              <PlanFields scene={scene} />
              <button onClick={() => patch({ status: 'drafting' })}>Start drafting →</button>
            </div>
          ) : (
            <>
              <Toolbar editor={editor} onComment={() => w.comment(editor)} />
              <EditorContent editor={editor} className="editor" />
            </>
          )}
        </div>
      </div>
    </Room>
  )
}

export default function Scenes() {
  const { book, update } = useBook()
  const [view, setView] = useState<'board' | 'lanes'>('board')
  const [params, setParams] = useSearchParams()
  const sel = params.get('s') // in the address, so Back returns to the board and links can open a scene from anywhere
  const setSel = (id: string | null) => setParams(id ? { s: id } : {})
  const w = useWriter()
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  const [msg, setMsg] = useState('')
  const scene = book.scenes.find((s) => s.id === sel)
  const name = (id?: string) => book.wiki.find((w) => w.id === id)?.name
  const chapterOf = (id?: string) => book.chapters.find((c) => c.id === id)?.title

  const add = () => {
    const s: Scene = { id: uid(), title: `Scene ${book.scenes.length + 1}`, summary: '', status: 'planned', characters: [] }
    update((b) => ({ ...b, scenes: [...b.scenes, s] }))
    setSel(s.id)
  }
  const end = () => { setDrag(null); setOver(null) }
  // A drop sets the stage of the column and, when it lands beside a card, the scene's place in the story.
  const drop = (status: Scene['status']) => {
    if (drag) {
      const b = patchScene(useBook.getState().book, drag, { status })
      const held = over && over.id !== drag && !canReorder(b, drag, over.id)
      update(() => (over ? moveScene(b, drag, over.id, over.after) : b))
      setMsg(held ? `"${b.scenes.find((s) => s.id === drag)?.title}" isn't in the same chapter as that scene, so its place didn't change. To move it there, set its chapter under Details.` : '')
    }
    end()
  }

  if (scene) return <SceneRoom key={scene.id} scene={scene} w={w} onClose={() => setSel(null)} />

  // Lanes: one row per character who appears (or is POV) in any scene, one column per scene in order.
  const order = sceneOrder(book) // the board reads top to bottom in story order
  const laneIds = [...new Set(order.flatMap((s) => [...(s.characters ?? []), ...(s.pov ? [s.pov] : [])]))]

  return (
    <div className="page wider">
      <PageHead title="Scenes" hint="Click a card to write it. Drag a card up or down to change the story order, or to another column to change its stage. The coloured edge is the POV character.">
        <button onClick={add}>+ Scene</button>
        <button className="alt" onClick={() => setView(view === 'board' ? 'lanes' : 'board')}>
          {view === 'board' ? 'Show lanes' : 'Show board'}
        </button>
      </PageHead>
      {msg && <p className="muted">{msg}</p>}
      {view === 'board' ? (
        <div className="board">
          {STATUSES.map((st) => {
            const cards = order.filter((s) => (s.status ?? 'planned') === st)
            return (
            <div key={st} className="col" onDrop={(e) => { e.preventDefault(); drop(st) }}
              onDragOver={(e) => { e.preventDefault(); if (over && !cards.some((s) => s.id === over.id)) setOver(null) }}>
              <small className="muted">{st.toUpperCase()}</small>
              {cards.map((s) => (
                <div key={s.id} draggable onClick={() => setSel(s.id)}
                  onDragStart={(e) => { setDrag(s.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id) }}
                  onDragEnd={end}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (s.id === drag) { setOver(null); return }
                    const r = e.currentTarget.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2
                    setOver((o) => (o?.id === s.id && o.after === after ? o : { id: s.id, after }))
                  }}
                  className={`item scene-card ${s.id === sel ? 'sel' : ''} ${drag === s.id ? 'dragging' : ''} ${over?.id === s.id ? (over.after ? 'over-after' : 'over-before') : ''}`}
                  style={{ ['--pc' as string]: s.pov ? colorOf(s.pov) : 'transparent' }}>
                  <b>{s.title}</b>
                  <small className="muted">{[s.date ? fmt(calendarOf(book), s.date) : s.when, name(s.pov) && `POV ${name(s.pov)}`, name(s.location)].filter(Boolean).join(' · ')}</small>
                  {st === 'planned'
                    ? (s.goal || s.summary) && <span className="card-sum">{s.goal ? `Wants: ${s.goal}` : s.summary}</span>
                    : <small className="muted">{chapterOf(s.chapterId) ?? 'Not in a chapter yet'}</small>}
                </div>
              ))}
            </div>
            )
          })}
        </div>
      ) : laneIds.length ? (
        <div className="lanes" style={{ gridTemplateColumns: `120px repeat(${order.length}, 90px)` }}>
          <span />
          {order.map((s, n) => (
            <button key={s.id} className="alt head" title={s.title} onClick={() => setSel(s.id)}>{n + 1}. {s.title}</button>
          ))}
          {laneIds.map((id) => (
            <Fragment key={id}>
              <b>{name(id) ?? '(deleted)'}</b>
              {order.map((s) => {
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
