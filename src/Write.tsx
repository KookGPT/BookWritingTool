import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from './Icon'
import { history, type Snap, snapshot, trashIt } from './history'
import { PlanView } from './ScenePlan'
import { SceneBlock } from './sceneNode'
import { type Chapter, mentionsEntry, needsPlacement, plain, sceneBlocks, syncPlacement, today, uid, useBook, words } from './store'

const STATUSES: Chapter['status'][] = ['draft', 'revised', 'done']

function History({ chapter, restore }: { chapter: Chapter; restore: (html: string) => void }) {
  const [snaps, setSnaps] = useState<Snap[]>([])
  const [peek, setPeek] = useState<number | null>(null)
  const load = () => history(chapter.id).then(setSnaps)
  useEffect(() => { load() }, [chapter.id])
  return (
    <div className="history">
      <button className="alt" onClick={async () => { await snapshot(chapter.id, chapter.body, 'Manual'); load() }}>Save snapshot now</button>
      {snaps.map((s, i) => (
        <div key={s.t} className="item">
          <span>{new Date(s.t).toLocaleString()} · {words(s.body)} words {s.label && <small className="muted">({s.label})</small>}</span>
          <div className="row">
            <button className="alt" onClick={() => setPeek(peek === i ? null : i)}>{peek === i ? 'Hide' : 'Preview'}</button>
            <button className="alt" onClick={async () => {
              if (!confirm('Restore this version? Your current text is saved as a snapshot first.')) return
              await snapshot(chapter.id, chapter.body, 'Before restore')
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

function Editor({ chapter, info, closeInfo }: { chapter: Chapter; info: boolean; closeInfo: () => void }) {
  const update = useBook((s) => s.update)
  const wiki = useBook((s) => s.book.wiki)
  const allScenes = useBook((s) => s.book.scenes)
  const chapters = useBook((s) => s.book.chapters)
  const here = new Set(sceneBlocks(chapter.body).map((x) => x.id))
  const inChapter = allScenes.filter((s) => here.has(s.id))
  const planned = allScenes.filter((s) => s.chapterId === chapter.id && (s.status ?? 'planned') === 'planned')
  const placed = (id: string) => chapters.some((c) => c.body.includes(`data-scene="${id}"`))
  const insertable = allScenes.filter((s) => (s.status ?? 'planned') !== 'planned' && !placed(s.id))
  const [histOpen, setHistOpen] = useState(false)
  // Scenes assigned to a chapter (in Scenes) are written into it, so the chapter reads as one continuous text.
  const missing = needsPlacement({ chapters, scenes: allScenes } as never)
  useEffect(() => { if (missing) update((b) => syncPlacement(b)) }, [missing, update])
  const patch = (p: Partial<Chapter>) => {
    if (p.body !== undefined) {
      const old = useBook.getState().book.chapters.find((c) => c.id === chapter.id)
      if (old) snapshot(chapter.id, old.body)
    }
    update((b) => {
      const old = b.chapters.find((c) => c.id === chapter.id)
      const d = p.body === undefined || !old ? 0 : words(p.body) - words(old.body)
      const day = today()
      const stats = d ? { ...b.stats, days: { ...b.stats.days, [day]: Math.max(0, (b.stats.days[day] ?? 0) + d) } } : b.stats
      const edited = p.body === undefined ? [] : sceneBlocks(p.body)
      const scenes = edited.length ? b.scenes.map((s) => { const e = edited.find((x) => x.id === s.id); return e && e.html !== s.body ? { ...s, body: e.html } : s }) : b.scenes
      return { ...b, stats, scenes, chapters: b.chapters.map((c) => (c.id === chapter.id ? { ...c, ...p } : c)) }
    })
  }
  const editor = useEditor({
    extensions: [StarterKit, SceneBlock],
    content: chapter.body,
    onUpdate: ({ editor }) => patch({ body: editor.getHTML() }),
  })
  // A sync can bring in this chapter's text from the other device; show it instead of overwriting it on the next keystroke.
  useEffect(() => {
    if (editor && chapter.body !== editor.getHTML()) editor.commands.setContent(chapter.body, { emitUpdate: false })
  }, [chapter.body, editor])
  const insertScene = (id: string) => {
    const sc = allScenes.find((x) => x.id === id)
    if (!sc || !editor) return
    editor.chain().focus().insertContent(`<div data-scene="${id}">${sc.body || '<p></p>'}</div>`).run()
    update((b) => ({ ...b, scenes: b.scenes.map((x) => (x.id === id ? { ...x, chapterId: chapter.id } : x)) }))
  }
  const removeScene = (id: string) => {
    if (!editor) return
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'scene' && node.attrs.sceneId === id) { editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).run(); return false }
    })
    update((b) => ({ ...b, scenes: b.scenes.map((x) => (x.id === id ? { ...x, chapterId: undefined } : x)) }))
  }
  const mentioned = wiki.filter((w) => mentionsEntry(plain(chapter.body), w))
  return (
    <>
      <div className="w-scroll">
        <div className="w-page">
          <input className="w-title" aria-label="Chapter title" value={chapter.title} onChange={(e) => patch({ title: e.target.value })} />
          <div className="w-meta">
            <span>{words(chapter.body)} words</span>
            <select aria-label="Status" value={chapter.status} onChange={(e) => patch({ status: e.target.value as Chapter['status'] })}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="w-toolbar" role="toolbar" aria-label="Formatting">
            <button aria-label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
            <button aria-label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
            <button aria-label="Heading" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H</button>
            <button aria-label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>"</button>
            <button aria-label="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
            <button title="Scene break" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>* * *</button>
          </div>
          <EditorContent editor={editor} className="editor" />
        </div>
      </div>
      {info && (
        <aside className="drawer right hide-in-focus" aria-label="Chapter details">
          <div className="row" style={{ alignItems: 'center' }}>
            <h3 className="grow">Notes</h3>
            <button className="ghost icon" aria-label="Close notes" onClick={closeInfo}>×</button>
          </div>
          <textarea value={chapter.notes} onChange={(e) => patch({ notes: e.target.value })} rows={6} placeholder="Notes for this chapter..." />
          <h3>Scenes in this chapter</h3>
          {inChapter.map((s) => (
            <div key={s.id} className="item">
              <span><b>{s.title}</b> <span className={`stage ${s.status}`}>{s.status}</span></span>
              <div className="row">
                <Link className="chip" to={`/scenes?s=${s.id}`}>Open in Scenes ›</Link>
                <button className="alt" onClick={() => removeScene(s.id)}>Remove from chapter</button>
              </div>
            </div>
          ))}
          {!inChapter.length && <p className="muted">Nothing placed here yet.</p>}
          {insertable.length > 0 ? (
            <select aria-label="Insert a scene" value="" onChange={(e) => e.target.value && insertScene(e.target.value)}>
              <option value="">Insert a draft or finished scene...</option>
              {insertable.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.status}{s.body?.replace(/<[^>]+>/g, '').trim() ? '' : ', no text yet'})</option>)}
            </select>
          ) : <small className="muted">Write scenes in the Scenes tab, set them to drafting or done, then insert them here.</small>}
          {planned.length > 0 && (
            <>
              <h3>Planned for this chapter</h3>
              {planned.map((s) => <details key={s.id} className="item"><summary><b>{s.title}</b></summary><PlanView scene={s} /></details>)}
            </>
          )}
          {mentioned.length > 0 && <><h3>Mentions</h3><div className="row">{mentioned.map((w) => <Link key={w.id} to={`/wiki/${w.id}`} className="chip">{w.name}</Link>)}</div></>}
          <details onToggle={(e) => setHistOpen(e.currentTarget.open)}>
            <summary>History</summary>
            {histOpen && <History chapter={chapter} restore={(html) => editor?.commands.setContent(html, { emitUpdate: true })} />}
          </details>
        </aside>
      )}
    </>
  )
}

export default function Write() {
  const { book, update } = useBook()
  const [params] = useSearchParams()
  const [sel, setSel] = useState<string | null>(params.get('c'))
  useEffect(() => { const c = params.get('c'); if (c) setSel(c) }, [params])
  const [focus, setFocus] = useState(false)
  const [list, setList] = useState(!params.get('c'))
  const [info, setInfo] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const chapter = book.chapters.find((c) => c.id === sel)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (focus) setFocus(false); else if (info) setInfo(false); else if (list) setList(false) } }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [focus, info, list])

  const add = () => {
    const c: Chapter = { id: uid(), title: `Chapter ${book.chapters.length + 1}`, body: '', status: 'draft', notes: '' }
    update((b) => ({ ...b, chapters: [...b.chapters, c] }))
    setSel(c.id)
    setList(false)
  }
  const remove = (id: string) => {
    if (!confirm('Delete this chapter? (It goes to Trash.)')) return
    const c = book.chapters.find((c) => c.id === id)
    if (c) trashIt('chapters', c.title, c)
    update((b) => ({ ...b, chapters: b.chapters.filter((c) => c.id !== id) }))
    setSel(null)
  }
  const move = (to: number) => {
    if (drag === null || drag === to) return
    update((b) => {
      const cs = [...b.chapters]
      cs.splice(to, 0, cs.splice(drag, 1)[0])
      return { ...b, chapters: cs }
    })
    setDrag(null)
  }
  const total = book.chapters.reduce((n, c) => n + words(c.body), 0)

  return (
    <div className={`writer ${focus ? 'focus' : ''}`}>
      <div className="w-top">
        <button className={`ghost icon hide-in-focus ${list ? 'on' : ''}`} aria-label="Chapters" title="Chapters" onClick={() => setList(!list)}><Icon name="list" /></button>
        <span className="crumb hide-in-focus">{chapter ? `${chapter.title} · ` : ''}{total} words in book</span>
        <span className="grow" style={{ display: focus ? 'block' : 'none' }} />
        <button className={`ghost icon hide-in-focus ${info ? 'on' : ''}`} aria-label="Notes and history" title="Notes, mentions, history" disabled={!chapter} onClick={() => setInfo(!info)}><Icon name="panel" /></button>
        <button className="ghost icon" aria-label={focus ? 'Exit focus mode' : 'Focus mode'} title={focus ? 'Exit focus mode' : 'Focus mode'} onClick={() => setFocus(!focus)}><Icon name="focus" /></button>
      </div>
      {list && !focus && (
        <aside className="drawer left" aria-label="Chapters">
          <button onClick={add}><Icon name="plus" size={16} /> Chapter</button>
          <p className="muted">Drag to reorder</p>
          {book.chapters.map((c, i) => (
            <div
              key={c.id}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => move(i)}
              className={`item ${c.id === sel ? 'sel' : ''}`}
              onClick={() => { setSel(c.id); if (innerWidth < 800) setList(false) }}
            >
              <span>{i + 1}. {c.title}</span>
              <small className="muted">{c.status} · {words(c.body)}w</small>
            </div>
          ))}
          {chapter && <button className="danger" onClick={() => remove(chapter.id)}>Delete chapter</button>}
        </aside>
      )}
      {chapter
        ? <Editor key={chapter.id} chapter={chapter} info={info} closeInfo={() => setInfo(false)} />
        : <div className="empty"><Icon name="pen" size={32} /><p>Pick a chapter, or start a new one.</p><button onClick={add}>+ Chapter</button></div>}
    </div>
  )
}
