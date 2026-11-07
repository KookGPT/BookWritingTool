import assert from 'node:assert/strict'
import { insertAt, moveTo, shift } from '../src/plan.ts'

const L = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
const ids = (l: { id: string }[]) => l.map((x) => x.id).join('')

assert.equal(ids(moveTo(L, 'a', 'c', false)), 'bacd')
assert.equal(ids(moveTo(L, 'a', 'c', true)), 'bcad')
assert.equal(ids(moveTo(L, 'd', 'a', false)), 'dabc')
assert.equal(ids(moveTo(L, 'b', 'b', true)), 'abcd')
assert.equal(ids(moveTo(L, 'x', 'a', true)), 'abcd')
assert.equal(ids(shift(L, 'b', -1)), 'bacd')
assert.equal(ids(shift(L, 'b', 1)), 'acbd')
assert.equal(ids(shift(L, 'a', -1)), 'abcd')
assert.equal(ids(shift(L, 'd', 1)), 'abcd')
assert.equal(ids(insertAt(L, 0, { id: 'n' })), 'nabcd')
assert.equal(ids(insertAt(L, 2, { id: 'n' })), 'abncd')
assert.equal(ids(insertAt(L, 99, { id: 'n' })), 'abcdn')
assert.equal(ids(L), 'abcd') // never mutates
console.log('plan ok')
