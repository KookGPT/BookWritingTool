// Custom in-world calendars. Pure functions with no imports so they run under plain node for tests.
export interface Calendar { months: { name: string; days: number }[]; era: string }
export interface SDate { y: number; m: number; d: number } // m is the 1-based month number

export const DEFAULT_CAL: Calendar = { months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })), era: '' }

export const yearLen = (c: Calendar) => c.months.reduce((n, m) => n + m.days, 0)

// Days since year 0, day 1 of month 1.
export const ordinal = (c: Calendar, s: SDate) =>
  s.y * yearLen(c) + c.months.slice(0, s.m - 1).reduce((n, m) => n + m.days, 0) + (s.d - 1)

export const fmt = (c: Calendar, s: SDate) =>
  `${s.d} ${c.months[s.m - 1]?.name ?? `month ${s.m}`}, ${s.y}${c.era ? ` ${c.era}` : ''}`

export function span(c: Calendar, a: SDate, b: SDate) {
  const days = ordinal(c, b) - ordinal(c, a)
  if (days === 0) return 'same day'
  const n = Math.abs(days)
  const yl = yearLen(c)
  const years = yl ? Math.floor(n / yl) : 0
  const txt = years ? `${years} year${years > 1 ? 's' : ''}, ${n % yl} day${n % yl === 1 ? '' : 's'}` : `${n} day${n === 1 ? '' : 's'}`
  return `${txt} ${days > 0 ? 'later' : 'earlier'}`
}
