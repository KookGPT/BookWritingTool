import { type Editor, Extension, Mark } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { autofillNames, complete } from './autofill'
import { check, type Common, type Miss } from './spell'
import { uid, useBook } from './store'

// The one editor behind Scenes and Write: same marks, same autofill, same behaviour in both.

// See comments.ts: a comment is a mark on the phrase and its note travels with it.
const CommentMark = Mark.create({
  name: 'comment',
  excludes: '', // comments may overlap
  inclusive: false, // typing at the edge of one does not grow it
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-comment'), renderHTML: (a) => ({ 'data-comment': a.id }) },
      note: {
        default: '',
        parseHTML: (el) => { try { return decodeURIComponent(el.getAttribute('data-note') ?? '') } catch { return '' } },
        renderHTML: (a) => ({ 'data-note': encodeURIComponent(a.note) }),
      },
    }
  },
  parseHTML() { return [{ tag: 'span[data-comment]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0] },
})

const rangesOf = (editor: Editor, id: string) => {
  const out: { from: number; to: number; mark: EditorState['doc']['marks'][number] }[] = []
  editor.state.doc.descendants((n, pos) => {
    const mark = n.marks.find((m) => m.type.name === 'comment' && m.attrs.id === id)
    if (mark) out.push({ from: pos, to: pos + n.nodeSize, mark })
  })
  return out
}

/** Marks the selection, or the word at the cursor. Returns the new comment's id. */
export function addComment(editor: Editor): string | null {
  const { state } = editor
  let { from, to } = state.selection
  if (from === to) {
    const { $from } = state.selection
    const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, '\ufffc'), at = $from.parentOffset
    const start = /[\p{L}\p{N}'’-]*$/u.exec(text.slice(0, at))![0].length, end = /^[\p{L}\p{N}'’-]*/u.exec(text.slice(at))![0].length
    if (!start && !end) return null
    from -= start; to += end
  } else {
    // A double-click on Windows takes the space after the word too.
    const picked = state.doc.textBetween(from, to, ' ')
    to -= picked.length - picked.trimEnd().length
    from += picked.length - picked.trimStart().length
  }
  const id = uid()
  editor.view.dispatch(state.tr.addMark(from, to, state.schema.marks.comment.create({ id, note: '' })))
  return id
}
export function setCommentNote(editor: Editor, id: string, note: string) {
  const { tr, schema } = editor.state
  for (const r of rangesOf(editor, id)) tr.removeMark(r.from, r.to, r.mark).addMark(r.from, r.to, schema.marks.comment.create({ id, note }))
  editor.view.dispatch(tr)
}
export function clearComment(editor: Editor, id: string) {
  const { tr } = editor.state
  for (const r of rangesOf(editor, id)) tr.removeMark(r.from, r.to, r.mark)
  editor.view.dispatch(tr)
}
export function goToComment(editor: Editor, id: string) {
  const r = rangesOf(editor, id)
  if (r.length) editor.chain().focus().setTextSelection({ from: r[0].from, to: r[r.length - 1].to }).scrollIntoView().run()
}

/** Selects the nth place this exact text appears. Chapters skip placed scenes, which Find reports under the scene. */
export function goToText(editor: Editor, text: string, nth: number, skipScenes: boolean) {
  let left = nth, at: number | null = null
  editor.state.doc.descendants((n, pos) => {
    if (at !== null || (skipScenes && n.type.name === 'scene')) return false
    if (!n.isText) return true
    for (let i = n.text!.indexOf(text); i >= 0; i = n.text!.indexOf(text, i + 1)) {
      if (left-- === 0) { at = pos + i; break }
    }
    return false
  })
  if (at !== null) editor.chain().focus().setTextSelection({ from: at, to: at + text.length }).scrollIntoView().run()
}

// Faint text after the cursor: Tab (or a tap on it) takes it, typing past it ignores it, Esc hides it until the next keystroke.
const Autofill = Extension.create<{ names: () => string[] }>({
  name: 'autofill',
  addOptions() { return { names: () => [] } },
  addProseMirrorPlugins() {
    const names = this.options.names
    const key = new PluginKey<boolean>('autofill')
    let view: EditorView | undefined
    const rest = (state: EditorState) => {
      const { empty, $from } = state.selection
      if (!empty || !$from.parent.isTextblock) return ''
      const p = $from.parent, at = $from.parentOffset
      if (/[\p{L}\p{N}]/u.test(p.textBetween(at, Math.min(at + 1, p.content.size), undefined, '\ufffc'))) return ''
      return complete(p.textBetween(Math.max(0, at - 60), at, undefined, '\ufffc'), names())
    }
    const take = (v: EditorView, text: string) => v.dispatch(v.state.tr.insertText(text).scrollIntoView())
    return [new Plugin<boolean>({
      key,
      view(v) { view = v; return {} },
      state: { init: () => false, apply: (tr, hidden) => tr.getMeta(key) ?? (tr.docChanged || tr.selectionSet ? false : hidden) },
      props: {
        decorations(state) {
          if (key.getState(state) || view?.composing) return null // never touch the text while a phone keyboard is composing it
          const text = rest(state)
          if (!text) return null
          const widget = () => {
            const el = document.createElement('span')
            el.className = 'ghost-text'
            el.textContent = text
            el.setAttribute('aria-hidden', 'true')
            el.addEventListener('mousedown', (e) => { e.preventDefault(); if (view) take(view, text) })
            return el
          }
          return DecorationSet.create(state.doc, [Decoration.widget(state.selection.from, widget, { side: 1, key: text, ignoreSelection: true })])
        },
        handleKeyDown(v, e) {
          if ((e.key !== 'Tab' && e.key !== 'Escape') || e.shiftKey || key.getState(v.state)) return false
          const text = rest(v.state)
          if (!text) return false
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Tab') take(v, text)
          else v.dispatch(v.state.tr.setMeta(key, true))
          return true
        },
      },
    })]
  },
})

// Spelling: only near-misses of common words get a dotted underline (see spell.ts). Tap one for fixes; wiki names are never flagged.
type Dict = { known: Set<string>; common: Common }
const FILES = import.meta.glob<string[]>('/node_modules/wordlist-english/{english,american,british}-words-*.json', { import: 'default' })
let dict: Promise<Dict> | undefined
const loadDict = () => dict ??= (async () => {
  const get = (re: RegExp) => Promise.all(Object.entries(FILES).filter(([f]) => re.test(f)).map(([, load]) => load())).then((a) => a.flat())
  const common: Common = new Map()
  for (const [i, n] of [10, 20, 35].entries()) for (const w of await get(new RegExp(`/english-words-${n}[.]`))) if (!common.has(w)) common.set(w, i)
  return { known: new Set(await get(/-words-/)), common }
})()

const Spelling = Extension.create<{ names: () => string[] }>({
  name: 'spelling',
  addOptions() { return { names: () => [] } },
  addProseMirrorPlugins() {
    const names = this.options.names
    const key = new PluginKey<{ list: Miss[]; open: number | null }>('spelling')
    type St = { list: Miss[]; open: number | null }
    let ready: Dict | undefined, view: EditorView | undefined
    const scan = (doc: EditorState['doc']): Miss[] => {
      const d = ready
      if (!d) return []
      const skip = new Set(names().flatMap((n) => n.toLowerCase().split(/[^\p{L}]+/u)))
      const out: Miss[] = []
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return
        for (const m of check(node.textBetween(0, node.content.size, undefined, '￼'), d.known, d.common, skip)) out.push({ ...m, from: m.from + pos + 1, to: m.to + pos + 1 })
        return false
      })
      return out
    }
    return [new Plugin({
      key,
      view(v) { view = v; loadDict().then((d) => { ready = d; if (!v.isDestroyed) v.dispatch(v.state.tr.setMeta(key, { ready: true })) }); return {} },
      // Typing one space or punctuation mark after a word one clear slip from a common word fixes it in place (Ctrl+Z puts it back).
      appendTransaction(trs, old, now) {
        if (!trs.some((t) => t.docChanged) || now.doc.content.size - old.doc.content.size !== 1 || !now.selection.empty || view?.composing) return null
        const at = now.selection.from
        if (!/^[\s.,;:!?)"”—-]$/.test(now.doc.textBetween(at - 1, at, undefined, '￼'))) return null
        const hit = key.getState(now)?.list.find((m) => m.to === at - 1 && m.auto)
        return hit?.auto ? now.tr.insertText(hit.auto, hit.from, hit.to) : null
      },
      state: {
        init: (): St => ({ list: [], open: null }),
        apply: (tr, st): St => {
          const meta = tr.getMeta(key)
          const list = tr.docChanged || meta?.ready ? scan(tr.doc) : st.list
          return { list, open: meta && 'open' in meta ? meta.open : tr.docChanged ? null : st.open }
        },
      },
      props: {
        decorations(state) {
          const st = key.getState(state)
          if (!st?.list.length) return null
          const { from, empty } = state.selection
          const out: Decoration[] = []
          for (const m of st.list) {
            const open = st.open === m.from
            if (!open && empty && from >= m.from && from <= m.to) continue // still typing it
            out.push(Decoration.inline(m.from, m.to, { class: 'misspelled' }))
            if (!open) continue
            out.push(Decoration.widget(m.to, (v) => {
              const el = document.createElement('span')
              el.className = 'spell-fix'
              for (const f of m.fix) {
                const b = document.createElement('button')
                b.textContent = f
                b.addEventListener('mousedown', (e) => { e.preventDefault(); v.dispatch(v.state.tr.insertText(f, m.from, m.to)) })
                el.append(b)
              }
              return el
            }, { side: 1, key: `fix${m.from}${m.word}` }))
          }
          return DecorationSet.create(state.doc, out)
        },
        handleClick(v, pos) {
          const st = key.getState(v.state)
          const hit = st?.list.find((m) => pos >= m.from && pos <= m.to)
          if (hit || st?.open != null) v.dispatch(v.state.tr.setMeta(key, { open: hit ? hit.from : null }))
          return false
        },
      },
    })]
  },
})

interface Prose {
  body: string
  onBody: (html: string, editor: Editor) => void
  cast?: string[] // wiki ids of who and where this text is about: autofill prefers them
  typewriter?: boolean
  extensions?: Extension[] | unknown[]
  onOpenComment?: (id: string) => void
  onAddComment?: () => void
}

export function useProse(p: Prose) {
  const now = useRef(p)
  now.current = p
  const scroller = useRef<HTMLDivElement>(null)
  // Typewriter scrolling keeps the line you are typing near the middle of the screen.
  const center = (ed: Editor) => {
    const sc = scroller.current
    if (!sc || !now.current.typewriter || !ed.isFocused) return
    const c = ed.view.coordsAtPos(ed.state.selection.head), r = sc.getBoundingClientRect()
    sc.scrollTop += c.top - (r.top + r.height * 0.42)
  }
  const editor = useEditor({
    extensions: [StarterKit, CommentMark, Autofill.configure({ names: () => autofillNames(useBook.getState().book, now.current.cast) }), Spelling.configure({ names: () => autofillNames(useBook.getState().book) }), ...(p.extensions ?? [])] as never,
    content: p.body,
    onUpdate: ({ editor }) => { now.current.onBody(editor.getHTML(), editor as Editor); center(editor as Editor) },
    onSelectionUpdate: ({ editor }) => center(editor as Editor),
    editorProps: {
      handleClick: (_v, _pos, e) => {
        const id = (e.target as HTMLElement).closest?.('[data-comment]')?.getAttribute('data-comment')
        if (id) now.current.onOpenComment?.(id)
        return false
      },
      handleKeyDown: (_v, e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); now.current.onAddComment?.(); return true }
        return false
      },
    },
  })
  // A sync, a replace or the other editor can change this text; show it instead of overwriting it on the next keystroke.
  useEffect(() => {
    if (editor && !editor.isDestroyed && p.body !== editor.getHTML()) editor.commands.setContent(p.body, { emitUpdate: false })
  }, [p.body, editor])
  return { editor, scroller }
}

/** Opening a Find result lands on the match: ?find=text&n=2 */
export function useJump(editor: Editor | null, skipScenes: boolean) {
  const [params] = useSearchParams()
  const find = params.get('find'), n = +(params.get('n') ?? 0)
  useEffect(() => { // after React finishes: selecting redraws scene blocks, which React renders synchronously
    if (!editor || !find) return
    const t = setTimeout(() => goToText(editor, find, n, skipScenes))
    return () => clearTimeout(t)
  }, [editor, find, n, skipScenes])
}

export function Toolbar({ editor, onComment }: { editor: Editor | null; onComment: () => void }) {
  return (
    <div className="w-toolbar" role="toolbar" aria-label="Formatting">
      <button aria-label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
      <button aria-label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button aria-label="Heading" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H</button>
      <button aria-label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()}>"</button>
      <button aria-label="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
      <button title="Scene break" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>* * *</button>
      <button title="Comment on the selected text (Ctrl+Alt+M)" onClick={onComment}>Comment</button>
    </div>
  )
}
