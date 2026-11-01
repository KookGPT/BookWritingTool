import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { trashIt } from './history'
import { shrink } from './image'
import { allTypes, mentionsEntry, namesOf, plain, uid, useBook, type WikiEntry } from './store'

function Entry({ entry }: { entry: WikiEntry }) {
  const { book, update } = useBook()
  const nav = useNavigate()
  const types = allTypes(book)
  const patch = (p: Partial<WikiEntry>) =>
    update((b) => ({ ...b, wiki: b.wiki.map((w) => (w.id === entry.id ? { ...w, ...p } : w)) }))
  const keys = [...new Set([...(types[entry.type] ?? []), ...Object.keys(entry.fields)])]
  const inChapters = book.chapters.filter((c) => mentionsEntry(plain(c.body), entry))
  const inWiki = book.wiki.filter((w) => w.id !== entry.id && mentionsEntry(`${w.notes} ${Object.values(w.fields).join(' ')}`, entry))
  const onTimeline = book.events.filter((e) => e.wikiId === entry.id || e.locationId === entry.id)
  const links = entry.links ?? []
  const incoming = book.wiki.flatMap((w) => (w.links ?? []).filter((l) => l.to === entry.id).map((l) => ({ from: w, label: l.label })))
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')
  const [alias, setAlias] = useState('')
  const [field, setField] = useState('')
  const aliases = entry.aliases ?? []
  const addAlias = () => {
    const a = alias.trim()
    if (a && !aliases.some((x) => x.toLowerCase() === a.toLowerCase())) patch({ aliases: [...aliases, a] })
    setAlias('')
  }
  const addField = () => {
    const k = field.trim()
    if (k && !(k in entry.fields) && !keys.includes(k)) patch({ fields: { ...entry.fields, [k]: '' } })
    setField('')
  }
  const name = (id: string) => book.wiki.find((w) => w.id === id)?.name ?? '(deleted)'

  return (
    <>
      <div className="row">
        <input className="grow title" value={entry.name} onChange={(e) => patch({ name: e.target.value })} />
        <select value={entry.type} onChange={(e) => patch({ type: e.target.value })}>
          {Object.keys(types).map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        {entry.image && <img src={entry.image} className="portrait" alt={entry.name} />}
        <label className="upload alt-upload">{entry.image ? 'Change image' : '+ Add image'}
          <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) patch({ image: (await shrink(f, 600)).image }) }} />
        </label>
        {entry.image && <button className="alt" onClick={() => patch({ image: undefined })}>Remove image</button>}
      </div>
      <div>
        <small className="muted">ALSO KNOWN AS (links and mentions work for these too)</small>
        <div className="row" style={{ alignItems: 'center' }}>
          {aliases.map((a) => <span key={a} className="chip">{a}<button className="ghost icon" aria-label={`Remove alias ${a}`} onClick={() => patch({ aliases: aliases.filter((x) => x !== a) })}>×</button></span>)}
          <input aria-label="New alias" placeholder="Add alias, Enter" value={alias} onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAlias()} />
        </div>
      </div>
      {keys.map((k) => (
        <label key={k}>{k}
          <input value={entry.fields[k] ?? ''} onChange={(e) => patch({ fields: { ...entry.fields, [k]: e.target.value } })} />
        </label>
      ))}
      <div className="row">
        <input aria-label="New field name" className="grow" placeholder="New field name (e.g. Eye color)" value={field} onChange={(e) => setField(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addField()} />
        <button className="alt" disabled={!field.trim()} onClick={addField}>+ Field</button>
      </div>
      <label>Notes
        <textarea rows={8} value={entry.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </label>

      <h3>Relationships</h3>
      {links.map((l, i) => (
        <div key={i} className="row" style={{ alignItems: 'center' }}>
          <span className="grow">{l.label || 'related to'} → <Link to={`/wiki/${l.to}`}>{name(l.to)}</Link></span>
          <button className="alt" onClick={() => patch({ links: links.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      {incoming.map((x, i) => (
        <div key={i} className="muted">← <Link to={`/wiki/${x.from.id}`}>{x.from.name}</Link>: {x.label || 'related to'}</div>
      ))}
      <div className="row">
        <input className="grow" placeholder="e.g. sister of, rules, worships" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">to...</option>
          {book.wiki.filter((w) => w.id !== entry.id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button className="alt" disabled={!target} onClick={() => { patch({ links: [...links, { to: target, label: label.trim() }] }); setTarget(''); setLabel('') }}>Add</button>
      </div>

      <h3>Mentioned in</h3>
      <div className="row">
        {inChapters.map((c) => <Link key={c.id} to={`/write?c=${c.id}`} className="chip">{c.title}</Link>)}
        {inWiki.map((w) => <Link key={w.id} to={`/wiki/${w.id}`} className="chip">{w.name}</Link>)}
        {onTimeline.map((e) => <Link key={e.id} to={`/timeline?e=${e.id}`} className="chip">{e.title}</Link>)}
        {!inChapters.length && !inWiki.length && !onTimeline.length && <span className="muted">Nowhere yet. Writing the name or an alias in a chapter links it here.</span>}
      </div>
      <button className="danger" onClick={() => {
        if (!confirm(`Delete ${entry.name}? (It goes to Trash.)`)) return
        trashIt('wiki', entry.name, entry)
        update((b) => ({ ...b, wiki: b.wiki.filter((w) => w.id !== entry.id) }))
        nav('/wiki')
      }}>Delete entry</button>
    </>
  )
}

export default function Wiki() {
  const { book, update } = useBook()
  const { id } = useParams()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [newType, setNewType] = useState<{ name: string; fields: string } | null>(null)
  const types = allTypes(book)
  const entry = book.wiki.find((w) => w.id === id)
  const shown = book.wiki.filter((w) => namesOf(w).some((n) => n.toLowerCase().includes(q.toLowerCase())))

  const add = (type: string) => {
    if (type === '__new') { setNewType({ name: '', fields: '' }); return }
    const w: WikiEntry = { id: uid(), type, name: `New ${type}`, fields: {}, notes: '' }
    update((b) => ({ ...b, wiki: [...b.wiki, w] }))
    nav(`/wiki/${w.id}`)
  }

  const createType = () => {
    const t = newType?.name.trim().toLowerCase()
    if (!t || !newType) return
    const fields = newType.fields.split(',').map((f) => f.trim()).filter(Boolean)
    if (!types[t]) update((b) => ({ ...b, config: { ...b.config, types: { ...b.config.types, [t]: fields } } }))
    setNewType(null)
    add(t)
  }

  return (
    <div className="write">
      <aside>
        <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">+ New entry...</option>
          {Object.keys(types).map((t) => <option key={t}>{t}</option>)}
          <option value="__new">+ New type...</option>
        </select>
        {newType && (
          <div className="panel">
            <input aria-label="Type name" autoFocus placeholder="Type name (rune, clan, spell...)" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && createType()} />
            <input aria-label="Starter fields" placeholder="Starter fields, comma separated (optional)" value={newType.fields} onChange={(e) => setNewType({ ...newType, fields: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && createType()} />
            <div className="row"><button disabled={!newType.name.trim()} onClick={createType}>Create type</button><button className="alt" onClick={() => setNewType(null)}>Cancel</button></div>
          </div>
        )}
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link to="/graph" className="chip" style={{ alignSelf: 'flex-start' }}>Relationship graph</Link>
        {Object.keys(types).map((t) => {
          const group = shown.filter((w) => w.type === t)
          return group.length > 0 && (
            <div key={t}>
              <small className="muted">{t.toUpperCase()}</small>
              {group.map((w) => (
                <Link key={w.id} to={`/wiki/${w.id}`} className={`item ${w.id === id ? 'sel' : ''}`}>
                  {w.image && <img src={w.image} className="thumb" alt="" />}{w.name}
                </Link>
              ))}
            </div>
          )
        })}
      </aside>
      <section>{entry ? <Entry key={entry.id} entry={entry} /> : <p className="muted">Pick or add an entry.</p>}</section>
    </div>
  )
}
