import { EditorContent } from '@tiptap/react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from './Icon'
import { snapshot, trashIt } from './history'
import { Toolbar, useJump, useProse } from './prose'
import { History, Room, useWriter, type Writer } from './Room'
import { PlanView } from './ScenePlan'
import { SceneBlock } from './sceneNode'
import { addWords, bookWords, type Chapter, needsPlacement, sceneBlocks, syncPlacement, uid, useBook, words } from './store'
import { readLocal } from './ui'

const STATUSES: Chapter['status'][] = ['draft', 'revised', 'done']
const NARROW = 900 // below this the chapter list floats over the page instead of sitting beside it

function ChapterRoom({ chapter, w, crumb, left, aside }: { chapter: Chapter; w: Writer; crumb: string; left: ReactNode; aside: ReactNode }) {
  const update = useBook((s) => s.update)
  const allScenes = useBook((s) => s.book.scenes)
  const chapters = useBook((s) => s.book.chapters)
  const here = new Set(sceneBlocks(chapter.body).map((x) => x.id))
  const inChapter = allScenes.filter((s) => here.has(s.id))
  const planned = allScenes.filter((s) => s.chapterId === chapter.id && (s.status ?? 'planned') === 'planned')
  const placed = (id: string) => chapters.some((c) => c.body.includes(`data-scene="${id}"`))
  const insertable = allScenes.filter((s) => (s.status ?? 'planned') !== 'planned' && !placed(s.id))
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
      const edited = p.body === undefined ? [] : sceneBlocks(p.body)
      const scenes = edited.length ? b.scenes.map((s) => { const e = edited.find((x) => x.id === s.id); return e && e.html !== s.body ? { ...s, body: e.html } : s }) : b.scenes
      const next = { ...b, scenes, chapters: b.chapters.map((c) => (c.id === chapter.id ? { ...c, ...p } : c)) }
      return p.body === undefined || !old ? next : addWords(next, old.body, p.body)
    })
  }
  const { editor, scroller } = useProse({
    body: chapter.body, onBody: (html) => patch({ body: html }), typewriter: w.prefs.typewriter, extensions: [SceneBlock],
    onOpenComment: w.openNote, onAddComment: () => w.comment(editor),
  })
  useJump(editor, true)
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
  const info = (
    <>
      <h3>Notes</h3>
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
      <h3>History</h3>
      <History id={chapter.id} body={chapter.body} restore={(html) => editor?.commands.setContent(html, { emitUpdate: true })} />
    </>
  )
  return (
    <Room w={w} crumb={crumb} left={left} aside={aside} doc={{ kind: 'chapter', id: chapter.id, body: chapter.body }} editor={editor} info={info}>
      <div className="w-scroll" ref={scroller}>
        <div className="w-page">
          <input className="w-title" aria-label="Chapter title" value={chapter.title} onChange={(e) => patch({ title: e.target.value })} />
          <div className="w-meta">
            <span>{words(chapter.body)} words</span>
            <select aria-label="Status" value={chapter.status} onChange={(e) => patch({ status: e.target.value as Chapter['status'] })}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <Toolbar editor={editor} onComment={() => w.comment(editor)} />
          <EditorContent editor={editor} className="editor" />
        </div>
      </div>
    </Room>
  )
}

export default function Write() {
  const { book, update } = useBook()
  const [params] = useSearchParams()
  const [sel, setSel] = useState<string | null>(params.get('c') ?? readLocal<string | null>('write-last', null))
  useEffect(() => { const c = params.get('c'); if (c) setSel(c) }, [params])
  const w = useWriter()
  const [list, setList] = useState(() => innerWidth >= NARROW && readLocal('write-list', true))
  useEffect(() => { if (innerWidth >= NARROW) try { localStorage.setItem('write-list', JSON.stringify(list)) } catch { /* private mode */ } }, [list])
  const [drag, setDrag] = useState<number | null>(null)
  const chapter = book.chapters.find((c) => c.id === sel)
  useEffect(() => { if (chapter) try { localStorage.setItem('write-last', JSON.stringify(chapter.id)) } catch { /* private mode */ } }, [chapter?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && list && innerWidth < NARROW) setList(false) }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [list])

  const add = () => {
    const c: Chapter = { id: uid(), title: `Chapter ${book.chapters.length + 1}`, body: '', status: 'draft', notes: '' }
    update((b) => ({ ...b, chapters: [...b.chapters, c] }))
    setSel(c.id)
    if (innerWidth < NARROW) setList(false)
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
  const counts = book.chapters.map((c) => words(c.body))
  const total = bookWords(book)
  const longest = Math.max(1, ...counts)
  const crumb = `${chapter ? `${chapter.title} · ` : ''}${total} words in book`
  const left = <button className={`ghost icon hide-in-focus ${list ? 'on' : ''}`} aria-label="Chapters" title="Chapters" onClick={() => setList(!list)}><Icon name="list" /></button>
  const aside = list && !w.focus && (
    <aside className="w-list" aria-label="Chapters">
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
          onClick={() => { setSel(c.id); if (innerWidth < NARROW) setList(false) }}
        >
          <span className="ch-title"><i className={`ch-dot ${c.status}`} title={c.status} />{i + 1}. {c.title}</span>
          <small className="muted">{c.status} · {counts[i]}w</small>
          <div className="ch-bar"><div style={{ width: `${(counts[i] / longest) * 100}%` }} /></div>
        </div>
      ))}
      {chapter && <button className="danger" onClick={() => remove(chapter.id)}>Delete chapter</button>}
    </aside>
  )

  if (chapter) return <ChapterRoom key={chapter.id} chapter={chapter} w={w} crumb={crumb} left={left} aside={aside} />
  const next = book.chapters.find((c) => c.status !== 'done') ?? book.chapters[0]
  return (
    <Room w={w} crumb={crumb} left={left} aside={aside}>
      <div className="empty">
        <Icon name="pen" size={32} />
        {book.chapters.length
          ? <><p>Pick a chapter on the left to keep writing.</p><button onClick={() => setSel(next.id)}>Continue with {next.title}</button></>
          : <><p>Your book starts here. Add the first chapter, then write.</p><button onClick={add}>+ Chapter</button></>}
      </div>
    </Room>
  )
}
