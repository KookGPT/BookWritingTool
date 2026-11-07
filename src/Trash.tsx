import { useEffect, useState } from 'react'
import { getTrash, setTrash, type Trashed } from './history'
import { useBook } from './store'
import { PageHead } from './ui'

export default function Trash() {
  const update = useBook((s) => s.update)
  const [items, setItems] = useState<Trashed[]>([])
  useEffect(() => { getTrash().then(setItems) }, [])
  const save = (t: Trashed[]) => { setItems(t); setTrash(t) }

  const restore = (t: Trashed) => {
    update((b) => ({ ...b, [t.kind]: [...b[t.kind], t.data] }))
    save(items.filter((i) => i.id !== t.id))
  }

  return (
    <div className="page wide">
      <PageHead title="Trash" hint="Deleted chapters, wiki entries, scenes, ideas, maps and timeline items are kept here on this device (last 100)." />
      {items.length > 0 && <button className="danger" style={{ alignSelf: 'flex-start' }} onClick={() => confirm('Empty trash forever?') && save([])}>Empty trash</button>}
      {items.map((t) => (
        <div key={t.id} className="item">
          <span><small className="muted">{t.kind.toUpperCase()}</small> {t.name}</span>
          <small className="muted">{new Date(t.at).toLocaleString()}</small>
          <div className="row">
            <button className="alt" onClick={() => restore(t)}>Restore</button>
            <button className="alt" onClick={() => save(items.filter((i) => i.id !== t.id))}>Delete forever</button>
          </div>
        </div>
      ))}
      {!items.length && <p className="muted">Nothing here.</p>}
    </div>
  )
}
