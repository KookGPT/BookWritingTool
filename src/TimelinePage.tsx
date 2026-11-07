import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { type Calendar, yearLen } from './calendar'
import { trashIt } from './history'
import Icon from './Icon'
import { COLORS, PlanForm, PlanTimeline } from './PlanTimeline'
import { calendarOf, type PlanItem, type Period, type TDate, type TEvent, uid, useBook } from './store'
import { dayOf, lanes, layout } from './timelineScale'
import { PageHead, useLocal } from './ui'

const BASE = 210 // px per unit at zoom 1 (one card width plus breathing room)

const fmtDate = (c: Calendar, t: TDate) => {
  const m = t.m ? c.months[t.m - 1]?.name : undefined
  return [[t.d, m].filter(Boolean).join(' '), `${t.y}${c.era ? ` ${c.era}` : ''}`].filter(Boolean).join(', ')
}

function DateInput({ label, value, cal, onChange }: { label: string; value: TDate; cal: Calendar; onChange: (d: TDate) => void }) {
  const maxDay = cal.months[(value.m ?? 1) - 1]?.days ?? 31
  const clamp = (d: number | undefined, m: number | undefined) => (d === undefined ? undefined : Math.max(1, Math.min(d, cal.months[(m ?? 1) - 1]?.days ?? 31)))
  const doy = value.m ? dayOf(cal, { y: value.y, m: value.m, d: value.d }) - dayOf(cal, { y: value.y }) + 1 : 0
  return (
    <div className="row" style={{ alignItems: 'end' }}>
      <label>{label ? `${label} year` : 'Year'}
        <input type="number" style={{ width: '6rem' }} value={value.y} onChange={(e) => onChange({ ...value, y: +e.target.value })} />
      </label>
      <label>Month
        <select value={value.m ?? ''} onChange={(e) => { const m = e.target.value ? +e.target.value : undefined; onChange({ y: value.y, m, d: m ? clamp(value.d, m) : undefined }) }}>
          <option value="">-</option>
          {cal.months.map((m, i) => <option key={i} value={i + 1}>{m.name}</option>)}
        </select>
      </label>
      <label>Day
        <input type="number" min={1} max={maxDay} style={{ width: '4.5rem' }} value={value.d ?? ''} placeholder="-"
          onChange={(e) => { const d = e.target.value ? clamp(+e.target.value, value.m) : undefined; onChange({ ...value, m: d && !value.m ? 1 : value.m, d }) }} />
      </label>
      {doy > 0 && <small className="muted" style={{ paddingBottom: '.55rem' }}>day {doy} of {yearLen(cal)}</small>}
    </div>
  )
}

function EventForm({ ev, cal, onClose, onCopy }: { ev: TEvent; cal: Calendar; onClose: () => void; onCopy: () => void }) {
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
        <button className="alt" onClick={onCopy}>Duplicate</button>
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
  const [zoom, setZoom] = useLocal<number>('tl-zoom', 1)
  const U = BASE * zoom
  const [params] = useSearchParams()
  const [sel, setSel] = useState<{ kind: 'event' | 'period' | 'plan'; id: string } | null>(() => (params.get('e') ? { kind: 'event', id: params.get('e')! } : null))
  const [q, setQ] = useState('')
  const [show, setShow] = useState({ party: true, world: true, periods: true })
  const scroller = useRef<HTMLDivElement>(null)

  const wname = (id?: string) => book.wiki.find((w) => w.id === id)?.name ?? ''
  const place = (e: TEvent) => wname(e.locationId) || e.location
  const needle = q.trim().toLowerCase()
  const hit = (...t: (string | undefined)[]) => !needle || t.join(' ').toLowerCase().includes(needle)
  const events = useMemo(() => book.events.filter((e) => show[e.kind] && hit(e.title, e.summary, place(e), wname(e.wikiId))), [book.events, book.wiki, show, needle]) // eslint-disable-line react-hooks/exhaustive-deps
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
  }, [events, periods, coord, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Escape closes the editor. Dragging empty space pans; the wheel is left alone so the page can scroll down to the plan.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest?.('select')) setSel(null) }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [])
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const down = (e: React.PointerEvent) => { drag.current = { x: e.clientX, left: scroller.current!.scrollLeft, moved: false } }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.x) > 4) d.moved = true
    if (d.moved) scroller.current!.scrollLeft = d.left - (e.clientX - d.x)
  }
  const [mini, setMini] = useState({ left: 0, width: 1, total: 1 })
  const syncMini = () => { const el = scroller.current; if (el) setMini({ left: el.scrollLeft, width: el.clientWidth, total: Math.max(el.scrollWidth, 1) }) }
  useEffect(syncMini, [max, zoom, events.length, periods.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const jump = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointermove' && !e.buttons) return
    const el = scroller.current, r = e.currentTarget.getBoundingClientRect()
    if (el) el.scrollLeft = ((e.clientX - r.left) / r.width) * el.scrollWidth - el.clientWidth / 2
  }
  const [dropping, setDropping] = useState(false)
  const dropPlan = (id: string, cx: number, cy: number) => {
    const p = book.plan.find((x) => x.id === id), el = scroller.current
    if (!p || !el) return
    const c = (cx - el.getBoundingClientRect().left + el.scrollLeft) / U - 1
    const rail = el.querySelector('.tl-rail')?.getBoundingClientRect()
    const nearest = [...events].sort((a, b) => Math.abs(coord[a.id] - c) - Math.abs(coord[b.id] - c))[0]
    schedule(p, nearest?.date ?? last, rail ? (cy < rail.top + rail.height / 2 ? 'party' : 'world') : p.kind ?? 'party')
  }
  const click = (e: React.MouseEvent) => { if (drag.current?.moved) e.stopPropagation(); drag.current = null }

  const ev = sel?.kind === 'event' ? book.events.find((e) => e.id === sel.id) : undefined
  const per = sel?.kind === 'period' ? book.periods.find((p) => p.id === sel.id) : undefined
  const planItem = sel?.kind === 'plan' ? book.plan.find((p) => p.id === sel.id) : undefined
  // New things start on the selected event's day (so they sit right beside it), else on the latest day in the book.
  const last = ev?.date ?? [...book.events].sort((a, b) => dayOf(cal, b.date) - dayOf(cal, a.date))[0]?.date ?? { y: 1 }
  const addEvent = (kind: TEvent['kind']) => {
    const e: TEvent = { id: uid(), kind, title: kind === 'party' ? 'New party event' : 'New world event', date: { ...last }, location: '', summary: '' }
    update((b) => ({ ...b, events: [...b.events, e] }))
    setSel({ kind: 'event', id: e.id })
  }
  const copyEvent = (src: TEvent) => {
    const e: TEvent = { ...src, id: uid(), title: `${src.title} (copy)`, date: { ...src.date } }
    update((b) => ({ ...b, events: [...b.events, e] }))
    setSel({ kind: 'event', id: e.id })
  }
  const addPeriod = () => {
    const p: Period = { id: uid(), title: 'New period', color: COLORS[book.periods.length % COLORS.length], start: { ...last }, end: { y: last.y + 1 } }
    update((b) => ({ ...b, periods: [...b.periods, p] }))
    setSel({ kind: 'period', id: p.id })
  }
  const schedule = (p: PlanItem, date: TDate = last, kind: TEvent['kind'] = p.kind ?? 'party') => {
    const e: TEvent = { id: uid(), kind, title: p.title, date: { ...date }, location: '', summary: p.summary }
    update((b) => ({ ...b, plan: b.plan.filter((x) => x.id !== p.id), events: [...b.events, e] }))
    setSel({ kind: 'event', id: e.id })
  }

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
    <div className={`page wider tl ${zoom < 0.8 ? 'zoomed-out' : ''}`}>
      <PageHead title="Production Timeline" hint="Top: where the party is and what they do. Bottom: what the world is doing out of their sight. Bars on the rail are periods. Drag to move along it, drop a planning card on it to date it.">
        <input className="tl-search" type="search" aria-label="Search timeline" placeholder="Search events..." value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { const f = [...events].sort((a, b) => coord[a.id] - coord[b.id])[0]; if (f) select('event', f.id) } }} />
        <details className="menu">
          <summary>View</summary>
          <div className="menu-pop">
            {toggle('party', 'Party events')}{toggle('world', 'World events')}{toggle('periods', 'Periods')}
            <label>Zoom
              <input type="range" min={0.6} max={1.4} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
            </label>
          </div>
        </details>
        <button className="alt icon" aria-label="Previous event" onClick={() => step(-1)}><Icon name="left" /></button>
        <button className="alt icon" aria-label="Next event" onClick={() => step(1)}><Icon name="right" /></button>
        <button onClick={() => addEvent('party')}><Icon name="plus" size={16} /> Party event</button>
        <button className="alt" onClick={() => addEvent('world')}><Icon name="plus" size={16} /> World event</button>
        <button className="alt" onClick={addPeriod}><Icon name="plus" size={16} /> Period</button>
      </PageHead>
      {needle && !events.length && !periods.length && <p className="muted">No events or periods match "{q}".</p>}
      {!book.events.length && !book.periods.length && (
        <div className="empty"><Icon name="timeline" size={32} /><p>Nothing on the timeline yet. Add where the party goes, or what the world is up to.</p></div>
      )}
      {(ev || per || planItem) && (
        <aside className="drawer right tl-drawer" aria-label="Edit">
          {ev && <EventForm key={ev.id} ev={ev} cal={cal} onClose={() => setSel(null)} onCopy={() => copyEvent(ev)} />}
          {planItem && <PlanForm key={planItem.id} item={planItem} onClose={() => setSel(null)} onSchedule={schedule} />}
          {per && <PeriodForm key={per.id} per={per} cal={cal} onClose={() => setSel(null)} />}
        </aside>
      )}
      {events.length + periods.length > 1 && (
        <div className="tl-mini" aria-label="Overview of the whole timeline: click or drag to move" onPointerDown={jump} onPointerMove={jump}>
          {periods.map((p) => <i key={p.id} className="per" style={{ left: `${(x(coord[`${p.id}:start`]) / mini.total) * 100}%`, width: `${Math.max(((x(coord[`${p.id}:end`]) - x(coord[`${p.id}:start`])) / mini.total) * 100, 0.6)}%`, background: p.color }} />)}
          {events.map((e) => <i key={e.id} className={e.kind} style={{ left: `${(x(coord[e.id]) / mini.total) * 100}%` }} />)}
          <b className="win" style={{ left: `${(mini.left / mini.total) * 100}%`, width: `${Math.min(100, (mini.width / mini.total) * 100)}%` }} />
        </div>
      )}
      <div
        className={`tl-scroll ${dropping ? 'dropping' : ''}`} ref={scroller} onPointerDown={down} onPointerMove={move} onPointerUp={() => setTimeout(() => (drag.current = null))} onClickCapture={click} onScroll={syncMini}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-plan')) { e.preventDefault(); setDropping(true) } }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => { const id = e.dataTransfer.getData('application/x-plan'); if (!id) return; e.preventDefault(); setDropping(false); dropPlan(id, e.clientX, e.clientY) }}
      >
        <div className="tl-canvas" style={{ width: x(max) + U, ['--band' as string]: `${band}px`, ['--cw' as string]: `${Math.round(Math.min(190, 190 * zoom))}px` }}>
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
      <div style={{ marginTop: '1.4rem', display: 'flex', flexDirection: 'column', gap: '.8rem' }}>
        <PageHead title="Planning Timeline" hint="No dates here. Lay out what happens in the order you want: drag cards to reorder, press + between cards to insert. Drag a card up onto the Production Timeline to date it (it lands on the nearest event's day, above or below the rail for party or world)." />
      </div>
      <PlanTimeline selId={planItem?.id} onSelect={(id) => setSel({ kind: 'plan', id })} />
    </div>
  )
}
