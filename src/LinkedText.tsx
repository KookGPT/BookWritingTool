import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { namesOf, type WikiEntry } from './store'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Split text into plain pieces and links to any other wiki entry whose name or alias appears in it (whole words, any case).
export function linkify(text: string, wiki: WikiEntry[], selfId?: string) {
  const byName = new Map<string, string>()
  for (const w of wiki) if (w.id !== selfId) for (const n of namesOf(w)) if (n.trim().length > 1 && !byName.has(n.trim().toLowerCase())) byName.set(n.trim().toLowerCase(), w.id)
  if (!byName.size) return [text]
  const names = [...byName.keys()].sort((a, b) => b.length - a.length) // longest first so "Captain Aldric" beats "Aldric"
  const re = new RegExp(`(?<![\\w])(${names.map(esc).join('|')})(?![\\w])`, 'gi')
  const out: (string | { id: string; text: string })[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ id: byName.get(m[0].toLowerCase())!, text: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export const hasLinks = (text: string, wiki: WikiEntry[], selfId?: string) => linkify(text, wiki, selfId).some((p) => typeof p !== 'string')

export default function LinkedText({ text, wiki, selfId }: { text: string; wiki: WikiEntry[]; selfId?: string }) {
  return (
    <>
      {linkify(text, wiki, selfId).map((p, i) => (
        <Fragment key={i}>{typeof p === 'string' ? p : <Link to={`/wiki/${p.id}`} className="wikilink" onClick={(e) => e.stopPropagation()}>{p.text}</Link>}</Fragment>
      ))}
    </>
  )
}
