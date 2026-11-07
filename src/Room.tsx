import type { Editor } from '@tiptap/core'
import { type ReactNode, useDeferredValue, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { claudeBrief } from './claude'
import { allComments, commentsIn } from './comments'
import { chapterNeighbours, type Near, type Ref, sceneNeighbours } from './connect'
import Connected from './Connected'
import { FindPanel } from './Find'
import { history, type Snap, snapshot } from './history'
import Icon from './Icon'
import { addComment, clearComment, goToComment, setCommentNote } from './prose'
import { plain, today, useBook, words } from './store'
import { loadSettings, runSync, useSyncStatus } from './sync'
import { useLocal } from './ui'

// The writing room: the same page, top bar, goal and side panel around a scene (Scenes) or a chapter (Write).
export interface Prefs { font: 'serif' | 'sans' | 'mono'; size: number; width: number; typewriter: boolean }
const PREFS: Prefs = { font: 'serif', size: 19, width: 47, typewriter: false }
const FONTS = { serif: 'var(--serif)', sans: 'var(--sans)', mono: "ui-monospace, 'Cascadia Code', Consolas, monospace" }
const NARROW = 900 // below this the side panels float over the page instead of sitting beside it

export type Tab = 'story' | 'info' | 'comments' | 'links' | 'find'

export function useWriter() {
  const [prefs, setPrefs] = useLocal<Prefs>('write-prefs', PREFS)
  const [focus, setFocus] = useState(false)
  const [side, setSide] = useLocal('room-side', innerWidth >= 1100)
  const [tab, setTab] = useLocal<Tab>('room-tab', 'story')
  const [note, setNote] = useState<string | null>(null) // the comment being read or written
  const show = (t: Tab) => { setTab(t); setSide(true); setFocus(false) }
  return {
    prefs, setPrefs, focus, setFocus, side, setSide, tab, setTab, note, show,
    openNote: (id: string) => { setNote(id); show('comments') },
    comment: (editor: Editor | null) => { const id = editor && addComment(editor); if (id) { setNote(id); show('comments') } },
  }
}
export type Writer = ReturnType<typeof useWriter>

export function History({ id, body, restore }: { id: string; body: string; restore: (html: string) => void }) {
  const [snaps, setSnaps] = useState<Snap[]>([])
  const [peek, setPeek] = useState<number | null>(null)
  const load = () => history(id).then(setSnaps)
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="history">
      <button className="alt" onClick={async () => { await snapshot(id, body, 'Manual'); load() }}>Save snapshot now</button>
      {snaps.map((s, i) => (
        <div key={s.t} className="item">
          <span>{new Date(s.t).toLocaleString()} · {words(s.body)} words {s.label && <small className="muted">({s.label})</small>}</span>
          <div className="row">
            <button className="alt" onClick={() => setPeek(peek === i ? null : i)}>{peek === i ? 'Hide' : 'Preview'}</button>
            <button className="alt" onClick={async () => {
              if (!confirm('Restore this version? Your current text is saved as a snapshot first.')) return
              await snapshot(id, body, 'Before restore')
              restore(s.body)
              load()
            }}>Restore</button>
          </div>
          {peek === i && <p className="peek">{plain(s.body).replace(/\s+/g, ' ').trim()}</p>}
        </div>
      ))}
      {!snaps.length && <p className="muted">No snapshots yet. They are taken automatically as you write.</p>}
    </div>
  )
}

function NearCard({ n }: { n: Near }) {
  return (
    <div className="item near">
      <div className="near-head"><Link to={n.to}><b>{n.title}</b></Link>{n.status && <span className={`stage ${n.status}`}>{n.status}</span>}</div>
      <p className="near-gist">{n.gist || <i className="muted">Nothing planned or written yet.</i>}</p>
      {n.text && n.text !== n.gist && (
        <details>
          <summary>Full text</summary>
          <div className="near-text">{n.text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>
        </details>
      )}
    </div>
  )
}

function Story({ doc, children }: { doc: Ref; children?: ReactNode }) {
  const book = useDeferredValue(useBook((s) => s.book))
  const { before, after } = doc.kind === 'scene' ? sceneNeighbours(book, doc.id) : chapterNeighbours(book, doc.id)
  const word = doc.kind === 'scene' ? 'scene' : 'chapter'
  return (
    <>
      <h3>Before this</h3>
      {before.map((n) => <NearCard key={n.id} n={n} />)}
      {!before.length && <p className="muted">This is the first {word}.</p>}
      <div className="near-now">You are here</div>
      <h3>After this</h3>
      {after.map((n) => <NearCard key={n.id} n={n} />)}
      {!after.length && <p className="muted">This is the last {word}.</p>}
      {children}
    </>
  )
}

function Comments({ w, doc, body, editor }: { w: Writer; doc: Ref; body: string; editor: Editor | null }) {
  const [all, setAll] = useState(false)
  const scenes = useBook((s) => s.book.scenes), chapters = useBook((s) => s.book.chapters)
  const notes = commentsIn(body)
  const book = all ? allComments({ scenes, chapters }) : []
  return (
    <>
      <div className="row">
        <button className={`fchip ${all ? '' : 'on'}`} onClick={() => setAll(false)}>This {doc.kind}</button>
        <button className={`fchip ${all ? 'on' : ''}`} onClick={() => setAll(true)}>Whole book</button>
      </div>
      {all ? (
        <>
          {book.map((n) => (
            <Link key={n.id} className="item" to={n.to}>
              <small className="muted">{n.where}</small>
              <span className="quote">"{n.quote}"</span>
              <span>{n.note || <i className="muted">No note yet</i>}</span>
            </Link>
          ))}
          {!book.length && <p className="muted">No comments anywhere in the book.</p>}
        </>
      ) : (
        <>
          {notes.map((n) => (
            <div key={n.id} className={`item ${w.note === n.id ? 'sel' : ''}`}>
              <button className="quote linklike" title="Show in the text" onClick={() => editor && goToComment(editor, n.id)}>"{n.quote}"</button>
              <textarea rows={2} aria-label="Note" autoFocus={w.note === n.id} placeholder="Your note..." value={n.note}
                onChange={(e) => editor && setCommentNote(editor, n.id, e.target.value)}
                onBlur={(e) => { if (editor && !e.target.value.trim()) clearComment(editor, n.id) }} />
              <button className="alt" onClick={() => editor && clearComment(editor, n.id)}>Clear</button>
            </div>
          ))}
          {!notes.length && <p className="muted">Select a phrase and press Comment to leave yourself a note on it. Clear it once it is dealt with. Comments never reach your exports.</p>}
        </>
      )}
    </>
  )
}

const TABS: [Tab, string][] = [['story', 'Story'], ['info', 'Details'], ['comments', 'Comments'], ['links', 'Links'], ['find', 'Find']]

function Side({ w, doc, body, editor, info, story }: { w: Writer; doc: Ref; body: string; editor: Editor | null; info: ReactNode; story?: ReactNode }) {
  const count = commentsIn(body).length
  return (
    <aside className="room-side" aria-label="Side panel">
      <div className="room-tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={w.tab === t} className={`fchip ${w.tab === t ? 'on' : ''}`} onClick={() => w.setTab(t)}>{label}{t === 'comments' && count > 0 ? ` ${count}` : ''}</button>
        ))}
        <button className="ghost icon" aria-label="Close panel" onClick={() => w.setSide(false)}>×</button>
      </div>
      {w.tab === 'story' && <Story doc={doc}>{story}</Story>}
      {w.tab === 'info' && info}
      {w.tab === 'comments' && <Comments w={w} doc={doc} body={body} editor={editor} />}
      {w.tab === 'links' && <Connected of={doc} />}
      {w.tab === 'find' && <FindPanel />}
    </aside>
  )
}

function ForClaude({ doc }: { doc: Ref }) {
  const [msg, setMsg] = useState('')
  const copy = async () => {
    try { await navigator.clipboard.writeText(claudeBrief(useBook.getState().book, doc)); setMsg('Copied') } catch { setMsg('Could not copy') }
    setTimeout(() => setMsg(''), 2500)
  }
  return <button className="ghost hide-in-focus" aria-label="For Claude" title="Copy this text, the story around it, its world notes and your comments, to paste to Claude for a continuity check and feedback" onClick={copy}><Icon name="copy" size={16} /> <span className="claude-label">{msg || 'For Claude'}</span></button>
}

// One tap when you stop: snapshot this text, then push to GitHub if sync is on.
function SaveButton({ doc, synced }: { doc: Ref & { body: string }; synced: boolean }) {
  const busy = useSyncStatus((s) => s.busy)
  const [msg, setMsg] = useState('')
  const save = async () => {
    await snapshot(doc.id, doc.body, 'Manual')
    if (synced) await runSync()
    setMsg(synced ? useSyncStatus.getState().text : 'Saved')
    setTimeout(() => setMsg(''), 3000)
  }
  return <button className="ghost" aria-label="Save" title="Snapshot this text and sync" disabled={busy} onClick={save}>{busy ? 'Saving...' : msg || 'Save'}</button>
}

interface RoomProps {
  w: Writer
  crumb: string
  left?: ReactNode
  aside?: ReactNode // the chapter list, in Write
  doc?: Ref & { body: string }
  editor?: Editor | null
  info?: ReactNode
  story?: ReactNode
  children: ReactNode
}

export function Room({ w, crumb, left, aside, doc, editor = null, info, story, children }: RoomProps) {
  const dirty = useBook((s) => s.dirty)
  useEffect(() => { if (doc) try { localStorage.setItem('room-last', JSON.stringify({ kind: doc.kind, id: doc.id })) } catch { /* private mode */ } }, [doc?.kind, doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useBook((s) => s.book.stats)
  const { prefs, focus } = w
  const set = (p: Partial<Prefs>) => w.setPrefs({ ...prefs, ...p })
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (focus) w.setFocus(false); else if (w.side && innerWidth < NARROW) w.setSide(false); return }
      // Ctrl+H, and Ctrl+Shift+F which elsewhere opens the Search page: stay in the room, find in the panel.
      if (doc && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'h' || (e.shiftKey && e.key.toLowerCase() === 'f'))) { e.preventDefault(); e.stopPropagation(); w.show('find') }
    }
    addEventListener('keydown', h, true)
    return () => removeEventListener('keydown', h, true)
  })
  const { goal, days } = stats
  const done = days[today()] ?? 0
  const synced = !!loadSettings().token
  const saved = synced ? (dirty ? 'Unsynced changes' : 'Synced') : 'Saved on this device'
  const vars = { ['--w-font' as string]: FONTS[prefs.font], ['--w-size' as string]: `${prefs.size}px`, ['--w-width' as string]: `${prefs.width}rem` }
  return (
    <div className={`writer ${focus ? 'focus' : ''}`} style={vars}>
      <div className="w-top">
        {left}
        <span className="crumb hide-in-focus">{crumb}</span>
        <span className={`save-state hide-in-focus ${synced && dirty ? 'pending' : ''}`}><i />{saved}</span>
        <span className="grow" style={{ display: focus ? 'block' : 'none' }} />
        {doc && <SaveButton doc={doc} synced={synced} />}
        {doc && <ForClaude doc={doc} />}
        <details className="menu aa">
          <summary aria-label="Editor settings" title="Font, size, width, typewriter scrolling">Aa</summary>
          <div className="menu-pop">
            <label>Font
              <select value={prefs.font} onChange={(e) => set({ font: e.target.value as Prefs['font'] })}><option value="serif">Serif</option><option value="sans">Sans</option><option value="mono">Mono</option></select>
            </label>
            <label>Text size: {prefs.size}px
              <input type="range" min={15} max={28} value={prefs.size} onChange={(e) => set({ size: +e.target.value })} />
            </label>
            <label>Line width
              <select value={prefs.width} onChange={(e) => set({ width: +e.target.value })}><option value={38}>Narrow</option><option value={47}>Medium</option><option value={60}>Wide</option></select>
            </label>
            <label className="check"><input type="checkbox" checked={prefs.typewriter} onChange={(e) => set({ typewriter: e.target.checked })} /> Typewriter scrolling</label>
          </div>
        </details>
        <button className={`ghost icon hide-in-focus ${w.side ? 'on' : ''}`} aria-label="Side panel" title="Story, details, comments, links, find" disabled={!doc} onClick={() => w.setSide(!w.side)}><Icon name="panel" /></button>
        <button className="ghost icon" aria-label={focus ? 'Exit focus mode' : 'Focus mode'} title={focus ? 'Exit focus mode' : 'Focus mode'} onClick={() => w.setFocus(!focus)}><Icon name="focus" /></button>
      </div>
      <div className="w-body">
        {aside}
        <div className="w-main">{children}</div>
        {doc && w.side && !focus && <Side w={w} doc={doc} body={doc.body} editor={editor} info={info} story={story} />}
      </div>
      <div className="w-goal" title={`${done} of ${goal} words today`}>
        <div className="w-goal-fill" style={{ width: `${Math.min(100, (done / Math.max(goal, 1)) * 100)}%` }} />
        <span>{done} / {goal} words today</span>
      </div>
    </div>
  )
}
