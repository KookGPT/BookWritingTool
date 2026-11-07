import { useState } from 'react'
import { trashIt } from './history'
import Icon from './Icon'
import { insertAt, moveTo, shift } from './plan'
import { type PlanItem, uid, useBook } from './store'

export const COLORS = ['#7cc4a0', '#e2a94d', '#7aa7d9', '#b69cf0', '#e5796a', '#9aa7a0']

// A dateless, ordered strip of cards: drag to reorder, "+" between cards to insert, arrows for touch screens.
export function PlanTimeline({ selId, onSelect }: { selId?: string; onSelect: (id: string) => void }) {
  const { book, update } = useBook()
  const plan = book.plan
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  const set = (fn: (p: PlanItem[]) => PlanItem[]) => update((b) => ({ ...b, plan: fn(b.plan) }))

  const insert = (at: number) => {
    const p: PlanItem = { id: uid(), title: 'New card', summary: '' }
    set((l) => insertAt(l, at, p))
    onSelect(p.id)
  }
  const end = () => { setDrag(null); setOver(null) }
  const drop = (target = over) => {
    if (drag && target) set((l) => moveTo(l, drag, target.id, target.after))
    end()
  }

  return (
    <div className="plan-scroll" aria-label="Planning timeline">
      {!plan.length && <p className="muted plan-empty">Nothing planned yet. Add cards for scenes and beats in the order you want them, no dates needed.</p>}
      {plan.map((p, i) => (
        <div key={p.id} className="plan-slot">
          <button className="plan-gap" aria-label={`Insert a card before ${p.title || 'this card'}`} title="Insert a card here" onClick={() => insert(i)}><Icon name="plus" size={14} /></button>
          <div
            className={`plan-card ${selId === p.id ? 'sel' : ''} ${drag === p.id ? 'dragging' : ''} ${over?.id === p.id ? (over.after ? 'over-after' : 'over-before') : ''}`}
            style={{ ['--c' as string]: p.color ?? 'var(--border-strong)' }}
            draggable
            onDragStart={(e) => { setDrag(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id) }}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2
              setOver((o) => (o?.id === p.id && o.after === after ? o : { id: p.id, after }))
            }}
            onDrop={(e) => { e.preventDefault(); drop() }}
            onDragEnd={end}
          >
            <div className="plan-body" role="button" tabIndex={0} onClick={() => onSelect(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id) } }}>
              <small className="muted">{i + 1}{p.kind === 'world' ? ' · World' : ''}</small>
              <b>{p.title || 'Untitled'}</b>
              {p.summary && <span className="tl-sum">{p.summary}</span>}
            </div>
            <div className="plan-move">
              <button className="ghost icon" aria-label="Move earlier" title="Move earlier" disabled={i === 0} onClick={() => set((l) => shift(l, p.id, -1))}><Icon name="left" size={14} /></button>
              <button className="ghost icon" aria-label="Move later" title="Move later" disabled={i === plan.length - 1} onClick={() => set((l) => shift(l, p.id, 1))}><Icon name="right" size={14} /></button>
            </div>
          </div>
        </div>
      ))}
      <button
        className="plan-gap end" title="Add a card at the end" onClick={() => insert(plan.length)}
        onDragOver={(e) => { if (drag && plan.length) e.preventDefault() }}
        onDrop={(e) => { e.preventDefault(); drop({ id: plan[plan.length - 1].id, after: true }) }}
      ><Icon name="plus" size={14} /> Add card</button>
    </div>
  )
}

export function PlanForm({ item, onClose, onSchedule }: { item: PlanItem; onClose: () => void; onSchedule: (p: PlanItem) => void }) {
  const { update } = useBook()
  const patch = (p: Partial<PlanItem>) => update((b) => ({ ...b, plan: b.plan.map((x) => (x.id === item.id ? { ...x, ...p } : x)) }))
  const remove = () => {
    if (!confirm('Delete this card? (It goes to Trash.)')) return
    trashIt('plan', item.title, item)
    update((b) => ({ ...b, plan: b.plan.filter((x) => x.id !== item.id) }))
    onClose()
  }
  return (
    <div className="panel">
      <div className="row">
        <input className="grow title" aria-label="Card title" value={item.title} onChange={(e) => patch({ title: e.target.value })} />
        <button className="ghost icon" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="row" role="radiogroup" aria-label="Color">
        <button role="radio" aria-checked={!item.color} aria-label="No color" className="swatch" style={{ background: 'transparent', outline: !item.color ? '2px solid var(--fg)' : 'none' }} onClick={() => patch({ color: undefined })} />
        {COLORS.map((c) => (
          <button key={c} role="radio" aria-checked={item.color === c} aria-label={c} className="swatch" style={{ background: c, outline: item.color === c ? '2px solid var(--fg)' : 'none' }} onClick={() => patch({ color: c })} />
        ))}
      </div>
      <label>Notes<textarea rows={5} value={item.summary} onChange={(e) => patch({ summary: e.target.value })} /></label>
      <label>When it moves to the Production Timeline it goes on the
        <select value={item.kind ?? 'party'} onChange={(e) => patch({ kind: e.target.value as PlanItem['kind'] })}>
          <option value="party">Party side (top)</option>
          <option value="world">World side (bottom)</option>
        </select>
      </label>
      <div className="row">
        <button onClick={() => onSchedule(item)}>Move to Production Timeline</button>
        <button className="danger" onClick={remove}>Delete</button>
      </div>
      <small className="muted">Moving it removes the card from this strip and adds a dated event you can then set a date for.</small>
    </div>
  )
}
