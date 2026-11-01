import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Calendar } from './calendar'
import { trashIt } from './history'
import Icon from './Icon'
import { calendarOf, type Period, type TDate, type TEvent, uid, useBook } from './store'
import { lanes, layout } from './timelineScale'

const U = 210 // px per unit (one card width plus breathing room)
const COLORS = ['#7cc4a0', '#e2a94d', '#7aa7d9', '#b69cf0', '#e5796a', '#9aa7a0']

const fmtDate = (c: Calendar, t: TDate) => {
  const m = t.m ? c.months[t.m - 1]?.name : undefined
  return [[t.d, m].filter(Boolean).join(' '), `${t.y}${c.era ? ` ${c.era}` : ''}`].filter(Boolean).join(', ')
}

function DateInput({ label, value, cal, onChange }: { label: string; value: TDate; cal: Calendar; onChange: (d: TDate) => void }) {
  return (
    <div className="row" style={{ alignItems: 'end' }}>
      <label>{label ? `${label} year` : 'Year'}
        <input type="number" style={{ width: '6rem' }} value={value.y} onChange={(e) => onChange({ ...value, y: +e.target.value })} />
      </label>
      <label>Month
        <select value={value.m ?? ''} onChange={(e) => onChange({ y: value.y, m: e.target.value ? +e.target.value : undefined, d: e.target.value ? value.d : undefined })}>
          <option value="">-</option>
          {cal.months.map((m, i) => <option key={i} value={i + 1}>{m.name}</option>)}
        </select>
      </label>
      {value.m && (
        <label>Day
          <input type="number" min={1} max={cal.months[value.m - 1]?.days} style={{ width: '4.5rem' }} value={value.d ?? ''} placeholder="-"
            onChange={(e) => onChange({ ...value, d: e.target.value ? +e.target.value : undefined })} />
        </label>
      )}
    </div>
  )
}

function EventForm({ ev, cal, onClose }: { ev: TEvent; cal: Calendar; onClose: () => void }) {
  const { book, update } = useBook()
  const patch = (p: Partial<TEvent>) => update((b) => ({ ...b, events: b.events.map((e) => (e.id === ev.id ? { ...e, ...p } : e)) }))
  const remove = () => {
    if (!confirm('Delete this event? (It goes to Trash.)')) return
    trashIt('events', ev.title, ev)
    update((b) => ({ ...b, events: b.events.filter((e) => e.id !== ev.id) }))
    onClose()
  }
  return (
    <div className="panel">
      <div className="row">
        <input className="grow title" aria-label="Event title" value={ev.title} onChange={(e) => patch({ title: e.target.value })} />
        <select aria-label="Which side" value={ev.kind} onChange={(e) => patch({ kind: e.target.value as TEvent['kind'] })}>
          <option value="party">Party (top)</option>
          <option value="world">World (bottom)</option>
        </select>
        <button className="ghost icon" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <DateInput label="" value={ev.date} cal={cal} onChange={(date) => patch({ date })} />
      <label>Location
        <select value={ev.locationId ?? ''} onChange={(e) => patch({ locationId: e.target.value || undefined })}>
          <option value="">Not in the wiki</option>
          {book.wiki.filter((w) => w.type === 'location').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>
      {!ev.locationId && <input aria-label="Place name" placeholder="Place name" value={ev.location} onChange={(e) => patch({ location: e.target.value })} />}
      <fieldset className="who">
        <legend>Characters involved</legend>
        {book.wiki.filter((w) => w.type === 'character').map((w) => (
          <label key={w.id} className="check">
            <input type="checkbox" checked={!!ev.characters?.includes(w.id)}
              onChange={(e) => patch({ characters: e.target.checked ? [...(ev.characters ?? []), w.id] : (ev.characters ?? []).filter((x) => x !== w.id) })} />
            {w.name}
          </label>
        ))}
        {!book.wiki.some((w) => w.type === 'character') && <small className="muted">Add characters in the Wiki to tag them here.</small>}
      </fieldset>
      <label>What happens<textarea rows={3} value={ev.summary} onChange={(e) => patch({ summary: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={!!ev.estimated} onChange={(e) => patch({ estimated: e.target.checked })} /> Estimated date (shown as "c.")</label>
      <div className="row" style={{ alignItems: 'end' }}>
        <label className="grow">Related wiki page
          <select value={ev.wikiId ?? ''} onChange={(e) => patch({ wikiId: e.target.value || undefined })}>
            <option value="">None</option>
            {book.wiki.map((w) => <option key={w.id} value={w.id}>{w.type}: {w.name}</option>)}
          </select>
        </label>
        {ev.wikiId && <Link className="chip" to={`/wiki/${ev.wikiId}`}>Wiki ›</Link>}
        <button className="danger" onClick={remove}>Delete</button>
      </div>
    </div>
  )
}

function PeriodForm({ per, cal, onClose }: { per: Period; cal: Calendar; onClose: () => void }) {
  const { book, update } = useBook()
  const patch = (p: Partial<Period>) => update((b) => ({ ...b, periods: b.periods.map((x) => (x.id === per.id ? { ...x, ...p } : x)) }))
  const remove = () => {
    if (!confirm('Delete this period? (It goes to Trash.)')) return
    trashIt('periods', per.title, per)
    update((b) => ({ ...b, periods: b.periods.filter((x) => x.id !== per.id) }))
    onClose()
  }
  const tie = (label: string, key: 'startEvent' | 'endEvent') => (
    <label className="grow">{label}
      <select value={per[key] ?? ''} onChange={(e) => patch({ [key]: e.target.value || undefined })}>
        <option value="">Use the date</option>
        {book.events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
      </select>
    </label>
  )
  return (
    <div className="panel">
      <div className="row">
        <input className="grow title" aria-label="Period title" value={per.title} onChange={(e) => patch({ title: e.target.value })} />
        <button className="ghost icon" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="row" role="radiogroup" aria-label="Color">
        {COLORS.map((c) => (
          <button key={c} role="radio" aria-checked={per.color === c} aria-label={c} className="swatch" style={{ background: c, outline: per.color === c ? '2px solid var(--fg)' : 'none' }} onClick={() => patch({ color: c })} />
        ))}
      </div>
      <DateInput label="Start" value={per.start} cal={cal} onChange={(start) => patch({ start })} />
      <DateInput label="End" value={per.end} cal={cal} onChange={(end) => patch({ end })} />
      <div className="row">{tie('Start at event', 'startEvent')}{tie('End at event', 'endEvent')}</div>
      <label>Notes<textarea rows={3} value={per.summary ?? ''} onChange={(e) => patch({ summary: e.target.value })} /></label>
      <button className="danger" onClick={remove}>Delete period</button>
    </div>
  )
}

export default function TimelinePage() {
  const { book, update } = useBook()
  const cal = calendarOf(book)
  const [params] = useSearchParams()
  const [sel, setSel] = useState<{ kind: 'event' | 'period'; id: string } | null>(() => (params.get('e') ? { kind: 'event', id: params.get('e')! } : null))
  const [q, setQ] = useState('')
  const [show, setShow] = useState({ party: true, world: true, periods: true })
  const scroller = useRef<HTMLDivElement>(null)

  const wname = (id?: string) => book.wiki.find((w) => w.id === id)?.name ?? ''
  const place = (e: TEvent) => wname(e.locationId) || e.location
  const needle = q.trim().toLowerCase()
  const hit = (...t: (string | undefined)[]) => !needle || t.join(' ').toLowerCase().includes(needle)
  const events = useMemo(() => book.events.filter((e) => show[e.kind] && hit(e.title, e.summary, place(e), wname(e.wikiId), ...(e.characters ?? []).map(wname))), [book.events, book.wiki, show, needle]) // eslint-disable-line react-hooks/exhaustive-deps
  const periods = useMemo(() => (show.periods ? book.periods.filter((p) => hit(p.title, p.summary)) : []), [book.periods, show.periods, needle]) // eslint-disable-line react-hooks/exhaustive-deps
  const { coord, max } = useMemo(() => layout(cal, events, periods), [cal, events, periods])
  const { lane, count } = useMemo(() => lanes(coord, periods), [coord, periods])
  const x = (c: number) => (c + 1) * U
  const band = 26 + Math.max(1, count) * 28

  const years = useMemo(() => {
    const m = new Map<number, number>() // year -> leftmost coord
    const add = (t: TDate, c: number | undefined) => { const o = m.get(t.y); if (c !== undefined && (o === undefined || c < o)) m.set(t.y, c) }
    for (const e of events) add(e.date, coord[e.id])
    for (const p of periods) { add(p.start, coord[`${p.id}:start`]); add(p.end, coord[`${p.id}:end`]) }
    let edge = -Infinity // drop labels that would touch the previous one
    return [...m].sort((a, b) => a[1] - b[1]).filter(([, c]) => (c - edge) * U >= 80 && ((edge = c), true))
  }, [events, periods, coord])

  const center = (c: number, smooth = true) => {
    const el = scroller.current
    if (el) el.scrollTo({ left: x(c) - el.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' })
  }
  const select = (kind: 'event' | 'period', id: string) => {
    setSel({ kind, id })
    center(kind === 'event' ? coord[id] : (coord[`${id}:start`] + coord[`${id}:end`]) / 2)
  }
  useEffect(() => {
    const start = params.get('e') ?? events.filter((e) => e.kind === 'party').sort((a, b) => coord[a.id] - coord[b.id])[0]?.id
    if (start && coord[start] !== undefined) center(coord[start], false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    const mid = (el.scrollLeft + el.clientWidth / 2) / U - 1
    const ids = events.map((e) => e.id).sort((a, b) => coord[a] - coord[b])
    const next = dir > 0 ? ids.find((i) => coord[i] > mid + 0.05) : [...ids].reverse().find((i) => coord[i] < mid - 0.05)
    if (next) select('event', next)
  }

  // Mouse wheel scrolls sideways; dragging empty space pans. Needs a non-passive listener to cancel vertical scroll.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const wheel = (e: WheelEvent) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); el.scrollLeft += e.deltaY } }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const down = (e: React.PointerEvent) => { drag.current = { x: e.clientX, left: scroller.current!.scrollLeft, moved: false } }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.x) > 4) d.moved = true
    if (d.moved) scroller.current!.scrollLeft = d.left - (e.clientX - d.x)
  }
  const click = (e: React.MouseEvent) => { if (drag.current?.moved) e.stopPropagation(); drag.current = null }

  const last = [...book.events].sort((a, b) => b.date.y - a.date.y)[0]?.date ?? { y: 1 }
  const addEvent = (kind: TEvent['kind']) => {
    const e: TEvent = { id: uid(), kind, title: kind === 'party' ? 'New party event' : 'New world event', date: { ...last }, location: '', summary: '' }
    update((b) => ({ ...b, events: [...b.events, e] }))
    setSel({ kind: 'event', id: e.id })
  }
  const addPeriod = () => {
    const p: Period = { id: uid(), title: 'New period', color: COLORS[book.periods.length % COLORS.length], start: { ...last }, end: { y: last.y + 1 } }
    update((b) => ({ ...b, periods: [...b.periods, p] }))
    setSel({ kind: 'period', id: p.id })
  }

  const ev = sel?.kind === 'event' ? book.events.find((e) => e.id === sel.id) : undefined
  const per = sel?.kind === 'period' ? book.periods.find((p) => p.id === sel.id) : undefined
  const toggle = (k: keyof typeof show, label: string) => (
    <label className="check"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{label}</label>
  )
  const card = (e: TEvent) => (
    <div
      key={e.id}
      className={`tl-card ${e.kind} ${e.estimated ? 'est' : ''} ${sel?.id === e.id ? 'sel' : ''}`}
      style={{ left: x(coord[e.id]) }}
    >
      <button className="tl-body" onClick={() => select('event', e.id)}>
        <small className="muted">{e.estimated ? 'c. ' : ''}{fmtDate(cal, e.date)}{e.estimated ? ' · estimate' : ''}</small>
        <b>{e.title}</b>
        {place(e) && <small className="muted">{place(e)}</small>}
        {e.summary && <span className="tl-sum">{e.summary}</span>}
      </button>
      <span className="tl-stem" />
    </div>
  )

  return (
    <div className="page wider tl">
      <div className="row" style={{ alignItems: 'center' }}>
        <h1 className="grow">Timeline</h1>
        <input className="tl-search" type="search" aria-label="Search timeline" placeholder="Search events..." value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { const f = [...events].sort((a, b) => coord[a.id] - coord[b.id])[0]; if (f) select('event', f.id) } }} />
        {toggle('party', 'Party')}{toggle('world', 'World')}{toggle('periods', 'Periods')}
        <button className="alt icon" aria-label="Previous event" onClick={() => step(-1)}><Icon name="left" /></button>
        <button className="alt icon" aria-label="Next event" onClick={() => step(1)}><Icon name="right" /></button>
        <button onClick={() => addEvent('party')}><Icon name="plus" size={16} /> Party event</button>
        <button onClick={() => addEvent('world')}><Icon name="plus" size={16} /> World event</button>
        <button className="alt" onClick={addPeriod}><Icon name="plus" size={16} /> Period</button>
      </div>
      <p className="muted">Top: where the party is and what they do. Bottom: what the world is doing out of their sight. Bars on the rail are periods. Scroll, drag or use the arrows.</p>
      {needle && !events.length && !periods.length && <p className="muted">No events or periods match "{q}".</p>}
      {!book.events.length && !book.periods.length && (
        <div className="empty"><Icon name="timeline" size={32} /><p>Nothing on the timeline yet. Add where the party goes, or what the world is up to.</p></div>
      )}
      {(ev || per) && (
        <aside className="drawer right tl-drawer" aria-label="Edit">
          {ev && <EventForm key={ev.id} ev={ev} cal={cal} onClose={() => setSel(null)} />}
          {per && <PeriodForm key={per.id} per={per} cal={cal} onClose={() => setSel(null)} />}
        </aside>
      )}
      <div className="tl-scroll" ref={scroller} onPointerDown={down} onPointerMove={move} onPointerUp={() => setTimeout(() => (drag.current = null))} onClickCapture={click}>
        <div className="tl-canvas" style={{ width: x(max) + U, ['--band' as string]: `${band}px` }}>
          <div className="tl-top">{events.filter((e) => e.kind === 'party').map(card)}</div>
          <div className="tl-rail" style={{ height: band }}>
            <span className="tl-line" />
            {years.map(([y, c]) => <span key={y} className="tl-year" style={{ left: x(c) }}>{y}{cal.era ? ` ${cal.era}` : ''}</span>)}
            {events.map((e) => <span key={e.id} className={`tl-dot ${e.kind}`} style={{ left: x(coord[e.id]) }} />)}
            {periods.map((p) => {
              const s = x(coord[`${p.id}:start`]), w = Math.max(x(coord[`${p.id}:end`]) - s, 10)
              return (
                <button key={p.id} className={`tl-period ${sel?.id === p.id ? 'sel' : ''}`} title={`${p.title}: ${fmtDate(cal, p.start)} to ${fmtDate(cal, p.end)}`}
                  style={{ left: s, width: w, top: 22 + lane[p.id] * 28, background: p.color }} onClick={() => select('period', p.id)}>
                  {p.title}
                </button>
              )
            })}
          </div>
          <div className="tl-bottom">{events.filter((e) => e.kind === 'world').map(card)}</div>
        </div>
      </div>
    </div>
  )
}
