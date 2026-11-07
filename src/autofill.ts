// Pure: the faint completion after the cursor. Only wiki names and aliases, never ordinary words.
import type { Book } from './store.ts'
import { namesOf } from './text.ts'

const MIN = 3 // typed characters before anything shows
const WORD = /[\p{L}\p{N}]/u
// Sentence starters that share letters with made-up names ("The" -> "Theron"): a faint name after every one would nag.
const COMMON = new Set(('the they them then there these this that those their she her hers his him and but for nor not was were '
  + 'when what where who why how with from have had has will would could should can did does you your all one two now still even '
  + 'just only into over under after before while once some many much more most every each both').split(' '))

/** What to add after `before` (the text up to the cursor) to finish a name, or ''. Case must match; the longest typed match wins, then list order. */
export function complete(before: string, names: string[]): string {
  let best = '', typed = 0
  for (const name of names) {
    for (let n = Math.min(name.length - 1, before.length); n >= MIN && n > typed; n--) {
      const bit = before.slice(-n)
      if (!name.startsWith(bit) || WORD.test(before.at(-n - 1) ?? '')) continue
      if (!bit.includes(' ') && COMMON.has(bit.toLowerCase())) continue
      best = name.slice(n); typed = n
      break
    }
  }
  return best
}

/** The names to offer, with the people and places of the current scene first so they win ties. */
export function autofillNames(b: Pick<Book, 'wiki'>, first: string[] = []): string[] {
  const rank = (id: string) => { const i = first.indexOf(id); return i < 0 ? first.length : i }
  return [...b.wiki].sort((x, y) => rank(x.id) - rank(y.id)).flatMap(namesOf)
}
