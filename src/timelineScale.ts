// Pure layout for the horizontal timeline: dates -> rail coordinates in "units" (one unit = one card width).
// Real time is log-compressed so days-apart and centuries-apart both fit. Coordinates are derived, never stored.
import { type Calendar, ordinal } from './calendar.ts'

export interface TDate { y: number; m?: number; d?: number }
export interface LEvent { id: string; kind: 'party' | 'world'; date: TDate }
export interface LPeriod { id: string; start: TDate; end: TDate; startEvent?: string; endEvent?: string }

export const dayOf = (c: Calendar, t: TDate) => ordinal(c, { y: t.y, m: t.m ?? 1, d: t.d ?? 1 })
const GAP = 0.6 // units per log2 step
const gap = (days: number) => GAP * Math.log2(1 + days / 30)

// Keys: event ids, "<periodId>:start", "<periodId>:end". Same-day order: period start, event, period end.
export function layout(c: Calendar, events: LEvent[], periods: LPeriod[]) {
  const a = [
    ...events.map((e) => ({ key: e.id, day: dayOf(c, e.date), ord: 1, side: e.kind as string })),
    ...periods.flatMap((p) => [
      { key: `${p.id}:start`, day: dayOf(c, p.start), ord: 0, side: '' },
      { key: `${p.id}:end`, day: dayOf(c, p.end), ord: 2, side: '' },
    ]),
  ].sort((x, y) => x.day - y.day || x.ord - y.ord)
  const coord: Record<string, number> = {}
  const lastSide: Record<string, number> = {} // events on the same side keep at least 1 unit apart
  let prev: (typeof a)[number] | undefined
  let x = 0
  for (const n of a) {
    if (prev) x += gap(n.day - prev.day)
    if (n.side) { x = Math.max(x, (lastSide[n.side] ?? -Infinity) + 1); lastSide[n.side] = x }
    coord[n.key] = x
    prev = n
  }
  // A period tied to an event card sits exactly on that card.
  for (const p of periods) {
    if (p.startEvent && coord[p.startEvent] !== undefined) coord[`${p.id}:start`] = coord[p.startEvent]
    if (p.endEvent && coord[p.endEvent] !== undefined) coord[`${p.id}:end`] = coord[p.endEvent]
  }
  return { coord, max: Math.max(0, ...Object.values(coord)) }
}

// Overlapping periods stack: each takes the first lane whose last bar has ended.
export function lanes(coord: Record<string, number>, periods: LPeriod[]) {
  const ps = periods.map((p) => ({ id: p.id, s: coord[`${p.id}:start`], e: coord[`${p.id}:end`] })).sort((p, q) => p.s - q.s)
  const ends: number[] = []
  const lane: Record<string, number> = {}
  for (const p of ps) {
    let i = ends.findIndex((e) => e <= p.s)
    if (i < 0) i = ends.length
    ends[i] = Math.max(p.e, p.s)
    lane[p.id] = i
  }
  return { lane, count: ends.length }
}
