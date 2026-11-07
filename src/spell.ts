// Pure: a spell checker that only speaks up about common words. A word is flagged when it is not a word at all
// AND close to a common word: one slip away (swapped, missing, extra or wrong letter), or two for words of 5+ letters.
// `auto` is set when one slip with a clear winner fixes it, so the editor can correct it as you type. Invented names are never near enough.
const ABC = 'abcdefghijklmnopqrstuvwxyz'
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu
/** Common words and how common: 0 is the most common tier, higher is rarer. */
export type Common = Map<string, number>

export interface Fix { list: string[]; auto?: string }

/** Optimal string alignment distance (a swap counts as one), stopping early past `max`. */
function dist(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let p2: number[] = [], p1 = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let lo = i
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, p2[j - 2] + 1)
      cur.push(d); lo = Math.min(lo, d)
    }
    if (lo > max) return max + 1
    p2 = p1; p1 = cur
  }
  return p1[b.length]
}

const cache = new WeakMap<Common, Map<string, Fix>>()

/** Common words near `w`, best first: the simple slips (most common word first), then a wrong letter, then two slips. */
export function fixes(w: string, common: Common): Fix {
  let mine = cache.get(common)
  if (!mine) cache.set(common, mine = new Map())
  const hit = mine.get(w)
  if (hit) return hit
  const lvl = (x: string) => common.get(x) ?? 9
  const simple = new Set<string>(), wrong = new Set<string>()
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i)
    if (b.length > 1) simple.add(a + b[1] + b[0] + b.slice(2)) // swapped
    if (b) simple.add(a + b.slice(1)) // extra letter
    for (const c of ABC) { simple.add(a + c + b); if (b) wrong.add(a + c + b.slice(1)) } // missing letter, wrong letter
  }
  const pick = (s: Set<string>) => [...s].filter((x) => x !== w && common.has(x)).sort((x, y) => lvl(x) - lvl(y))
  const one = pick(simple)
  const list = [...new Set([...one, ...pick(wrong)])]
  if (!list.length && w.length >= 5) { // badly mangled: look through the common words
    const near: [string, number][] = []
    for (const [x, l] of common) { const d = dist(w, x, 2); if (d === 2) near.push([x, l]) }
    list.push(...near.sort((x, y) => x[1] - y[1]).map(([x]) => x))
  }
  const auto = one.length && (one.length === 1 || lvl(one[0]) < lvl(one[1])) ? one[0] : undefined
  const out = { list: list.slice(0, 4), auto }
  mine.set(w, out)
  return out
}

export interface Miss { from: number; to: number; word: string; fix: string[]; auto?: string }

/** Misspelled common words in `text`. `skip` holds lowercase words never to flag (wiki names). Capitalised words are names. */
export function check(text: string, known: Set<string>, common: Common, skip: Set<string>): Miss[] {
  const out: Miss[] = []
  for (const m of text.matchAll(WORD)) {
    const word = m[0], low = word.toLowerCase()
    if (word.length < 3 || /['’]/.test(word) || word[0] !== low[0] || known.has(low) || skip.has(low)) continue
    const { list, auto } = fixes(low, common)
    if (list.length) out.push({ from: m.index, to: m.index + word.length, word, fix: list, auto })
  }
  return out
}
