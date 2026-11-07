// Pure: the one thing most worth doing next. No runtime imports so it runs under plain node for tests.
import type { Book } from './store.ts'

const wordCount = (html: string) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length

export function nextStep(b: Pick<Book, 'chapters' | 'scenes'>): { text: string; to: string } {
  if (!b.chapters.length) return { text: 'Add your first chapter', to: '/write' }
  const empty = b.chapters.find((c) => !wordCount(c.body))
  if (empty) return { text: `Start writing "${empty.title}"`, to: `/write?c=${empty.id}` }
  const planned = b.scenes.find((s) => (s.status ?? 'planned') === 'planned')
  if (planned) return { text: `Draft the planned scene "${planned.title}"`, to: `/scenes?s=${planned.id}` }
  const draft = b.chapters.find((c) => c.status === 'draft')
  if (draft) return { text: `Finish the draft of "${draft.title}" (${wordCount(draft.body)} words)`, to: `/write?c=${draft.id}` }
  const revised = b.chapters.find((c) => c.status === 'revised')
  if (revised) return { text: `Take "${revised.title}" from revised to done`, to: `/write?c=${revised.id}` }
  return { text: 'Everything is done. Add the next chapter?', to: '/write' }
}
