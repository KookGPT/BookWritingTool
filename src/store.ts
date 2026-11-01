import { create } from 'zustand'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { type Calendar, DEFAULT_CAL, type SDate } from './calendar'

export interface Chapter { id: string; title: string; body: string; status: 'draft' | 'revised' | 'done'; notes: string }
export interface WikiEntry {
  id: string; type: string; name: string; fields: Record<string, string>; notes: string; image?: string
  links?: { to: string; label: string }[] // relationships to other wiki entries (to = wiki id)
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
export interface Idea { id: string; text: string; tags: string[]; pinned: boolean }
export interface Scene {
  id: string; title: string; summary: string
  chapterId?: string; pov?: string; when?: string // pov/location/characters hold wiki ids; when = in-story date, free text
  location?: string; characters?: string[]; status?: 'planned' | 'drafting' | 'done'
  threads?: string[] // plot thread ids this scene advances
  goal?: string; conflict?: string; outcome?: string; beats?: string // plan, filled in while status is 'planned'
  notes?: string // draft notes: what changed from the plan, what to fix on revision
  date?: SDate // in-world date on the book's calendar; `when` stays a free-text note (e.g. "dawn")
}

export interface Pin { id: string; y: number; x: number; label: string; wikiId?: string }
// image is a downscaled JPEG data URL so the whole map syncs as one JSON file.
export interface MapDoc { id: string; name: string; image: string; w: number; h: number; pins: Pin[] }

// Timeline: party events draw above the rail, world events below, periods as bars on it. m/d optional (year-only dates).
export interface TDate { y: number; m?: number; d?: number }
export interface TEvent { id: string; kind: 'party' | 'world'; title: string; date: TDate; location: string; summary: string; estimated?: boolean; wikiId?: string
  locationId?: string } // wiki ids; `location` stays as free text for places not in the wiki
export interface Period { id: string; title: string; color: string; start: TDate; end: TDate; startEvent?: string; endEvent?: string; summary?: string }

export interface Thread { id: string; name: string; resolved: boolean }

export interface Book {
  title: string
  threads: Thread[]
  config: { types: Record<string, string[]>; calendar?: Calendar }
  stats: { goal: number; days: Record<string, number> } // days = net words written per local date
  maps: MapDoc[]
  chapters: Chapter[] // array order = book order
  wiki: WikiEntry[]
  ideas: Idea[]
  scenes: Scene[]
  events: TEvent[]
  periods: Period[]
}

export const emptyBook = (): Book => ({ title: 'Untitled Book', threads: [], config: { types: {} }, stats: { goal: 500, days: {} }, maps: [], chapters: [], wiki: [], ideas: [], scenes: [], events: [], periods: [] })
export const plain = (html: string) => html.replace(/<[^>]+>/g, ' ')
export const words = (html: string) => plain(html).split(/\s+/).filter(Boolean).length
export const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local time
// Whole-word, case-insensitive name match; also catches [[Name]] links.
export const mentions = (text: string, name: string) =>
  !!name.trim() && new RegExp(`\\b${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
export const uid =() => crypto.randomUUID().slice(0, 8)

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
