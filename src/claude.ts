// Pure: the "For Claude" bundle. One click copies this to paste into Claude; nothing in the app talks to an AI.
import { commentsIn } from './comments.ts'
import { chapterNeighbours, connected, type Near, type Ref, sceneNeighbours } from './connect.ts'
import type { Book, WikiEntry } from './store.ts'
import { toText } from './text.ts'

const ASK = `You are my continuity editor. I wrote the text below myself and it stays mine.

1. Check continuity: anything in THE TEXT that contradicts the surrounding story or the world notes (names, ages, descriptions, places, dates, travel time, who knows what, who is where). Quote the line and say what it clashes with.
2. Give feedback: what works, what drags or confuses, where tension or voice slips. Be specific and quote the line.
3. Answer MY NOTES if there are any.

Do not rewrite anything and do not write new prose, not even examples. Tell me what to look at and why, and I will do the writing.`

const entry = (w: WikiEntry) => {
  const facts = Object.entries(w.fields).filter(([, v]) => v.trim()).map(([k, v]) => `  ${k}: ${v}`)
  return [`- ${w.name} (${w.type})${w.aliases?.length ? `, also called ${w.aliases.join(', ')}` : ''}`, ...facts, ...(w.notes.trim() ? [`  Notes: ${w.notes.trim()}`] : [])].join('\n')
}
const near = (n: Near, full: boolean) => `### ${n.title}\n${full && n.text ? n.text : n.gist || '(nothing written yet)'}`

/** A scene or chapter with the story on either side, the world notes it touches and my comments. The closest neighbours go in full. */
export function claudeBrief(b: Book, r: Ref): string {
  const scene = r.kind === 'scene' ? b.scenes.find((s) => s.id === r.id) : undefined
  const chapter = r.kind === 'chapter' ? b.chapters.find((c) => c.id === r.id) : undefined
  const body = scene?.body ?? chapter?.body ?? ''
  const { before, after } = scene ? sceneNeighbours(b, r.id) : chapterNeighbours(b, r.id)
  const name = (id?: string) => b.wiki.find((w) => w.id === id)?.name
  const hits = connected(b, r)
  const wiki = hits.flatMap((h) => (h.kind === 'wiki' ? b.wiki.filter((w) => w.id === h.id) : []))
  const events = hits.flatMap((h) => (h.kind === 'event' ? b.events.filter((e) => e.id === h.id) : []))
  const notes = commentsIn(body)
  const facts = scene ? [scene.pov && `POV: ${name(scene.pov)}`, scene.location && `Location: ${name(scene.location)}`, scene.when && `When: ${scene.when}`, scene.goal && `Planned goal: ${scene.goal}`, scene.outcome && `Planned outcome: ${scene.outcome}`, scene.notes?.trim() && `My draft notes: ${scene.notes.trim()}`].filter(Boolean) : []
  const block = (title: string, parts: (string | false | undefined)[]) => { const p = parts.filter(Boolean); return p.length ? [`## ${title}\n\n${p.join('\n\n')}`] : [] }
  return [
    ASK,
    `## The book\n\n${b.title}`,
    ...block('Before this', before.map((n, i) => near(n, i === before.length - 1))),
    ...block(`THE TEXT: ${scene?.title ?? chapter?.title ?? ''}`, [facts.length > 0 && facts.join('\n'), toText(body) || '(nothing written yet)']),
    ...block('After this (planned or written)', after.map((n, i) => near(n, i === 0))),
    ...block('MY NOTES on the text', notes.map((n) => `On "${n.quote}": ${n.note || '(no note)'}`)),
    ...block('World notes for who and what appears here', wiki.map(entry)),
    ...block('Timeline events tied to this', events.map((e) => `- ${e.title}${e.summary ? `: ${e.summary}` : ''}`)),
  ].join('\n\n')
}
