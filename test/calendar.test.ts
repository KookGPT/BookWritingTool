import assert from 'node:assert/strict'
import { DEFAULT_CAL, fmt, ordinal, span, yearLen, type Calendar } from '../src/calendar.ts'

const cal: Calendar = { months: [{ name: 'Frost', days: 20 }, { name: 'Bloom', days: 40 }], era: 'AE' } // 60-day year
assert.equal(yearLen(cal), 60)
assert.equal(ordinal(cal, { y: 0, m: 1, d: 1 }), 0)
assert.equal(ordinal(cal, { y: 0, m: 2, d: 1 }), 20)
assert.equal(ordinal(cal, { y: 2, m: 2, d: 5 }), 144)
assert.equal(fmt(cal, { y: 312, m: 2, d: 5 }), '5 Bloom, 312 AE')
assert.equal(span(cal, { y: 1, m: 1, d: 1 }, { y: 1, m: 1, d: 1 }), 'same day')
assert.equal(span(cal, { y: 1, m: 1, d: 1 }, { y: 1, m: 1, d: 4 }), '3 days later')
assert.equal(span(cal, { y: 1, m: 1, d: 4 }, { y: 1, m: 1, d: 3 }), '1 day earlier')
assert.equal(span(cal, { y: 1, m: 1, d: 1 }, { y: 3, m: 1, d: 11 }), '2 years, 10 days later')
assert.equal(yearLen(DEFAULT_CAL), 360)
console.log('calendar: all checks passed')
