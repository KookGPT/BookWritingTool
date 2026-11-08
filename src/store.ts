import { create } from 'zustand'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { type Calendar, DEFAULT_CAL, type SDate } from './calendar'
import type { World } from './world/terrain.ts'
import type { FlatWorld } from './flatworld/gen.ts'
import type { LocationDoc } from './locations/city.ts'
import { bookWords, mentions, mentionsEntry, namesOf, plain, sceneBlocks, setSceneBody, words } from './text.ts'

export { bookWords, mentions, mentionsEntry, namesOf, plain, sceneBlocks, setSceneBody, words }

export interface Chapter { id: string; title: string; body: string; status: 'draft' | 'revised' | 'done'; notes: string }
export interface WikiEntry {
  id: string; type: string; name: string; fields: Record<string, string>; notes: string; image?: string
  pos?: { x: number; y: number } // where the node sits in the relationship graph
  hiddenFields?: string[] // starter fields of its type that this entry has removed
  aliases?: string[] // other names this entry goes by; they link and match exactly like the name
  links?: { to: string; label: string }[] // relationships to other wiki entries (to = wiki id)
  place?: { worldId: string; lat: number; lon: number } // where it sits on a globe
}

// Built-in entry types with their starter fields; the user's own types live in book.config.types.
export const DEFAULT_TYPES: Record<string, string[]> = {
  character: ['Role', 'Age', 'Appearance', 'Goals'],
  organization: ['Purpose', 'Leader', 'Headquarters'],
  location: ['Region', 'Climate'],
  event: ['Date', 'Location', 'Participants'],
  item: ['Origin', 'Owner'],
  creature: ['Habitat', 'Abilities', 'Weaknesses'],
  magic: ['Source', 'Cost', 'Limits'],
  religion: ['Deity', 'Beliefs', 'Followers'],
  culture: ['Region', 'Customs', 'Language'],
}
export const calendarOf = (b: Book): Calendar => b.config.calendar ?? DEFAULT_CAL
export const allTypes =(b: Book) => ({ ...DEFAULT_TYPES, ...b.config.types })
export interface Idea { id: string; text: string; tags: string[]; pinned: boolean; description?: string }
export interface Scene {
  id: string; title: string; summary: string
  chapterId?: string; pov?: string; when?: string // pov/location/characters hold wiki ids; when = in-story date, free text
  location?: string; characters?: string[]; status?: 'planned' | 'drafting' | 'done'
  threads?: string[] // plot thread ids this scene advances
  goal?: string; conflict?: string; outcome?: string; beats?: string // plan, filled in while status is 'planned'
  body?: string // the scene's prose (HTML); linked into a chapter as <div data-scene=id>
  notes?: string // draft notes: what changed from the plan, what to fix on revision
  date?: SDate // in-world date on the book's calendar; `when` stays a free-text note (e.g. "dawn")
}

export interface Pin { id: string; y: number; x: number; label: string; wikiId?: string }
// image is a downscaled JPEG data URL so the whole map syncs as one JSON file.
export interface MapDoc { id: string; name: string; image: string; w: number; h: number; pins: Pin[] }

// Timeline: party events draw above the rail, world events below, periods as bars on it. m/d optional (year-only dates).
export interface TDate { y: number; m?: number; d?: number }
export interface TEvent { id: string; kind: 'party' | 'world'; title: string; date: TDate; location: string; summary: string; estimated?: boolean; wikiId?: string
  locationId?: string // wiki ids; `location` stays as free text for places not in the wiki
  sceneIds?: string[] } // scenes tied to this event by hand; everything else is worked out (see connect.ts)
export interface Period { id: string; title: string; color: string; start: TDate; end: TDate; startEvent?: string; endEvent?: string; summary?: string }

// Planning Timeline: an ordered list with no dates (array order = order). Cards can later move onto the Production Timeline.
export interface PlanItem { id: string; title: string; summary: string; color?: string; kind?: 'party' | 'world'; sceneId?: string }

export interface Thread { id: string; name: string; resolved: boolean }

export interface Book {
  title: string
  threads: Thread[]
  config: { types: Record<string, string[]>; calendar?: Calendar }
  stats: { goal: number; days: Record<string, number> } // days = net words written per local date
  maps: MapDoc[]
  worlds: World[] // 3D globes; the planet is regenerated from seed + params, so these stay tiny
  flatWorlds: FlatWorld[] // New Map Test: flat (rectangle or disc) worlds built from named features
  locations: LocationDoc[] // Locations: city-scale 3D places built from recipes
  chapters: Chapter[] // array order = book order
  wiki: WikiEntry[]
  ideas: Idea[]
  scenes: Scene[]
  events: TEvent[]
  periods: Period[]
  plan: PlanItem[]
}

export const emptyBook = (): Book => ({ title: 'Untitled Book', threads: [], config: { types: {} }, stats: { goal: 500, days: {} }, maps: [], worlds: [], flatWorlds: [], locations: [], chapters: [], wiki: [], ideas: [], scenes: [], events: [], periods: [], plan: [] })
export const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local time
const dayKey = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return d.toLocaleDateString('en-CA') }
// Consecutive days that met the goal; today does not break the streak until the day is over.
export function streakOf(s: Book['stats']) {
  let n = 0
  for (let i = (s.days[today()] ?? 0) >= s.goal ? 0 : 1; (s.days[dayKey(i)] ?? 0) >= s.goal && s.goal > 0; i++) n++
  return n
}
// Words typed count toward today's goal, wherever they were typed. Moving text between places does not go through here.
export const addWords = (b: Book, before: string, after: string): Book => {
  const d = words(after) - words(before), day = today()
  return d ? { ...b, stats: { ...b.stats, days: { ...b.stats.days, [day]: Math.max(0, (b.stats.days[day] ?? 0) + d) } } } : b
}
export const uid =() => crypto.randomUUID().slice(0, 8)

const hasText = (html?: string) => !!html?.replace(/<[^>]+>/g, '').trim()
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const blockRe = (id: string) => new RegExp(`<div data-scene="${id}"[^>]*>[\\s\\S]*?</div>`)
// The text a scene contributes: its prose, or (if none was written yet) its premise so the chapter never shows an empty box.
const sceneHtml = (s: Scene) => (hasText(s.body) ? s.body! : s.summary.trim() ? `<p>${esc(s.summary.trim())}</p>` : '<p></p>')

// Every drafting/done scene assigned to a chapter must appear in that chapter's text (appended in scene order).
export function syncPlacement(b: Book): Book {
  let out = b
  for (const s of b.scenes) {
    if (!s.chapterId || (s.status ?? 'planned') === 'planned') continue
    const html = sceneHtml(s)
    const holder = out.chapters.find((c) => c.body.includes(`data-scene="${s.id}"`))
    if (holder) {
      // Placed earlier but empty (e.g. before the scene had text): fill it in.
      if (hasText(html) && !hasText(sceneBlocks(holder.body).find((x) => x.id === s.id)?.html))
        out = { ...out, scenes: out.scenes.map((x) => (x.id === s.id ? { ...x, body: html } : x)), chapters: out.chapters.map((c) => (c === holder ? { ...c, body: c.body.replace(blockRe(s.id), `<div data-scene="${s.id}" class="scene-block">${html}</div>`) } : c)) }
      continue
    }
    out = {
      ...out,
      scenes: out.scenes.map((x) => (x.id === s.id ? { ...x, body: html } : x)),
      chapters: out.chapters.map((c) => (c.id === s.chapterId ? { ...c, body: `${c.body}<div data-scene="${s.id}" class="scene-block">${html}</div>` } : c)),
    }
  }
  return out
}
export const needsPlacement = (b: Book) => syncPlacement(b) !== b

// Change a scene; moving it between chapters (or out of one) moves its text with it.
export function patchScene(b: Book, id: string, p: Partial<Scene>): Book {
  const old = b.scenes.find((s) => s.id === id)
  let out: Book = { ...b, scenes: b.scenes.map((s) => (s.id === id ? { ...s, ...p } : s)) }
  if (old && 'chapterId' in p && p.chapterId !== old.chapterId) {
    out = { ...out, chapters: out.chapters.map((c) => (c.body.includes(`data-scene="${id}"`) ? { ...c, body: c.body.replace(blockRe(id), '') } : c)) }
  }
  return syncPlacement(out)
}

interface State {
  book: Book
  dirty: boolean
  ready: boolean
  update: (fn: (b: Book) => Book) => void
  replace: (b: Book, dirty: boolean) => void
  markSynced: (b: Book) => void // clean only if nothing was typed since b
}

const KEY = 'book'
const save = (s: { book: Book; dirty: boolean }) => idbSet(KEY, { book: s.book, dirty: s.dirty })

export const useBook = create<State>((set, get) => ({
  book: emptyBook(),
  dirty: false,
  ready: false,
  update: (fn) => { set({ book: fn(get().book), dirty: true }); save(get()) },
  replace: (book, dirty) => { set({ book, dirty }); save(get()) },
  markSynced: (b) => { if (get().book === b) { set({ dirty: false }); save(get()) } },
}))

idbGet<{ book: Book; dirty: boolean }>(KEY).then((s) => {
  useBook.setState({ ...(s ? { book: { ...emptyBook(), ...s.book }, dirty: s.dirty } : {}), ready: true })
})
