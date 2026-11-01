import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type Chapter, mentions, plain, uid, useBook } from './store'

const STATUSES: Chapter['status'][] = ['draft', 'revised', 'done']
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length

function Editor({ chapter }: { chapter: Chapter }) {
  const update = useBook((s) => s.update)
  const wiki = useBook((s) => s.book.wiki)
  const patch = (p: Partial<Chapter>) =>
    update((b) => ({ ...b, chapters: b.chapters.map((c) => (c.id === chapter.id ? { ...c, ...p } : c)) }))
  const editor = useEditor({
    extensions: [StarterKit],
    content: chapter.body,
    onUpdate: ({ editor }) => patch({ body: editor.getHTML() }),
  })
  return (
    <>
      <div className="row">
        <input className="grow title" value={chapter.title} onChange={(e) => patch({ title: e.target.value })} />
        <select value={chapter.status} onChange={(e) => patch({ status: e.target.value as Chapter['status'] })}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="row toolbar">
        <button onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
        <button onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
        <button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H</button>
        <button onClick={() => editor?.chain().focus().toggleBlockquote().run()}>"</button>
        <button onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
        <span className="muted">{words(chapter.body)} words</span>
      </div>
      <EditorContent editor={editor} className="editor" />
      {wiki.filter((w) => mentions(plain(chapter.body), w.name)).length > 0 && (
        <div className="row">
          <span className="muted">Mentions:</span>
          {wiki.filter((w) => mentions(plain(chapter.body), w.name)).map((w) => (
            <Link key={w.id} to={`/wiki/${w.id}`} className="chip">{w.name}</Link>
          ))}
        </div>
      )}
      <details>
        <summary>Chapter notes</summary>
        <textarea value={chapter.notes} onChange={(e) => patch({ notes: e.target.value })} rows={5} />
      </details>
    </>
  )
}

export default function Write() {
  const { book, update } = useBook()
  const [sel, setSel] = useState<string | null>(null)
  const [focus, setFocus] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const chapter = book.chapters.find((c) => c.id === sel)

  const add = () => {
    const c: Chapter = { id: uid(), title: `Chapter ${book.chapters.length + 1}`, body: '', status: 'draft', notes: '' }
    update((b) => ({ ...b, chapters: [...b.chapters, c] }))
    setSel(c.id)
  }
  const remove = (id: string) => {
    if (!confirm('Delete this chapter?')) return
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
    <div className={`write ${focus ? 'focus' : ''}`}>
      <aside>
        <div className="row">
          <button onClick={add}>+ Chapter</button>
          <button onClick={() => setFocus(!focus)}>{focus ? 'Exit focus' : 'Focus'}</button>
        </div>
        <p className="muted">{total} words total</p>
        {book.chapters.map((c, i) => (
          <div
            key={c.id}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => move(i)}
            className={`item ${c.id === sel ? 'sel' : ''}`}
            onClick={() => setSel(c.id)}
          >
            <span>{i + 1}. {c.title}</span>
            <small className="muted">{c.status} · {words(c.body)}w</small>
          </div>
        ))}
        {chapter && <button className="danger" onClick={() => remove(chapter.id)}>Delete chapter</button>}
      </aside>
      <section>
        {chapter ? <Editor key={chapter.id} chapter={chapter} /> : <p className="muted">Pick or add a chapter. Drag chapters to reorder.</p>}
      </section>
    </div>
  )
}
