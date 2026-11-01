import { type Scene, useBook } from './store'

export const usePatchScene = (id: string) => {
  const update = useBook((s) => s.update)
  return (p: Partial<Scene>) => update((b) => ({ ...b, scenes: b.scenes.map((s) => (s.id === id ? { ...s, ...p } : s)) }))
}

const FIELDS = [
  ['summary', 'Premise', 'What happens, in a line or two?', 3],
  ['goal', 'Goal', 'What does the POV character want here?', 2],
  ['conflict', 'Conflict', 'What stands in the way?', 2],
  ['outcome', 'Outcome', 'How does it end? What has changed?', 2],
  ['beats', 'Beats', 'One beat per line, in order', 4],
] as const

// Planned scenes edit these fields; once drafting or done they stay visible as the reference the draft is written against.
export function PlanFields({ scene }: { scene: Scene }) {
  const patch = usePatchScene(scene.id)
  return (
    <>
      {FIELDS.map(([k, label, hint, rows]) => (
        <label key={k}>{label}<textarea rows={rows} placeholder={hint} value={scene[k] ?? ''} onChange={(e) => patch({ [k]: e.target.value })} /></label>
      ))}
    </>
  )
}

export function PlanView({ scene }: { scene: Scene }) {
  const shown = FIELDS.filter(([k]) => k !== 'beats' && scene[k]?.trim())
  const beats = (scene.beats ?? '').split('\n').filter((b) => b.trim())
  if (!shown.length && !beats.length) return <p className="muted">No plan was written for this scene.</p>
  return (
    <div className="planview">
      {shown.map(([k, label]) => <p key={k}><small className="muted">{label.toUpperCase()}</small><br />{scene[k]}</p>)}
      {beats.length > 0 && <><small className="muted">BEATS</small><ol>{beats.map((b, i) => <li key={i}>{b}</li>)}</ol></>}
    </div>
  )
}
