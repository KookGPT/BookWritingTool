import assert from 'node:assert/strict'
import { nextStep } from '../src/next.ts'

const ch = (id: string, body: string, status: 'draft' | 'revised' | 'done') => ({ id, title: id, body, status, notes: '' })
assert.equal(nextStep({ chapters: [], scenes: [] }).to, '/scenes')
assert.equal(nextStep({ chapters: [ch('a', '', 'draft')], scenes: [] }).to, '/write?c=a')
assert.match(nextStep({ chapters: [ch('a', '<p>words here</p>', 'done')], scenes: [{ id: 's', title: 'S', summary: '' }] }).text, /planned scene/)
assert.match(nextStep({ chapters: [ch('a', '<p>x</p>', 'draft'), ch('b', '<p>x</p>', 'revised')], scenes: [] }).text, /Finish the draft of "a"/)
assert.match(nextStep({ chapters: [ch('b', '<p>x</p>', 'revised')], scenes: [] }).text, /revised to done/)
assert.match(nextStep({ chapters: [ch('b', '<p>x</p>', 'done')], scenes: [] }).text, /Everything is done/)
assert.equal(nextStep({ chapters: [], scenes: [{ id: 's', title: 'S', summary: '', status: 'drafting' }] }).to, '/scenes?s=s', 'a scene in progress comes first, chapters or not')
console.log('next ok')
