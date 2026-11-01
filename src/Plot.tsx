import { useState } from 'react'
import { trashIt } from './history'
import { type Scene, uid, useBook } from './store'

const COLORS = ['#8ab4ff', '#f2994a', '#6fcf97', '#bb6bd9', '#eb5757', '#f2c94c', '#56ccf2', '#9b9b9b']

export default function Plot() {
  const { book, update } = useBook()
  const [name, setName] = useState('')
  const { threads, scenes } = book

  const add = () => {
    if (!name.trim()) return
    update((b) => ({ ...b, threads: [...b.threads, { id: uid(), name: name.trim(), resolved: false }] }))
    setName('')
  }
  const toggle = (s: Scene, tid: string) =>
    update((b) => ({
      ...b,
      scenes: b.scenes.map((x) => {
        if (x.id !== s.id) return x
        const cur = x.threads ?? []
        return { ...x, threads: cur.includes(tid) ? cur.filter((t) => t !== tid) : [...cur, tid] }
      }),
    }))
  const patch = (id: string, p: Partial<(typeof threads)[number]>) =>
    update((b) => ({ ...b, threads: b.threads.map((t) => (t.id === id ? { ...t, ...p } : t)) }))
  const count = (tid: string) => scenes.filter((s) => s.threads?.includes(tid)).length

  const open = threads.filter((t) => !t.resolved)
  const untouched = threads.filter((t) => count(t.id) === 0)
  const loose = scenes.filter((s) => !s.threads?.length)

  return (
    <div className="page wider">
      <h1>Plot threads</h1>
      <p className="muted">Each row is a storyline; tick the scenes (columns, in Scenes order) that advance it. Mark a thread resolved once it pays off.</p>
      <div className="row">
        <input className="grow" placeholder="New thread, e.g. The stolen crown" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add}>Add thread</button>
      </div>

      {threads.length > 0 && scenes.length > 0 ? (
        <div className="lanes" style={{ gridTemplateColumns: `220px repeat(${scenes.length}, 90px)` }}>
          <span />
          {scenes.map((s, n) => <span key={s.id} className="head muted" title={s.title}>{n + 1}. {s.title}</span>)}
          {threads.flatMap((t, i) => [
            <div key={t.id} className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
              <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
              <input className="grow" value={t.name} onChange={(e) => patch(t.id, { name: e.target.value })} />
              <label className="check" title="Resolved"><input type="checkbox" checked={t.resolved} onChange={(e) => patch(t.id, { resolved: e.target.checked })} />✓</label>
              <button className="alt" title="Delete thread" onClick={() => {
                if (!confirm(`Delete thread "${t.name}"? (It goes to Trash.)`)) return
                trashIt('threads', t.name, t)
                update((b) => ({ ...b, threads: b.threads.filter((x) => x.id !== t.id), scenes: b.scenes.map((s) => ({ ...s, threads: s.threads?.filter((x) => x !== t.id) })) }))
              }}>×</button>
            </div>,
            ...scenes.map((s) => (
              <div key={t.id + s.id} className="cell" style={s.threads?.includes(t.id) ? { background: COLORS[i % COLORS.length] } : undefined} onClick={() => toggle(s, t.id)} />
            )),
          ])}
        </div>
      ) : (
        <p className="muted">{threads.length ? 'Add scenes in Scenes to fill the grid.' : 'Add your first thread above.'}</p>
      )}

      {threads.length > 0 && (
        <>
          <h2>Check</h2>
          <p>{open.length} of {threads.length} thread{threads.length > 1 ? 's' : ''} still open{open.length ? `: ${open.map((t) => t.name).join(', ')}` : ''}.</p>
          {untouched.length > 0 && <p className="muted">Not in any scene yet: {untouched.map((t) => t.name).join(', ')}.</p>}
          {loose.length > 0 && <p className="muted">Scenes on no thread: {loose.map((s) => s.title).join(', ')}.</p>}
        </>
      )}
    </div>
  )
}
