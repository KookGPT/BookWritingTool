import { create } from 'zustand'
import { get as idbGet, set as idbSet } from 'idb-keyval'

export interface Chapter { id: string; title: string; body: string; status: 'draft' | 'revised' | 'done'; notes: string }
export interface WikiEntry { id: string; type: string; name: string; fields: Record<string, string>; notes: string }
export interface Idea { id: string; text: string; tags: string[]; pinned: boolean }
export interface Scene {
  id: string; title: string; summary: string
  chapterId?: string; pov?: string; when?: string // pov/location/characters hold wiki ids; when = in-story date, free text
  location?: string; characters?: string[]; status?: 'planned' | 'drafting' | 'done'
}

export interface Pin { id: string; y: number; x: number; label: string; wikiId?: string }
// image is a downscaled JPEG data URL so the whole map syncs as one JSON file.
export interface MapDoc { id: string; name: string; image: string; w: number; h: number; pins: Pin[] }

export interface Book {
  title: string
  stats: { goal: number; days: Record<string, number> } // days = net words written per local date
  maps: MapDoc[]
  chapters: Chapter[] // array order = book order
  wiki: WikiEntry[]
  ideas: Idea[]
  scenes: Scene[]
}

export const emptyBook = (): Book => ({ title: 'Untitled Book', stats: { goal: 500, days: {} }, maps: [], chapters: [], wiki: [], ideas: [], scenes: [] })
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
}

const KEY = 'book'
const save = (s: { book: Book; dirty: boolean }) => idbSet(KEY, { book: s.book, dirty: s.dirty })

export const useBook = create<State>((set, get) => ({
  book: emptyBook(),
  dirty: false,
  ready: false,
  update: (fn) => { set({ book: fn(get().book), dirty: true }); save(get()) },
  replace: (book, dirty) => { set({ book, dirty }); save(get()) },
}))

idbGet<{ book: Book; dirty: boolean }>(KEY).then((s) => {
  useBook.setState({ ...(s ? { book: { ...emptyBook(), ...s.book }, dirty: s.dirty } : {}), ready: true })
})
