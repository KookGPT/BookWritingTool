// Find and replace, comments, connections, autofill and the For Claude bundle: the pure logic behind the writing room.
import assert from 'node:assert/strict'
import { autofillNames, complete } from '../src/autofill.ts'
import { claudeBrief } from '../src/claude.ts'
import { allComments, commentsIn } from '../src/comments.ts'
import { canReorder, chapterNeighbours, connected, linkScene, moveScene, sceneNeighbours, sceneOrder } from '../src/connect.ts'
import { blocks } from '../src/export.ts'
import { findAll, replaceAll, undoReplace } from '../src/replace.ts'
import { check } from '../src/spell.ts'
import type { Book, Scene } from '../src/store.ts'
import { bookWords, setSceneBody, toText, words } from '../src/text.ts'

const empty = (): Book => ({ title: 'T', threads: [], config: { types: {} }, stats: { goal: 500, days: {} }, maps: [], worlds: [], flatWorlds: [], locations: [], chapters: [], wiki: [], ideas: [], scenes: [], events: [], periods: [], plan: [] })
const wiki = (id: string, name: string, x: object = {}) => ({ id, type: 'character', name, fields: {}, notes: '', ...x })
const scene = (id: string, x: Partial<Scene> = {}): Scene => ({ id, title: id, summary: '', ...x })
const span = (id: string, note: string, text: string) => `<span data-comment="${id}" data-note="${encodeURIComponent(note)}">${text}</span>`

// ---------- comments ----------
{
  const html = `<p>She took the ${span('c1', 'check her age? "really" <soon> & later', 'old road')} north &amp; ${span('c2', '', 'R&amp;D')}</p>`
  const notes = commentsIn(html)
  assert.deepEqual(notes.map((n) => n.id), ['c1', 'c2'])
  assert.equal(notes[0].note, 'check her age? "really" <soon> & later')
  assert.equal(notes[0].quote, 'old road')
  assert.equal(notes[1].quote, 'R&D')
  assert.equal(words(html), words('<p>She took the old road north &amp; R&amp;D</p>'), 'a note never counts as words')
  assert.ok(!toText(html).includes('check'), 'a note never reaches the plain text')
  assert.ok(!blocks(html).flatMap((b) => b.runs).some((r) => r.t.includes('check')), 'a note never reaches an export')
  // a comment split by italics and overlapping comments keep their whole phrases
  const split = `<p>${span('a', 'x', 'one ')}<em>${span('a', 'x', 'two')}</em> ${span('b', 'y', `three ${span('c', 'z', 'four')}`)}</p>`
  assert.deepEqual(commentsIn(split).map((n) => n.quote), ['one two', 'three four', 'four'])
  // a placed scene is one text in two places: its comment is listed once, under the scene
  const b = { ...empty(), scenes: [scene('s', { body: `<p>${span('c', 'n', 'x')}</p>` })], chapters: [{ id: 'ch', title: 'C', body: `<div data-scene="s" class="scene-block"><p>${span('c', 'n', 'x')}</p></div>`, status: 'draft' as const, notes: '' }] }
  assert.deepEqual(allComments(b).map((n) => n.to), ['/scenes?s=s'])
}

// ---------- autofill ----------
{
  const names = ['Dematrus Mountains', 'Stones Hold', 'Theron', 'Aldric', 'Aldric Vane']
  assert.equal(complete('walked to Dem', names), 'atrus Mountains')
  assert.equal(complete('Dematrus Mou', names), 'ntains', 'a name of two words continues across the space')
  assert.equal(complete('De', names), '', 'nothing under three letters')
  assert.equal(complete('dem', names), '', 'case must match: ordinary lower-case typing stays quiet')
  assert.equal(complete('The', names), '', 'common sentence starters stay quiet')
  assert.equal(complete('Ther', names), 'on')
  assert.equal(complete('Stones Hold', names), '', 'a finished name offers nothing')
  assert.equal(complete('xDem', names), '', 'only at the start of a word')
  assert.equal(complete('Ald', names), 'ric', 'first in the list wins a tie')
  assert.equal(complete('Aldric V', names), 'ane', 'the longest typed match wins')
  assert.equal(complete('', names), '')
  const b = { wiki: [wiki('a', 'Mara'), wiki('b', 'Marek', { aliases: ['Mar Kel'] })] }
  assert.deepEqual(autofillNames(b, ['b']), ['Marek', 'Mar Kel', 'Mara'], "the scene's own people come first")
  assert.equal(complete('Mar', autofillNames(b, ['b'])), 'ek')
}

// ---------- story order and neighbours ----------
{
  const b = { ...empty(),
    scenes: [scene('a', { summary: 'A happens', outcome: 'A ends' }), scene('b'), scene('c', { summary: 'C happens' }), scene('d', { chapterId: 'c2', goal: 'D wants' }), scene('e', { body: '<p>Written text.</p>' })],
    chapters: [{ id: 'c1', title: 'One', body: '<div data-scene="c" class="scene-block"><p>x</p></div><div data-scene="b" class="scene-block"><p>y</p></div>', status: 'draft' as const, notes: '' }, { id: 'c2', title: 'Two', body: '<p>Two text</p>', status: 'draft' as const, notes: '' }] }
  assert.deepEqual(sceneOrder(b).map((s) => s.id), ['c', 'b', 'd', 'a', 'e'], 'chapters first, then the board')
  const n = sceneNeighbours(b, 'd')
  assert.deepEqual(n.before.map((x) => x.id), ['c', 'b'], 'reads in story order')
  assert.deepEqual(n.after.map((x) => x.id), ['a', 'e'])
  assert.equal(n.after[0].gist, 'A happens', 'what comes next is its premise')
  assert.equal(sceneNeighbours(b, 'e').before.at(-1)!.gist, 'A ends', 'what came before is how it ended')
  assert.equal(sceneNeighbours(b, 'a').after[0].gist, 'Written text.', 'prose stands in for a missing plan')
  assert.deepEqual(sceneNeighbours({ ...b, scenes: [] }, 'nope'), { before: [], after: [] })
  assert.deepEqual(sceneNeighbours({ scenes: [scene('x'), scene('y')], chapters: [] }, 'x').before, [])
  assert.deepEqual(chapterNeighbours(b, 'c2').before.map((x) => x.title), ['One'])
}

// ---------- reordering scenes, with no dates anywhere ----------
{
  const ids = (b: Book) => sceneOrder(b).map((s) => s.id)
  const body = '<p>Intro</p><div data-scene="p" class="scene-block"><p>P</p></div><p>Between</p><div data-scene="q" class="scene-block"><p>Q $& text</p></div><p>End</p>'
  const b: Book = { ...empty(),
    scenes: [scene('a'), scene('b'), scene('c'), scene('p', { chapterId: 'c1' }), scene('q', { chapterId: 'c1' }), scene('x', { chapterId: 'c2' }), scene('y', { chapterId: 'c2' })],
    chapters: [{ id: 'c1', title: 'One', body, status: 'draft', notes: '' }, { id: 'c2', title: 'Two', body: '', status: 'draft', notes: '' }] }
  assert.deepEqual(ids(b), ['p', 'q', 'x', 'y', 'a', 'b', 'c'])
  assert.deepEqual(ids(moveScene(b, 'c', 'a', false)), ['p', 'q', 'x', 'y', 'c', 'a', 'b'], 'undated scenes move freely')
  assert.deepEqual(ids(moveScene(b, 'a', 'c', true)), ['p', 'q', 'x', 'y', 'b', 'c', 'a'])
  assert.deepEqual(ids(moveScene(b, 'y', 'x', false)), ['p', 'q', 'y', 'x', 'a', 'b', 'c'], 'within a chapter, before any text exists')
  const swapped = moveScene(b, 'q', 'p', false)
  assert.deepEqual(ids(swapped), ['q', 'p', 'x', 'y', 'a', 'b', 'c'], 'placed scenes reorder in the chapter')
  assert.equal(swapped.chapters[0].body, '<p>Intro</p><div data-scene="q" class="scene-block"><p>Q $& text</p></div><div data-scene="p" class="scene-block"><p>P</p></div><p>Between</p><p>End</p>', 'the prose moves with the scene, the chapter text around it stays')
  assert.equal(moveScene(b, 'a', 'b', false), b, 'already there: nothing changes')
  assert.equal(moveScene(b, 'a', 'a', true), b)
  assert.equal(moveScene(b, 'a', 'nope', true), b)
  assert.equal(canReorder(b, 'a', 'p'), false, 'a loose scene does not join a chapter by being dragged')
  assert.equal(moveScene(b, 'a', 'p', true), b)
  assert.equal(moveScene(b, 'x', 'p', true), b, 'nor does one change chapter')
  assert.equal(canReorder({ ...b, scenes: [scene('l', { chapterId: 'deleted' }), scene('m')] }, 'l', 'm'), true, "a deleted chapter's scene is just loose")
}

// ---------- connections ----------
{
  const b: Book = { ...empty(),
    wiki: [wiki('w1', 'Stones Hold', { type: 'location' }), wiki('w2', 'Rose'), wiki('w3', 'Mara', { aliases: ['the Captain'], links: [{ to: 'w2', label: 'sister of' }], notes: 'Born in Stones Hold.' })],
    scenes: [
      scene('s1', { title: 'The Siege', pov: 'w3', location: 'w1', characters: ['w2'], date: { y: 10, m: 3, d: 5 } }),
      scene('s2', { title: 'Scene 2', body: '<p>She rose early and left. the Captain waved.</p>', date: { y: 10, m: 4, d: 1 } }),
      scene('s3', { title: 'Quiet', location: 'w1' }),
    ],
    events: [
      { id: 'e1', kind: 'party', title: 'Fall of the Gate', date: { y: 10, m: 3, d: 5 }, location: '', summary: 'Mara holds the wall' },
      { id: 'e2', kind: 'world', title: 'A Year', date: { y: 10 }, location: '', summary: '', locationId: 'w1' },
    ],
    ideas: [{ id: 'i1', text: 'What if The Siege fails?', tags: [], pinned: false }],
    plan: [{ id: 'p1', title: 'Card', summary: '', sceneId: 's1' }],
    chapters: [{ id: 'c1', title: 'One', body: '<div data-scene="s1" class="scene-block"><p>x</p></div>', status: 'draft', notes: '' }],
    flatWorlds: [{ id: 'm', name: 'Map', shape: 'rect', size: [10, 10], seed: 'x', features: [{ id: 'f1', kind: 'range', name: 'Dematrus Mountains' }, { id: 'f2', kind: 'lake' }],
      layers: [{ id: 'l', name: 'Cities', kind: 'cities', items: [{ id: 'city', name: 'Stones Hold', at: [0, 0] }, { id: 'unnamed', at: [1, 1] }] }] }],
  }
  const of = (kind: Parameters<typeof connected>[1]['kind'], id: string) => connected(b, { kind, id })
  const has = (hits: ReturnType<typeof connected>, id: string) => hits.find((h) => h.id === id)
  const s1 = of('scene', 's1')
  assert.equal(has(s1, 'w3')!.why, 'POV')
  assert.equal(has(s1, 'w1')!.why, 'set here')
  assert.equal(has(s1, 'c1')!.why, 'in this chapter')
  assert.equal(has(s1, 'p1')!.why, 'planning card')
  assert.equal(has(s1, 'e1')!.why, 'same date')
  assert.equal(has(s1, 'e2')!.why, 'same place', 'a year-only event is not "same date", but it shares the place')
  assert.ok(has(s1, 'i1'), 'an idea that names the scene title')
  assert.equal(has(s1, 'm/city')!.why, 'on the map', 'a scene set in a wiki place reaches the map through the name')
  const s2 = of('scene', 's2')
  assert.ok(!has(s2, 'w2'), '"she rose" is not the character Rose')
  assert.ok(has(s2, 'w3'), 'aliases count')
  assert.ok(!has(of('wiki', 'w3'), 'zzz'))
  assert.ok(has(of('wiki', 'w3'), 'w2'), 'relationships')
  assert.ok(has(of('wiki', 'w2'), 'w3'), 'relationships run both ways')
  const city = of('place', 'm/city')
  assert.equal(has(city, 'w1')!.why, 'same name')
  assert.ok(has(city, 's1') && has(city, 's3'), 'the map place shows the scenes set there')
  assert.ok(has(city, 'e2'), 'and the events')
  assert.ok(has(city, 'w3'), 'and whoever mentions it')
  assert.equal(has(of('wiki', 'w1'), 'm/city')!.to, '/map-test?w=m&place=city')
  assert.deepEqual(of('place', 'm/f1'), [], 'a name with no twin connects to nothing, and that is fine')
  assert.deepEqual(of('place', 'm/unnamed'), [], 'unnamed things are not places yet')
  assert.ok(!has(of('scene', 's3'), 'w2'))
  // by-hand link, both ways, removable
  const linked = linkScene(b, 's2', 'e1', true)
  assert.equal(has(connected(linked, { kind: 'scene', id: 's2' }), 'e1')!.manual, true)
  assert.equal(has(connected(linked, { kind: 'event', id: 'e1' }), 's2')!.why, 'linked by you')
  assert.ok(!has(connected(linkScene(linked, 's2', 'e1', false), { kind: 'scene', id: 's2' }), 'e1'))
  assert.equal(connected(b, { kind: 'scene', id: 's1' }), connected(b, { kind: 'scene', id: 's1' }), 'one graph per version of the book')
  // Deleted things must not crash or linger
  const gone = { ...b, wiki: b.wiki.filter((w) => w.id !== 'w3') }
  assert.ok(!has(connected(gone, { kind: 'scene', id: 's1' }), 'w3'))
}

// ---------- find and replace ----------
{
  const body = `<p>Aldric's <strong>Aldric</strong> <span data-comment="c" data-note="Aldric%20note">old</span> &amp; Aldricson</p>`
  const b: Book = { ...empty(),
    scenes: [scene('s', { title: 'Aldric rides', body, notes: 'fix Aldric' }), scene('t', { body: '<p>aldric</p>' })],
    chapters: [{ id: 'c', title: 'One', body: `<p>Intro Aldric</p><div data-scene="s" class="scene-block">${body}</div>`, status: 'draft', notes: '' }],
    wiki: [wiki('w', 'Aldric', { aliases: ['Old Aldric'], fields: { Role: 'Aldric the bold' }, notes: 'x' })],
    events: [{ id: 'e', kind: 'party', title: 'Aldric falls', date: { y: 1 }, location: '', summary: '' }],
    ideas: [{ id: 'i', text: 'Aldric #Aldric', tags: ['aldric'], pinned: false }],
    plan: [{ id: 'p', title: 'Aldric card', summary: '' }],
    periods: [{ id: 'pd', title: 'Age of Aldric', color: '#000', start: { y: 1 }, end: { y: 2 } }],
    flatWorlds: [{ id: 'm', name: 'Map', shape: 'rect', size: [1, 1], seed: 'x', features: [{ id: 'f', kind: 'range', name: 'Aldric Peaks' }], layers: [{ id: 'l', name: 'C', kind: 'cities', items: [{ id: 'k', name: 'Aldric Town', note: 'by Aldric' }] }] }],
  }
  const q = { find: 'Aldric', matchCase: true, wholeWord: true }
  const found = findAll(b, q)
  const scenePros = found.filter((m) => m.kind === 'scene' && m.field === 'Text')
  assert.equal(scenePros.length, 2, "whole word finds Aldric's and Aldric but not Aldricson")
  assert.ok(!found.some((m) => m.hit !== 'Aldric'))
  assert.equal(found.filter((m) => m.kind === 'chapter' && m.field === 'Text').length, 1, 'a placed scene is not counted again in its chapter')
  assert.equal(new Set(found.map((m) => m.key)).size, found.length, 'every match has its own key')
  for (const k of ['scene', 'chapter', 'wiki', 'event', 'period', 'plan', 'idea', 'map']) assert.ok(found.some((m) => m.kind === k), `searches ${k}`)
  assert.equal(findAll(b, { find: 'aldric' }).filter((m) => m.id === 't').length, 1, 'ignores case by default')
  assert.equal(findAll(b, { find: 'aldric', matchCase: true }).length, 1, 'match case')
  assert.equal(findAll(b, { find: 'data-note' }).length, 0, 'tags are not text')
  assert.equal(findAll(b, { find: 'note' }).filter((m) => m.kind === 'scene' && m.field === 'Text').length, 0, "a comment's own note is not text")
  assert.equal(findAll(b, { find: 'amp' }).length, 0, 'an entity is not text')
  assert.equal(findAll(b, { find: ' & ' }).length, 1, 'entities are searched as what they mean')
  assert.equal(findAll(b, { find: '' }).length, 0)
  assert.equal(findAll(b, { find: '(' }).length, 0, 'the search text is never a pattern')

  const after = replaceAll(b, q, 'Bram & Co')
  const s = after.scenes[0]
  assert.equal(s.title, 'Bram & Co rides')
  assert.ok(s.body!.includes("Bram &amp; Co's"), 'prose is encoded')
  assert.ok(s.body!.includes('Aldricson'), 'whole word left this alone')
  assert.ok(s.body!.includes('data-note="Aldric%20note"'), "a comment's note is untouched")
  assert.ok(after.chapters[0].body.includes('Intro Bram &amp; Co'))
  assert.ok(after.chapters[0].body.includes(s.body!), 'the placed scene in the chapter matches the scene exactly')
  assert.equal(after.wiki[0].name, 'Bram & Co')
  assert.deepEqual(after.wiki[0].aliases, ['Old Bram & Co'])
  assert.equal(after.wiki[0].fields.Role, 'Bram & Co the bold')
  assert.equal(after.flatWorlds[0].features[0].name, 'Bram & Co Peaks')
  assert.equal(after.flatWorlds[0].layers![0].items[0].name, 'Bram & Co Town')
  assert.equal(after.flatWorlds[0].layers![0].items[0].note, 'by Bram & Co')
  assert.equal(after.periods[0].title, 'Age of Bram & Co')
  assert.equal(after.scenes[1].body, '<p>aldric</p>', 'other case left alone')
  assert.equal(findAll(after, q).length, 0, 'nothing left to find')
  assert.deepEqual(replaceAll({ ...b, ideas: [{ id: 'i', text: 'x #old', tags: ['old'], pinned: false }] }, { find: 'old' }, 'new').ideas[0].tags, ['new'], 'tags follow the idea text')
  assert.equal(replaceAll(b, { find: 'nothing here' }, 'x'), b, 'no change makes no new book')

  // skipping one match, by the key the preview showed
  const proseKey = scenePros[1].key
  const skipped = replaceAll(b, q, 'Bram', { skip: new Set([proseKey]) })
  assert.ok(skipped.scenes[0].body!.startsWith("<p>Bram's <strong>Aldric</strong>"), 'the skipped match stays, the others change')

  // keeping the old name as an alias
  const kept = replaceAll(b, q, 'Bram', { keepAlias: true })
  assert.equal(kept.wiki[0].name, 'Bram')
  assert.deepEqual(kept.wiki[0].aliases, ['Old Bram', 'Aldric'])
  assert.deepEqual(replaceAll(b, { find: 'bold' }, 'brave', { keepAlias: true }).wiki[0].aliases, ['Old Aldric'], 'no rename, no alias')

  // undo restores exactly what changed and keeps later edits elsewhere
  const later = { ...after, ideas: [...after.ideas, { id: 'new', text: 'later', tags: [], pinned: false }], scenes: after.scenes.map((x) => (x.id === 't' ? { ...x, title: 'edited later' } : x)) }
  const undone = undoReplace(later, b, after)
  assert.equal(undone.scenes[0].body, body)
  assert.equal(undone.wiki[0].name, 'Aldric')
  assert.equal(undone.chapters[0].body, b.chapters[0].body)
  assert.equal(undone.flatWorlds[0].features[0].name, 'Aldric Peaks')
  assert.equal(undone.scenes[1].title, 'edited later', 'a later edit to something the replace never touched stays')
  assert.ok(undone.ideas.some((i) => i.id === 'new'), 'a later idea stays')

  const placed = setSceneBody(b, 's', '<p>new</p>')
  assert.ok(placed.chapters[0].body.includes('<p>new</p>'))
}

// ---------- book totals count scene writing ----------
{
  const body = '<p>one two three</p>'
  const b = { scenes: [scene('placed', { body }), scene('loose', { body: '<p>four five</p>' }), scene('planned')], chapters: [{ id: 'c', title: 'C', body: `<p>intro</p><div data-scene="placed" class="scene-block">${body}</div>`, status: 'draft' as const, notes: '' }] }
  assert.equal(bookWords(b), 6, 'a placed scene counts once, a loose scene counts too')
}

// ---------- For Claude ----------
{
  const b: Book = { ...empty(), title: 'Eyaris',
    wiki: [wiki('w', 'Mara', { fields: { Age: '31', Empty: ' ' }, notes: 'Hates boats.', aliases: ['the Captain'] }), wiki('far', 'Unrelated')],
    scenes: [
      scene('a', { title: 'Before', body: '<p>Prior prose.</p>' }),
      scene('b', { title: 'Now', pov: 'w', when: 'dawn', goal: 'Cross the river', notes: 'too slow?', body: `<p>${span('c', 'is this too long?', 'Mara boarded')} the boat.</p>` }),
      scene('c', { title: 'Next', summary: 'They land.' }),
    ],
    events: [{ id: 'e', kind: 'party', title: 'The Crossing', date: { y: 1 }, location: '', summary: 'Mara crosses', sceneIds: ['b'] }],
  }
  const t = claudeBrief(b, { kind: 'scene', id: 'b' })
  for (const bit of ['Do not rewrite anything', 'Eyaris', 'Prior prose.', 'THE TEXT: Now', 'Mara boarded the boat.', 'POV: Mara', 'They land.', 'On "Mara boarded": is this too long?', 'Age: 31', 'Hates boats.', 'also called the Captain', 'The Crossing: Mara crosses', 'My draft notes: too slow?'])
    assert.ok(t.includes(bit), `the bundle has: ${bit}`)
  assert.ok(!t.includes('Unrelated'), 'only what this scene touches')
  assert.ok(!t.includes('Empty'), 'blank wiki fields are left out')
  assert.ok(!t.includes('data-comment'), 'no HTML')
  const c = { ...b, chapters: [{ id: 'one', title: 'One', body: '<p>Mara walks.</p>', status: 'draft' as const, notes: '' }] }
  assert.ok(claudeBrief(c, { kind: 'chapter', id: 'one' }).includes('THE TEXT: One'))
  assert.ok(claudeBrief(b, { kind: 'scene', id: 'a' }).includes('After this'))
}

{ // a character's first name connects scenes without an alias, unless two characters share it
  const b = empty()
  b.scenes = [{ id: 's1', title: 'One', body: '<p>Kael ran. Jon hid.</p>' } as Scene]
  b.wiki = [{ id: 'k', type: 'character', name: 'Kael Dren', notes: '', fields: {} }, { id: 'j1', type: 'character', name: 'Jon Ash', notes: '', fields: {} }, { id: 'j2', type: 'character', name: 'Jon Bell', notes: '', fields: {} }]
  assert.ok(connected(b, { kind: 'wiki', id: 'k' }).some((h) => h.id === 's1'))
  assert.ok(!connected(b, { kind: 'wiki', id: 'j1' }).some((h) => h.id === 's1'))
}

{ // spelling: only near-misses of common words, never names; one clear slip is auto-fixable
  const known = new Set(['the', 'which', 'witch', 'receive', 'was', 'there', 'three', 'definitely', 'because']), common: Map<string, number> = new Map([['the', 0], ['which', 0], ['witch', 2], ['receive', 0], ['was', 0], ['there', 0], ['three', 0], ['definitely', 1], ['because', 0]])
  const r = check('Teh wich recieve Eyaris was thre, and wich', known, common, new Set())
  assert.deepEqual(r.map((m) => m.word), ['wich', 'recieve', 'thre', 'wich']) // Teh is capitalised, Eyaris is far from any common word
  assert.deepEqual(r[0].fix, ['which', 'witch'])
  assert.equal(r[0].auto, 'which') // the more common word wins
  assert.equal(r[1].auto, 'receive') // swapped letters
  assert.equal(r[2].auto, undefined) // there or three: ask
  assert.equal(check('wich', known, common, new Set(['wich'])).length, 0) // wiki name
  const bad = check('defanitly becuase', known, common, new Set())
  assert.equal(bad[0].fix[0], 'definitely') // two slips: suggested, never automatic
  assert.equal(bad[0].auto, undefined)
  assert.equal(bad[1].auto, 'because')
}

console.log('writing ok')
