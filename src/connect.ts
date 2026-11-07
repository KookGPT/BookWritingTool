// Pure: how everything in the book relates. Nearly all of it is worked out from names, dates and scene details; the one
// thing kept by hand is TEvent.sceneIds, because nothing in the text can say "this scene is this timeline event".
import { moveTo } from './plan.ts'
import type { Book, Scene, TEvent } from './store.ts'
import { namesOf, plain, sceneBlocks, toText } from './text.ts'

export type Kind = 'scene' | 'chapter' | 'wiki' | 'event' | 'plan' | 'idea' | 'place'
export interface Ref { kind: Kind; id: string }
export interface Hit extends Ref { title: string; to: string; why: string; manual?: boolean }
interface Node extends Ref { title: string; to: string; names: string[]; text: string }

const keyOf = (r: Ref) => `${r.kind}:${r.id}`
const DEFAULT_TITLE = /^(Scene|Chapter) \d+$|^New (card|party event|world event)$/
const titleName = (t: string) => (t.trim().split(/\s+/).length >= 2 && !DEFAULT_TITLE.test(t.trim()) ? [t.trim()] : [])
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const placeId = (world: string, item: string) => `${world}/${item}`
export const placeLink = (id: string) => { const [w, p] = id.split('/'); return `/map-test?w=${w}&place=${p}` }

/** The story's reading order: scenes as they sit in the chapters, then the rest in board order. */
export function sceneOrder(b: Pick<Book, 'scenes' | 'chapters'>): Scene[] {
  const byId = new Map(b.scenes.map((s) => [s.id, s]))
  const out = new Map<string, Scene>()
  const push = (s?: Scene) => { if (s && !out.has(s.id)) out.set(s.id, s) }
  for (const c of b.chapters) {
    for (const { id } of sceneBlocks(c.body)) push(byId.get(id))
    for (const s of b.scenes) if (s.chapterId === c.id) push(s)
  }
  b.scenes.forEach(push)
  return [...out.values()]
}

// Where a scene's order comes from: its place in a chapter's text, its assigned chapter, or the board.
const orderGroup = (b: Pick<Book, 'scenes' | 'chapters'>, s: Scene) => {
  const holder = b.chapters.find((c) => c.body.includes(`data-scene="${s.id}"`))
  return holder ? `placed:${holder.id}` : b.chapters.some((c) => c.id === s.chapterId) ? `chapter:${s.chapterId}` : 'loose'
}
export const canReorder = (b: Pick<Book, 'scenes' | 'chapters'>, id: string, target: string) => {
  const s = b.scenes.find((x) => x.id === id), t = b.scenes.find((x) => x.id === target)
  return !!s && !!t && orderGroup(b, s) === orderGroup(b, t)
}
const blockRe = (id: string) => new RegExp(`<div data-scene="${id}"[^>]*>[\\s\\S]*?</div>`)
const moveBlock = (html: string, id: string, target: string, after: boolean) => {
  const block = blockRe(id).exec(html)?.[0]
  if (!block) return html
  const rest = html.replace(block, () => '')
  const t = blockRe(target).exec(rest)
  if (!t) return html
  const at = after ? t.index + t[0].length : t.index
  return rest.slice(0, at) + block + rest.slice(at)
}

/** Puts a scene just before or after another, so the story order changes. Scenes stay with their chapter: moving between chapters is a chapter change, not a drag. */
export function moveScene(b: Book, id: string, target: string, after: boolean): Book {
  if (id === target || !canReorder(b, id, target)) return b
  const scenes = moveTo(b.scenes, id, target, after)
  const chapters = b.chapters.map((c) => (c.body.includes(`data-scene="${id}"`) ? { ...c, body: moveBlock(c.body, id, target, after) } : c))
  const out = { ...b, scenes, chapters }
  return sceneOrder(out).every((s, i) => s.id === sceneOrder(b)[i].id) ? b : out
}

export interface Near { id: string; title: string; to: string; gist: string; text: string; status?: string }
const clip = (t: string, end: boolean) => (t.length <= 220 ? t : end ? `…${t.slice(-220).trim()}` : `${t.slice(0, 220).trim()}…`)
const flat = (t: string) => t.replace(/\s+/g, ' ').trim()

const nearScene = (s: Scene, before: boolean): Near => {
  const text = toText(s.body ?? '')
  const planned = before ? s.outcome || s.summary : s.summary || s.goal
  return { id: s.id, title: s.title, to: `/scenes?s=${s.id}`, status: s.status ?? 'planned', text, gist: planned?.trim() || clip(flat(text), before) }
}

/** The scenes just before and just after one. Both lists read in story order. */
export function sceneNeighbours(b: Pick<Book, 'scenes' | 'chapters'>, id: string, n = 2) {
  const list = sceneOrder(b)
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return { before: [] as Near[], after: [] as Near[] }
  return { before: list.slice(Math.max(0, i - n), i).map((s) => nearScene(s, true)), after: list.slice(i + 1, i + 1 + n).map((s) => nearScene(s, false)) }
}

export function chapterNeighbours(b: Pick<Book, 'chapters'>, id: string, n = 2) {
  const i = b.chapters.findIndex((c) => c.id === id)
  const near = (before: boolean) => (c: Book['chapters'][number]): Near => {
    const text = toText(c.body)
    return { id: c.id, title: c.title, to: `/write?c=${c.id}`, status: c.status, text, gist: clip(flat(text), before) }
  }
  if (i < 0) return { before: [] as Near[], after: [] as Near[] }
  return { before: b.chapters.slice(Math.max(0, i - n), i).map(near(true)), after: b.chapters.slice(i + 1, i + 1 + n).map(near(false)) }
}

function nodesOf(b: Book): Node[] {
  const nodes: Node[] = []
  for (const s of b.scenes) nodes.push({ kind: 'scene', id: s.id, title: s.title, to: `/scenes?s=${s.id}`, names: titleName(s.title),
    text: [s.title, s.summary, s.goal, s.conflict, s.outcome, s.beats, s.notes, s.when, plain(s.body ?? '')].filter(Boolean).join('\n') })
  for (const c of b.chapters) nodes.push({ kind: 'chapter', id: c.id, title: c.title, to: `/write?c=${c.id}`, names: [], text: `${c.title}\n${plain(c.body)}\n${c.notes}` })
  for (const w of b.wiki) nodes.push({ kind: 'wiki', id: w.id, title: w.name, to: `/wiki/${w.id}`, names: namesOf(w), text: `${w.notes}\n${Object.values(w.fields).join('\n')}` })
  for (const e of b.events) nodes.push({ kind: 'event', id: e.id, title: e.title, to: `/timeline?e=${e.id}`, names: titleName(e.title), text: `${e.title}\n${e.summary}\n${e.location}` })
  for (const p of b.plan) nodes.push({ kind: 'plan', id: p.id, title: p.title, to: `/timeline?p=${p.id}`, names: titleName(p.title), text: `${p.title}\n${p.summary}` })
  for (const i of b.ideas) nodes.push({ kind: 'idea', id: i.id, title: i.text.slice(0, 60), to: `/ideas?i=${i.id}`, names: [], text: `${i.text}\n${i.description ?? ''}` })
  for (const w of b.flatWorlds) {
    const place = (item: { id: string; name?: string; note?: string }) => {
      if (!item.name?.trim()) return
      const id = placeId(w.id, item.id)
      nodes.push({ kind: 'place', id, title: item.name, to: placeLink(id), names: [item.name.trim()], text: item.note ?? '' })
    }
    w.features.forEach(place)
    for (const l of w.layers ?? []) l.items.forEach(place)
  }
  return nodes
}

const sameDay = (s: Scene, e: TEvent) => !!s.date && e.date.m !== undefined && s.date.y === e.date.y && s.date.m === e.date.m && (e.date.d === undefined || s.date.d === e.date.d)

function build(b: Book): Map<string, Hit[]> {
  const nodes = nodesOf(b)
  const byKey = new Map(nodes.map((n) => [keyOf(n), n]))
  const out = new Map<string, Map<string, Hit>>()
  const put = (from: Node, to: Node, why: string, manual?: boolean) => {
    if (from === to) return
    let hits = out.get(keyOf(from))
    if (!hits) out.set(keyOf(from), hits = new Map())
    if (!hits.has(keyOf(to))) hits.set(keyOf(to), { kind: to.kind, id: to.id, title: to.title, to: to.to, why, manual })
  }
  const link = (a: Ref, z: Ref, why: string, manual?: boolean) => {
    const A = byKey.get(keyOf(a)), Z = byKey.get(keyOf(z))
    if (A && Z) { put(A, Z, why, manual); put(Z, A, why, manual) }
  }
  const wiki = (id: string) => ({ kind: 'wiki' as const, id })
  const scene = (id: string) => ({ kind: 'scene' as const, id })

  // Stated connections first: a hit keeps the first reason found, and these are the strongest.
  for (const e of b.events) for (const s of e.sceneIds ?? []) link({ kind: 'event', id: e.id }, scene(s), 'linked by you', true)
  for (const p of b.plan) if (p.sceneId) link({ kind: 'plan', id: p.id }, scene(p.sceneId), 'planning card')
  for (const s of b.scenes) {
    const me = scene(s.id)
    if (s.pov) link(me, wiki(s.pov), 'POV')
    if (s.location) link(me, wiki(s.location), 'set here')
    for (const c of s.characters ?? []) link(me, wiki(c), 'in this scene')
    if (s.chapterId) link(me, { kind: 'chapter', id: s.chapterId }, 'in this chapter')
  }
  for (const c of b.chapters) for (const { id } of sceneBlocks(c.body)) link({ kind: 'chapter', id: c.id }, scene(id), 'in this chapter')
  for (const e of b.events) {
    const me = { kind: 'event' as const, id: e.id }
    if (e.locationId) link(me, wiki(e.locationId), 'set here')
    if (e.wikiId) link(me, wiki(e.wikiId), 'related')
    for (const s of b.scenes) if (sameDay(s, e)) link(me, scene(s.id), 'same date')
  }
  for (const w of b.wiki) for (const l of w.links ?? []) link(wiki(w.id), wiki(l.to), l.label || 'related')
  for (const e of b.events) if (e.locationId) for (const s of b.scenes) if (s.location === e.locationId) link({ kind: 'event', id: e.id }, scene(s.id), 'same place')

  // Then names in text. Case must match, so a character called Rose does not light up on "she rose".
  const owners = new Map<string, Node[]>()
  for (const n of nodes) for (const name of n.names) {
    const key = name.trim()
    if (key.length < 3) continue
    const list = owners.get(key)
    if (list) list.push(n); else owners.set(key, [n])
  }
  if (owners.size) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...owners.keys()].sort((x, y) => y.length - x.length).map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
    for (const n of nodes) for (const name of new Set(n.text.match(re) ?? [])) for (const o of owners.get(name) ?? []) { put(n, o, 'mentioned here'); put(o, n, 'mentions this') }
  }

  // A map place and a wiki page with the same name are one thing, so each picks up the other's connections.
  const wikiByName = new Map<string, Node>()
  for (const w of b.wiki) for (const name of namesOf(w)) wikiByName.set(name.trim().toLowerCase(), byKey.get(keyOf(wiki(w.id)))!)
  for (const p of nodes) {
    if (p.kind !== 'place') continue
    const w = wikiByName.get(p.title.trim().toLowerCase())
    if (!w) continue
    put(p, w, 'same name'); put(w, p, 'on the map')
    for (const h of [...(out.get(keyOf(w))?.values() ?? [])]) {
      const other = byKey.get(keyOf(h))!
      if (other === p) continue
      put(p, other, h.why); put(other, p, 'on the map')
    }
  }
  const done = new Map<string, Hit[]>()
  for (const [k, hits] of out) done.set(k, [...hits.values()])
  return done
}

const cache = new WeakMap<Book, Map<string, Hit[]>>()
/** Everything connected to an item. Built once per version of the book, however many items ask. */
export function connected(b: Book, r: Ref): Hit[] {
  let g = cache.get(b)
  if (!g) cache.set(b, g = build(b))
  return g.get(keyOf(r)) ?? []
}

/** Tie a scene to a timeline event, or undo that. */
export const linkScene = (b: Book, sceneId: string, eventId: string, on: boolean): Book => ({
  ...b,
  events: b.events.map((e) => {
    if (e.id !== eventId) return e
    const rest = (e.sceneIds ?? []).filter((s) => s !== sceneId)
    return { ...e, sceneIds: on ? [...rest, sceneId] : rest }
  }),
})
