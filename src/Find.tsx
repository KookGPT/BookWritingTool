import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { snapshot } from './history'
import { findAll, type Match, type Query, replaceAll, undoReplace } from './replace'
import { type Book, useBook } from './store'

const SHOWN = 300 // matches listed; the replace itself covers all of them
const hrefOf = (m: Match) => (m.prose ? `${m.to}&find=${encodeURIComponent(m.hit)}&n=${m.nth}` : m.to)

// Find across the whole book, in the Search page and in the writing room's side panel. Replace shows every match first.
export function FindPanel({ start = '', replacing: open = false, inputId }: { start?: string; replacing?: boolean; inputId?: string }) {
  const { book, update } = useBook()
  const [raw, setRaw] = useState(start)
  const [by, setBy] = useState('')
  const [replacing, setReplacing] = useState(open)
  const [matchCase, setCase] = useState(false)
  const [wholeWord, setWhole] = useState(false)
  const [keepAlias, setKeep] = useState(false)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [done, setDone] = useState<{ n: number; text: string; before: Book; after: Book } | null>(null)
  const find = useDeferredValue(raw)
  const q: Query = useMemo(() => ({ find, matchCase, wholeWord }), [find, matchCase, wholeWord])
  const found = useMemo(() => findAll(book, q), [book, q])
  useEffect(() => setSkip(new Set()), [q])
  const groups = useMemo(() => {
    const out = new Map<string, Match[]>()
    for (const m of found.slice(0, SHOWN)) {
      const k = `${m.kind}:${m.id}`
      out.set(k, [...(out.get(k) ?? []), m])
    }
    return [...out.values()]
  }, [found])
  const toggle = (key: string) => setSkip((s) => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n })
  const live = found.filter((m) => !skip.has(m.key)).length
  const renames = found.some((m) => m.kind === 'wiki' && m.field === 'Name')

  const run = () => {
    const after = replaceAll(book, q, by, { skip, keepAlias: keepAlias && renames })
    for (const s of book.scenes) { const a = after.scenes.find((x) => x.id === s.id); if (s.body && a?.body !== s.body) snapshot(s.id, s.body, 'Before replace') }
    for (const c of book.chapters) { const a = after.chapters.find((x) => x.id === c.id); if (c.body && a?.body !== c.body) snapshot(c.id, c.body, 'Before replace') }
    update(() => after)
    setDone({ n: live, text: `"${find}" with "${by}"`, before: book, after })
  }

  return (
    <div className="find">
      <input id={inputId} autoFocus aria-label="Find" value={raw} placeholder="Find in the whole book..." onChange={(e) => { setRaw(e.target.value); setDone(null) }} />
      {replacing && <input aria-label="Replace with" value={by} placeholder="Replace with..." onChange={(e) => setBy(e.target.value)} />}
      <div className="find-opts">
        <label className="check"><input type="checkbox" checked={matchCase} onChange={(e) => setCase(e.target.checked)} /> Match case</label>
        <label className="check"><input type="checkbox" checked={wholeWord} onChange={(e) => setWhole(e.target.checked)} /> Whole word</label>
        <label className="check"><input type="checkbox" checked={replacing} onChange={(e) => setReplacing(e.target.checked)} /> Replace</label>
      </div>
      {replacing && renames && <label className="check"><input type="checkbox" checked={keepAlias} onChange={(e) => setKeep(e.target.checked)} /> A wiki name changes: keep the old name as an alias</label>}
      {done && (
        <div className="find-done">
          <span className="grow">Replaced {done.n} × {done.text}.</span>
          <button className="alt" onClick={() => { update((b) => undoReplace(b, done.before, done.after)); setDone(null) }}>Undo</button>
        </div>
      )}
      {find && !done && (
        <div className="find-sum">
          <small className="muted">{found.length} match{found.length === 1 ? '' : 'es'}{found.length > SHOWN ? `, first ${SHOWN} shown` : ''}</small>
          {replacing && <button disabled={!live} onClick={run}>Replace {live}</button>}
        </div>
      )}
      {groups.map((g) => (
        <div key={g[0].key} className="find-group">
          <small className="muted">{g[0].kind.toUpperCase()}</small> <b>{g[0].title}</b>
          {g.map((m) => (
            <div key={m.key} className={`find-hit ${skip.has(m.key) ? 'off' : ''}`}>
              {replacing && <input type="checkbox" aria-label="Replace this one" checked={!skip.has(m.key)} onChange={() => toggle(m.key)} />}
              <Link to={hrefOf(m)} title={`Open: ${m.field}`}>
                <small className="muted">{m.field}: </small>{m.before}<mark>{m.hit}</mark>{m.after}
              </Link>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
