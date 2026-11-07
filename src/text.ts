// Pure text helpers shared by the app and the node tests. No runtime imports.
import type { Book, WikiEntry } from './store.ts'

export const plain = (html: string) => html.replace(/<[^>]+>/g, ' ')
export const words = (html: string) => plain(html).split(/\s+/).filter(Boolean).length
// Whole-word, case-insensitive name match; also catches [[Name]] links.
export const mentions = (text: string, name: string) =>
  !!name.trim() && new RegExp(`\\b${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
export const namesOf = (w: WikiEntry) => [w.name, ...(w.aliases ?? [])].filter((n) => n.trim())
export const mentionsEntry = (text: string, w: WikiEntry) => namesOf(w).some((n) => mentions(text, n))

// Scenes placed in a chapter live in its HTML as <div data-scene="id" class="scene-block">...</div>.
const BLOCK = /<div data-scene="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g
export const sceneBlocks = (html: string) => [...html.matchAll(BLOCK)].map((m) => ({ id: m[1], html: m[2] }))
// Write a scene's text and mirror it into every chapter that contains it.
export const setSceneBody = (b: Book, id: string, html: string): Book => ({
  ...b,
  scenes: b.scenes.map((s) => (s.id === id ? { ...s, body: html } : s)),
  chapters: b.chapters.map((c) =>
    c.body.includes(`data-scene="${id}"`)
      ? { ...c, body: c.body.replace(new RegExp(`(<div data-scene="${id}"[^>]*>)[\\s\\S]*?(</div>)`), (_, a, z) => a + html + z) }
      : c),
})

/** Words in the book, wherever they were written: chapters, plus scenes not placed in one (placed ones are already in the chapter). */
export const bookWords = (b: Pick<Book, 'chapters' | 'scenes'>) => {
  const placed = new Set(b.chapters.flatMap((c) => sceneBlocks(c.body).map((x) => x.id)))
  return b.chapters.reduce((n, c) => n + words(c.body), 0) + b.scenes.reduce((n, s) => n + (placed.has(s.id) ? 0 : words(s.body ?? '')), 0)
}

export const decode = (s: string) =>
  s.replace(/&nbsp;/g, '\u00a0').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
export const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;')

// Readable text: paragraphs stay paragraphs, tags go, entities become characters.
export const toText = (html: string) =>
  decode(html.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|h\d|li|blockquote)>/g, '\n\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim()
