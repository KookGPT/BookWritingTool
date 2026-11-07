// Pure: find and replace across the book. Prose is HTML, so only text between tags is searched; a tag, a comment's note
// or a scene id can never be matched or changed. Scenes placed in a chapter are found once, in the scene.
import type { Book } from './store.ts'
import { decode, encode, setSceneBody } from './text.ts'

export interface Query { find: string; matchCase?: boolean; wholeWord?: boolean }
export interface Match {
  key: string // field#n: identifies this match so it can be skipped
  kind: string; id: string; title: string; field: string; to: string
  before: string; hit: string; after: string
  nth: number // which occurrence of exactly this text in the field, for jumping to it
  prose: boolean // lives in an editor, so it can be selected there
}
interface Field { key: string; kind: string; id: string; title: string; field: string; to: string; html: boolean; value: string; set: (b: Book, v: string) => Book }

const on = <T extends { id: string }>(list: T[], id: string, fn: (x: T) => T) => list.map((x) => (x.id === id ? fn(x) : x))
const tagsOf = (t: string) => [...t.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase())

function fields(b: Book): Field[] {
  const out: Field[] = []
  const add = (kind: string, id: string, title: string, to: string, field: string, value: string | undefined, set: Field['set'], html = false) => {
    if (value) out.push({ key: `${kind}:${id}:${field}`, kind, id, title, field, to, html, value, set })
  }
  for (const s of b.scenes) {
    const to = `/scenes?s=${s.id}`
    add('scene', s.id, s.title, to, 'Text', s.body, (x, v) => setSceneBody(x, s.id, v), true)
    for (const [k, label] of [['title', 'Title'], ['summary', 'Premise'], ['goal', 'Goal'], ['conflict', 'Conflict'], ['outcome', 'Outcome'], ['beats', 'Beats'], ['notes', 'Draft notes'], ['when', 'Time note']] as const)
      add('scene', s.id, s.title, to, label, s[k], (x, v) => ({ ...x, scenes: on(x.scenes, s.id, (y) => ({ ...y, [k]: v })) }))
  }
  for (const c of b.chapters) {
    const to = `/write?c=${c.id}`
    add('chapter', c.id, c.title, to, 'Text', c.body, (x, v) => ({ ...x, chapters: on(x.chapters, c.id, (y) => ({ ...y, body: v })) }), true)
    for (const [k, label] of [['title', 'Title'], ['notes', 'Notes']] as const)
      add('chapter', c.id, c.title, to, label, c[k], (x, v) => ({ ...x, chapters: on(x.chapters, c.id, (y) => ({ ...y, [k]: v })) }))
  }
  for (const w of b.wiki) {
    const to = `/wiki/${w.id}`
    add('wiki', w.id, w.name, to, 'Name', w.name, (x, v) => ({ ...x, wiki: on(x.wiki, w.id, (y) => ({ ...y, name: v })) }))
    add('wiki', w.id, w.name, to, 'Notes', w.notes, (x, v) => ({ ...x, wiki: on(x.wiki, w.id, (y) => ({ ...y, notes: v })) }))
    ;(w.aliases ?? []).forEach((a, i) => add('wiki', w.id, w.name, to, `Alias ${i + 1}`, a, (x, v) => ({ ...x, wiki: on(x.wiki, w.id, (y) => ({ ...y, aliases: y.aliases?.map((z, j) => (j === i ? v : z)) })) })))
    for (const k of Object.keys(w.fields)) add('wiki', w.id, w.name, to, k, w.fields[k], (x, v) => ({ ...x, wiki: on(x.wiki, w.id, (y) => ({ ...y, fields: { ...y.fields, [k]: v } })) }))
  }
  for (const e of b.events) {
    const to = `/timeline?e=${e.id}`
    for (const [k, label] of [['title', 'Title'], ['summary', 'What happens'], ['location', 'Place']] as const)
      add('event', e.id, e.title, to, label, e[k], (x, v) => ({ ...x, events: on(x.events, e.id, (y) => ({ ...y, [k]: v })) }))
  }
  for (const p of b.periods) {
    add('period', p.id, p.title, '/timeline', 'Title', p.title, (x, v) => ({ ...x, periods: on(x.periods, p.id, (y) => ({ ...y, title: v })) }))
    add('period', p.id, p.title, '/timeline', 'Summary', p.summary, (x, v) => ({ ...x, periods: on(x.periods, p.id, (y) => ({ ...y, summary: v })) }))
  }
  for (const p of b.plan) {
    const to = `/timeline?p=${p.id}`
    for (const [k, label] of [['title', 'Title'], ['summary', 'Notes']] as const)
      add('plan', p.id, p.title, to, label, p[k], (x, v) => ({ ...x, plan: on(x.plan, p.id, (y) => ({ ...y, [k]: v })) }))
  }
  for (const i of b.ideas) {
    const to = `/ideas?i=${i.id}`
    const title = i.text.slice(0, 50)
    add('idea', i.id, title, to, 'Idea', i.text, (x, v) => ({ ...x, ideas: on(x.ideas, i.id, (y) => ({ ...y, text: v, tags: tagsOf(v) })) }))
    add('idea', i.id, title, to, 'Description', i.description, (x, v) => ({ ...x, ideas: on(x.ideas, i.id, (y) => ({ ...y, description: v })) }))
  }
  for (const w of b.flatWorlds) {
    const to = (item: string) => `/map-test?w=${w.id}&place=${item}`
    const feature = (x: Book, id: string, p: object) => ({ ...x, flatWorlds: on(x.flatWorlds, w.id, (y) => ({ ...y, features: on(y.features, id, (f) => ({ ...f, ...p })) })) })
    for (const f of w.features) {
      add('map', f.id, f.name ?? w.name, to(f.id), 'Name', f.name, (x, v) => feature(x, f.id, { name: v }))
      add('map', f.id, f.name ?? w.name, to(f.id), 'Notes', f.note, (x, v) => feature(x, f.id, { note: v }))
    }
    const item = (x: Book, layer: string, id: string, p: object) => ({ ...x, flatWorlds: on(x.flatWorlds, w.id, (y) => ({ ...y, layers: y.layers && on(y.layers, layer, (l) => ({ ...l, items: on(l.items, id, (i) => ({ ...i, ...p })) })) })) })
    for (const l of w.layers ?? []) for (const it of l.items) {
      add('map', it.id, it.name ?? l.name, to(it.id), 'Name', it.name, (x, v) => item(x, l.id, it.id, { name: v }))
      add('map', it.id, it.name ?? l.name, to(it.id), 'Notes', it.note, (x, v) => item(x, l.id, it.id, { note: v }))
    }
  }
  return out
}

const patternOf = (q: Query) => {
  const body = q.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(q.wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, q.matchCase ? 'gu' : 'giu')
}
// A whole placed scene counts as one "tag": its text belongs to the scene, not the chapter.
const TOKEN = /(<div data-scene="[^"]*"[^>]*>[\s\S]*?<\/div>|<[^>]+>)/

/** Runs fn over each stretch of text in a field. In HTML it sees decoded text, and only what it changes is re-encoded. */
function eachText(f: Pick<Field, 'html' | 'value'>, fn: (t: string) => string): string {
  if (!f.html) return fn(f.value)
  return f.value.split(TOKEN).map((part, i) => {
    if (i % 2 || !part) return part
    const t = decode(part), r = fn(t)
    return r === t ? part : encode(r)
  }).join('')
}

// ponytail: searches one text run at a time, so a word half in italics or half under a comment is not found. Joining runs needs a position map.
export function findAll(b: Book, q: Query): Match[] {
  if (!q.find) return []
  const re = patternOf(q)
  const out: Match[] = []
  for (const f of fields(b)) {
    let n = 0
    const seen = new Map<string, number>()
    eachText(f, (t) => {
      for (const m of t.matchAll(re)) {
        const nth = seen.get(m[0]) ?? 0
        seen.set(m[0], nth + 1)
        out.push({ key: `${f.key}#${n++}`, kind: f.kind, id: f.id, title: f.title, field: f.field, to: f.to, prose: f.html,
          before: t.slice(Math.max(0, m.index - 50), m.index), hit: m[0], after: t.slice(m.index + m[0].length, m.index + m[0].length + 50), nth })
      }
      return t
    })
  }
  return out
}

export interface ReplaceOpts { skip?: Set<string>; keepAlias?: boolean }
export function replaceAll(b: Book, q: Query, by: string, { skip, keepAlias }: ReplaceOpts = {}): Book {
  if (!q.find) return b
  const re = patternOf(q)
  let out = b
  // Chapters first: a scene's change is then mirrored into its chapter, not overwritten by the chapter's older copy.
  for (const f of fields(b).sort((x, y) => Number(y.kind === 'chapter') - Number(x.kind === 'chapter'))) {
    let n = 0
    const value = eachText(f, (t) => t.replace(re, (m) => (skip?.has(`${f.key}#${n++}`) ? m : by)))
    if (value !== f.value) out = f.set(out, value)
  }
  if (keepAlias) out = { ...out, wiki: out.wiki.map((w) => {
    const old = b.wiki.find((x) => x.id === w.id)
    return old && old.name !== w.name && !(w.aliases ?? []).includes(old.name) ? { ...w, aliases: [...(w.aliases ?? []), old.name] } : w
  }) }
  return out
}

const LISTS = ['scenes', 'chapters', 'wiki', 'events', 'periods', 'plan', 'ideas', 'flatWorlds'] as const
/** Puts back what a replace changed and leaves everything else as it is now. */
export function undoReplace(now: Book, before: Book, after: Book): Book {
  const out = { ...now } as Record<string, unknown>
  for (const k of LISTS) {
    const was = new Map((before[k] as { id: string }[]).map((x) => [x.id, x]))
    const made = new Map((after[k] as { id: string }[]).map((x) => [x.id, x]))
    out[k] = (now[k] as { id: string }[]).map((x) => (was.has(x.id) && was.get(x.id) !== made.get(x.id) ? was.get(x.id)! : x))
  }
  return out as unknown as Book
}
