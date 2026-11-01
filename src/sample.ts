import { type Book, today } from './store'

// Dev-only demo book (see Settings). Never bundled into the production build.
function mapImage() {
  const c = document.createElement('canvas')
  c.width = 900; c.height = 560
  const g = c.getContext('2d')!
  g.fillStyle = '#2d4f66'; g.fillRect(0, 0, 900, 560)
  g.fillStyle = '#6f8f5a'
  g.beginPath(); g.moveTo(120, 300); g.bezierCurveTo(160, 120, 420, 60, 600, 140); g.bezierCurveTo(800, 200, 840, 420, 640, 480); g.bezierCurveTo(440, 540, 240, 480, 120, 300); g.fill()
  g.fillStyle = '#8a8f98'
  for (const [x, y] of [[300, 200], [340, 170], [380, 205], [330, 230]]) { g.beginPath(); g.moveTo(x - 36, y + 30); g.lineTo(x, y - 30); g.lineTo(x + 36, y + 30); g.fill() }
  g.fillStyle = '#2f5a38'
  for (let i = 0; i < 90; i++) { g.beginPath(); g.arc(470 + Math.random() * 240, 270 + Math.random() * 150, 6, 0, 7); g.fill() }
  return c.toDataURL('image/jpeg', 0.8)
}

const p = (...t: string[]) => t.map((x) => `<p>${x}</p>`).join('')

export function sampleBook(): Book {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA') }
  return {
    title: 'The Ashen Crown',
    threads: [
      { id: 't1', name: 'Who poisoned the king?', resolved: false },
      { id: 't2', name: 'Mira finds her magic', resolved: false },
      { id: 't3', name: 'The Pinebound truce', resolved: true },
    ],
    config: {
      types: {},
      calendar: { era: 'AE', months: ['Frost', 'Thaw', 'Bloom', 'Highsun', 'Harvest', 'Embers'].map((name) => ({ name, days: 30 })) },
    },
    stats: { goal: 800, days: { [today()]: 640, [day(1)]: 910, [day(2)]: 0, [day(3)]: 1250, [day(4)]: 820, [day(5)]: 300, [day(7)]: 1100 } },
    maps: [{
      id: 'm1', name: 'The Realm of Vaelen', image: mapImage(), w: 900, h: 560,
      pins: [{ id: 'p1', x: 330, y: 215, label: 'Stormhold', wikiId: 'w4' }, { id: 'p2', x: 560, y: 340, label: 'Pinebound Wood', wikiId: 'w5' }, { id: 'p3', x: 640, y: 190, label: 'Ashport' }],
    }],
    chapters: [
      { id: 'c1', title: 'The Last Winter Fair', status: 'done', notes: 'Introduce Mira as restless, not reckless. Plant the ember-glass.',
        body: p('The snow came early to Stormhold, and with it the smell of roasting chestnuts and woodsmoke. Mira pulled her cloak tight and pushed through the crowd toward the fair.', 'She had promised Aldric she would stay home. She had also promised herself she would stop making promises she could not keep.', '“You are late,” said the old man at the glass stall, without looking up. “The ember-glass has been waiting.”') + '<hr>' + p('Behind her, the horns of the Ashen Guard sounded twice. Twice meant the king.') },
      { id: 'c2', title: 'A Crown Gone Cold', status: 'revised', notes: 'Reveal the poison only through symptoms. No names yet.',
        body: p('King Edrin did not wake the next morning. The physicians spoke in low voices, and the servants spoke in none at all.', 'Captain Aldric stood at the foot of the bed with his hand on his sword, as if the thing that had killed the king might return and could be argued with.') },
      { id: 'c3', title: 'Into the Pinebound Wood', status: 'draft', notes: '',
        body: p('The road ended at the treeline. Beyond it the Pinebound Wood leaned close, dark and patient, and Mira felt the glass in her pocket grow warm.') },
      { id: 'c4', title: 'What the Ember Remembers', status: 'draft', notes: 'Magic cost: memory. Keep it vivid.', body: '' },
    ],
    wiki: [
      { id: 'w1', type: 'character', name: 'Mira Vaelen', notes: 'Youngest of the royal wards. Stubborn, curious, hides fear behind jokes.', fields: { Role: 'Protagonist', Age: '19', Appearance: 'Dark braid, ink-stained fingers', Goals: 'Learn who killed the king' }, links: [{ to: 'w2', label: 'mentor' }, { to: 'w3', label: 'member of' }] },
      { id: 'w2', type: 'character', name: 'Captain Aldric', notes: 'Loyal to a fault. Knows more than he says.', fields: { Role: 'Captain of the Ashen Guard', Age: '52' }, links: [{ to: 'w3', label: 'leads' }] },
      { id: 'w3', type: 'organization', name: 'The Ashen Guard', notes: 'Royal protectors sworn to the crown, not the king.', fields: { Purpose: 'Protect the throne', Leader: 'Captain Aldric', Headquarters: 'Stormhold' }, links: [{ to: 'w4', label: 'based in' }] },
      { id: 'w4', type: 'location', name: 'Stormhold', notes: 'Mountain fortress-city, built into a cliff face above the snowline.', fields: { Region: 'Northern peaks', Climate: 'Cold, windy' } },
      { id: 'w5', type: 'location', name: 'Pinebound Wood', notes: 'Old forest that seems to rearrange itself at night.', fields: { Region: 'Eastern foothills', Climate: 'Damp, cool' } },
      { id: 'w6', type: 'item', name: 'Ember-glass', notes: 'Warms near magic. Mira carries a shard.', fields: { Origin: 'Unknown', Owner: 'Mira Vaelen' }, links: [{ to: 'w1', label: 'carried by' }] },
      { id: 'w7', type: 'event', name: 'The Winter Fair', notes: 'Annual midwinter market. The last before the king fell.', fields: { Date: '3 Frost, 312 AE', Location: 'Stormhold' }, links: [{ to: 'w4', label: 'held in' }] },
    ],
    ideas: [
      { id: 'i1', text: 'What if the poison is something the king chose to drink?', tags: ['plot', 'twist'], pinned: true },
      { id: 'i2', text: 'Magic costs a memory, and the stronger the spell the older the memory.', tags: ['magic'], pinned: true },
      { id: 'i3', text: 'A bird that repeats the last thing it heard in the throne room.', tags: ['worldbuilding'], pinned: false },
      { id: 'i4', text: 'Opening line for book two: "The crown was never the thing being stolen."', tags: ['line'], pinned: false },
    ],
    scenes: [
      { id: 's1', title: 'The Omen', summary: 'Mira sees ember-glass flare at the fair.', chapterId: 'c1', pov: 'w1', location: 'w4', characters: ['w1', 'w2'], status: 'done', threads: ['t2'], date: { y: 312, m: 1, d: 3 }, when: 'dusk' },
      { id: 's2', title: 'The Horns', summary: 'Guards summon the court; the king is dying.', chapterId: 'c1', pov: 'w2', location: 'w4', characters: ['w2', 'w3'], status: 'done', threads: ['t1'], date: { y: 312, m: 1, d: 3 }, when: 'night' },
      { id: 's3', title: 'The Cold Bed', summary: 'Aldric studies the body for signs of poison.', chapterId: 'c2', pov: 'w2', location: 'w4', characters: ['w1', 'w2'], status: 'drafting', threads: ['t1'], date: { y: 312, m: 1, d: 4 } },
      { id: 's4', title: 'Into the Wood', summary: 'Mira follows the glass toward the forest.', chapterId: 'c3', pov: 'w1', location: 'w5', characters: ['w1'], status: 'drafting', threads: ['t2'], date: { y: 312, m: 2, d: 9 } },
      { id: 's5', title: 'The Truce Is Broken', summary: 'An old pact with the wood shatters.', pov: 'w2', location: 'w5', characters: ['w2'], status: 'planned', threads: ['t3'], date: { y: 312, m: 3, d: 1 } },
      { id: 's6', title: 'Undated twist', summary: 'Reveal who ordered the poison.', status: 'planned', threads: ['t1'] },
    ],
  }
}
