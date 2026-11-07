import { Link } from 'react-router-dom'
import { type Calendar, fmt, ordinal, span, yearLen } from './calendar'
import { calendarOf, useBook } from './store'
import { PageHead } from './ui'

export default function CalendarPage() {
  const { book, update } = useBook()
  const cal = calendarOf(book)
  const set = (c: Calendar) => update((b) => ({ ...b, config: { ...b.config, calendar: c } }))
  const setMonth = (i: number, p: Partial<Calendar['months'][number]>) =>
    set({ ...cal, months: cal.months.map((m, j) => (j === i ? { ...m, ...p } : m)) })

  const dated = book.scenes.filter((s) => s.date).sort((a, b) => ordinal(cal, a.date!) - ordinal(cal, b.date!))
  const undated = book.scenes.length - dated.length

  return (
    <div className="page wide">
      <PageHead title="Story calendar" hint={`Define how time works in your world, then give scenes dates in Scenes. A year here is ${yearLen(cal)} days.`} />
      <label>Era label (shown after the year, e.g. "AE" or "of the Third Age")
        <input value={cal.era} onChange={(e) => set({ ...cal, era: e.target.value })} />
      </label>
      {cal.months.map((m, i) => (
        <div key={i} className="row" style={{ alignItems: 'center' }}>
          <input className="grow" value={m.name} onChange={(e) => setMonth(i, { name: e.target.value })} />
          <input type="number" min={1} style={{ width: '5rem' }} value={m.days} onChange={(e) => setMonth(i, { days: Math.max(1, +e.target.value || 1) })} />
          <span className="muted">days</span>
          <button className="alt" disabled={cal.months.length < 2} onClick={() => set({ ...cal, months: cal.months.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      <button className="alt" style={{ alignSelf: 'flex-start' }} onClick={() => set({ ...cal, months: [...cal.months, { name: `Month ${cal.months.length + 1}`, days: 30 }] })}>+ Month</button>

      <h2>Scenes in story order</h2>
      {dated.map((s, i) => (
        <div key={s.id} className="item">
          <span><b>{fmt(cal, s.date!)}</b> · {s.title}{s.when && <small className="muted"> ({s.when})</small>}</span>
          {i > 0 && <small className="muted">{span(cal, dated[i - 1].date!, s.date!)} than the scene above</small>}
        </div>
      ))}
      {!dated.length && <p className="muted">No dated scenes yet. Open a scene in the <Link to="/scenes">Scenes</Link> and set its date.</p>}
      {undated > 0 && <p className="muted">{undated} scene{undated > 1 ? 's' : ''} without a date.</p>}
      {dated.length > 1 && (
        <button className="alt" style={{ alignSelf: 'flex-start' }} onClick={() => {
          // Dated scenes take the order above, in the slots dated scenes already occupy; undated scenes stay put.
          update((b) => {
            const sorted = [...dated]
            return { ...b, scenes: b.scenes.map((s) => (s.date ? sorted.shift()! : s)) }
          })
        }}>Use this order in Scenes</button>
      )}
    </div>
  )
}
