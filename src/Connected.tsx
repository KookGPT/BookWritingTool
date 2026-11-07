import { useDeferredValue } from 'react'
import { Link } from 'react-router-dom'
import { connected, type Kind, linkScene, type Ref } from './connect'
import { useBook } from './store'

const GROUPS: [Kind, string][] = [['scene', 'Scenes'], ['chapter', 'Chapters'], ['event', 'Timeline'], ['plan', 'Planning cards'], ['wiki', 'Wiki'], ['place', 'Map'], ['idea', 'Ideas']]

// What an item connects to, on every page that shows one. Worked out from the book; the only thing set by hand is a scene tied to a timeline event.
export default function Connected({ of, none }: { of: Ref; none?: string }) {
  const book = useDeferredValue(useBook((s) => s.book)) // the graph is rebuilt per edit: let typing go first
  const update = useBook((s) => s.update)
  const hits = connected(book, of)
  const taken = new Set(hits.filter((h) => h.manual).map((h) => h.id))
  const unlink = (id: string) => update((b) => (of.kind === 'scene' ? linkScene(b, of.id, id, false) : linkScene(b, id, of.id, false)))
  const pick = (id: string) => update((b) => (of.kind === 'scene' ? linkScene(b, of.id, id, true) : linkScene(b, id, of.id, true)))
  const options = of.kind === 'scene' ? book.events.filter((e) => !taken.has(e.id)).map((e) => ({ id: e.id, title: e.title }))
    : of.kind === 'event' ? book.scenes.filter((s) => !taken.has(s.id)).map((s) => ({ id: s.id, title: s.title })) : []
  return (
    <div className="conn">
      {GROUPS.map(([kind, label]) => {
        const group = hits.filter((h) => h.kind === kind)
        return group.length > 0 && (
          <div key={kind}>
            <small className="muted">{label.toUpperCase()}</small>
            <div className="conn-list">
              {group.map((h) => (
                <span key={h.id} className="conn-hit">
                  <Link className="chip" to={h.to} title={`${h.title}: ${h.why}`}>{h.title}<small>{h.why}</small></Link>
                  {h.manual && <button className="ghost icon" aria-label={`Remove link to ${h.title}`} title="Remove this link" onClick={() => unlink(h.id)}>×</button>}
                </span>
              ))}
            </div>
          </div>
        )
      })}
      {!hits.length && <p className="muted">{none ?? 'Nothing connected yet. Connections appear on their own as names, dates and places line up.'}</p>}
      {options.length > 0 && (
        <select aria-label={of.kind === 'scene' ? 'Link a timeline event' : 'Link a scene'} value="" onChange={(e) => e.target.value && pick(e.target.value)}>
          <option value="">{of.kind === 'scene' ? 'Link a timeline event...' : 'Link a scene...'}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
      )}
    </div>
  )
}
