import { mentions, plain, today, useBook } from './store'

const dayKey = (back: number) => {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return d.toLocaleDateString('en-CA')
}

export default function Insights() {
  const { book, update } = useBook()
  const { goal, days } = book.stats
  const done = days[today()] ?? 0
  // Streak = consecutive days meeting the goal; today doesn't break it until the day is over.
  let streak = 0
  for (let i = days[today()] >= goal ? 0 : 1; (days[dayKey(i)] ?? 0) >= goal && goal > 0; i++) streak++
  const last = Array.from({ length: 14 }, (_, i) => dayKey(13 - i))
  const max = Math.max(goal, ...last.map((d) => days[d] ?? 0), 1)
  const chars = book.wiki.filter((w) => w.type === 'character')

  return (
    <div className="page wider">
      <h1>Insights</h1>
      <h2>Writing goal</h2>
      <div className="row" style={{ alignItems: 'center' }}>
        <label>Daily words
          <input type="number" min={0} value={goal} onChange={(e) => update((b) => ({ ...b, stats: { ...b.stats, goal: +e.target.value } }))} />
        </label>
        <div className="grow">
          <div className="bar"><div style={{ width: `${Math.min(100, (done / Math.max(goal, 1)) * 100)}%` }} /></div>
          <small className="muted">{done} / {goal} words today · {streak}-day streak</small>
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
        <div className="lanes" style={{ gridTemplateColumns: `120px repeat(${book.chapters.length}, 90px)` }}>
          <span />
          {book.chapters.map((c, n) => <span key={c.id} className="head muted" title={c.title}>{n + 1}. {c.title}</span>)}
          {chars.flatMap((w) => [
            <b key={w.id}>{w.name}</b>,
            ...book.chapters.map((c) => <div key={w.id + c.id} className={`cell ${mentions(plain(c.body), w.name) ? 'on' : ''}`} />),
          ])}
        </div>
      ) : <p className="muted">Add characters in the Wiki and chapters in Write; a character lights up in each chapter that names them.</p>}
    </div>
  )
}
