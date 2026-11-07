// Comments are private notes marked on a phrase. They live in the prose HTML itself as
// <span data-comment="id" data-note="...">phrase</span>, so they sync, merge and follow a scene into its chapter
// with no data of their own. The note is URI-encoded: no quotes or angle brackets can reach the HTML, so every
// tag-stripping regex in the app stays correct.
import type { Book } from './store.ts'
import { decode } from './text.ts'

export interface Note { id: string; note: string; quote: string }
export interface BookNote extends Note { where: string; to: string }

const noteOf = (raw: string) => { try { return decodeURIComponent(raw) } catch { return raw } }
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]

/** Every comment in a piece of prose, in reading order, with the phrase it sits on. */
export function commentsIn(html: string): Note[] {
  const found = new Map<string, Note>()
  const open: (Note | null)[] = []
  for (const tok of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (tok[0] !== '<') { for (const n of open) if (n) n.quote += tok; continue }
    if (tok.startsWith('</span')) { open.pop(); continue }
    if (!tok.startsWith('<span')) continue
    const id = attr(tok, 'data-comment')
    if (!id) { open.push(null); continue }
    const n = found.get(id) ?? { id, note: noteOf(attr(tok, 'data-note') ?? ''), quote: '' }
    found.set(id, n)
    open.push(n)
  }
  return [...found.values()].map((n) => ({ ...n, quote: decode(n.quote) }))
}

/** All comments in the book. A scene placed in a chapter is the same text twice, so each comment appears once, under its scene. */
export function allComments(b: Pick<Book, 'scenes' | 'chapters'>): BookNote[] {
  const seen = new Set<string>()
  const out: BookNote[] = []
  const add = (html: string | undefined, where: string, to: string) => {
    for (const n of commentsIn(html ?? '')) if (!seen.has(n.id)) { seen.add(n.id); out.push({ ...n, where, to }) }
  }
  for (const s of b.scenes) add(s.body, s.title, `/scenes?s=${s.id}`)
  for (const c of b.chapters) add(c.body, c.title, `/write?c=${c.id}`)
  return out
}
