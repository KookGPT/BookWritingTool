import { Link } from 'react-router-dom'
import { nextStep } from './next'
import { mentionsEntry, plain, streakOf, today, useBook, words } from './store'
import { PageHead } from './ui'

const dayKey = (back: number) => {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return d.toLocaleDateString('en-CA')
}

export default function Insights() {
  const { book, update } = useBook()
  const { goal, days } = book.stats
  const done = days[today()] ?? 0
  const streak = streakOf(book.stats)
  const last = Array.from({ length: 14 }, (_, i) => dayKey(13 - i))
  const max = Math.max(goal, ...last.map((d) => days[d] ?? 0), 1)
  const chars = book.wiki.filter((w) => w.type === 'character')
  const total = book.chapters.reduce((n, c) => n + words(c.body), 0)
  const week = last.slice(7).reduce((n, d) => n + (days[d] ?? 0), 0)
  const next = nextStep(book)
  const pct = `${Math.min(100, (done / Math.max(goal, 1)) * 100)}%`
  const summary = done >= goal && goal > 0
    ? `You hit your goal today: ${done} words${streak > 1 ? `, ${streak} days running` : ''}.`
    : done > 0 ? `${done} words today, ${Math.max(0, goal - done)} to go.` : streak ? `A ${streak}-day streak is waiting. Write a few words to keep it.` : 'No words yet today.'

  return (
    <div className="page wide">
      <PageHead title="Insights" hint={summary} />
      <div className="cards">
        <div className="card"><small className="muted">TODAY</small><span className="stat">{done}<small className="muted"> / {goal}</small></span><div className="bar"><div style={{ width: pct }} /></div></div>
        <div className="card"><small className="muted">STREAK</small><span className="stat">{streak}<small className="muted"> days</small></span></div>
        <div className="card"><small className="muted">LAST 7 DAYS</small><span className="stat">{week.toLocaleString()}<small className="muted"> words</small></span></div>
        <div className="card"><small className="muted">THE BOOK</small><span className="stat">{total.toLocaleString()}<small className="muted"> words</small></span><small className="muted">{book.chapters.filter((c) => c.status === 'done').length} of {book.chapters.length} chapters done</small></div>
      </div>
      <div className="card"><small className="muted">WHAT TO WORK ON NEXT</small><Link to={next.to} className="next-link">{next.text} ›</Link></div>

      <h2>Writing goal</h2>
      <div className="row" style={{ alignItems: 'center' }}>
        <label>Daily words
          <input type="number" min={0} value={goal} onChange={(e) => update((b) => ({ ...b, stats: { ...b.stats, goal: +e.target.value } }))} />
        </label>
        <div className="grow">
          <div className="bar"><div style={{ width: pct }} /></div>
          <small className="muted">{done} / {goal} words today</small>
        </div>
      </div>
      <div className="spark">
        {last.map((d) => (
          <div key={d} title={`${d}: ${days[d] ?? 0}`} className={(days[d] ?? 0) >= goal ? 'hit' : ''} style={{ height: `${((days[d] ?? 0) / max) * 100}%` }} />
        ))}
      </div>
      <small className="muted">Last 14 days. Counts net words typed in the editor.</small>

      <h2>Character appearances</h2>
      {chars.length && book.chapters.length ? (
        <div className="lanes wrap-heads" style={{ gridTemplateColumns: `130px repeat(${book.chapters.length}, minmax(96px, 1fr))` }}>
          <span />
          {book.chapters.map((c, n) => <span key={c.id} className="head muted" title={c.title}>{n + 1}. {c.title}</span>)}
          {chars.flatMap((w) => [
            <b key={w.id}>{w.name}</b>,
            ...book.chapters.map((c) => <div key={w.id + c.id} className={`cell ${mentionsEntry(plain(c.body), w) ? 'on' : ''}`} title={`${w.name} in ${c.title}`} />),
          ])}
        </div>
      ) : <p className="muted">Add characters in the Wiki and chapters in Write; a character lights up in each chapter that names them.</p>}
    </div>
  )
}
