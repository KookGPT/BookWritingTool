import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { trashIt } from './history'
import { shrink } from './image'
import { allTypes, mentions, plain, uid, useBook, type WikiEntry } from './store'

function Entry({ entry }: { entry: WikiEntry }) {
  const { book, update } = useBook()
  const nav = useNavigate()
  const types = allTypes(book)
  const patch = (p: Partial<WikiEntry>) =>
    update((b) => ({ ...b, wiki: b.wiki.map((w) => (w.id === entry.id ? { ...w, ...p } : w)) }))
  const keys = [...new Set([...(types[entry.type] ?? []), ...Object.keys(entry.fields)])]
  const inChapters = book.chapters.filter((c) => mentions(plain(c.body), entry.name))
  const inWiki = book.wiki.filter((w) => w.id !== entry.id && mentions(`${w.notes} ${Object.values(w.fields).join(' ')}`, entry.name))
  const links = entry.links ?? []
  const incoming = book.wiki.flatMap((w) => (w.links ?? []).filter((l) => l.to === entry.id).map((l) => ({ from: w, label: l.label })))
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')
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
      {keys.map((k) => (
        <label key={k}>{k}
          <input value={entry.fields[k] ?? ''} onChange={(e) => patch({ fields: { ...entry.fields, [k]: e.target.value } })} />
        </label>
      ))}
      <button className="alt" onClick={() => { const k = prompt('Field name?')?.trim(); if (k) patch({ fields: { ...entry.fields, [k]: '' } }) }}>+ Field</button>
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
        {!inChapters.length && !inWiki.length && <span className="muted">Nowhere yet. Writing the name (or [[{entry.name}]]) in a chapter links it here.</span>}
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
  const types = allTypes(book)
  const entry = book.wiki.find((w) => w.id === id)
  const shown = book.wiki.filter((w) => w.name.toLowerCase().includes(q.toLowerCase()))

  const add = (type: string) => {
    if (type === '__new') {
      const t = prompt('New type name (e.g. rune, clan, spell)?')?.trim().toLowerCase()
      if (!t) return
      const fields = (prompt('Starter fields, comma separated (optional)?') ?? '').split(',').map((f) => f.trim()).filter(Boolean)
      if (!types[t]) update((b) => ({ ...b, config: { ...b.config, types: { ...b.config.types, [t]: fields } } }))
      type = t
    }
    const w: WikiEntry = { id: uid(), type, name: `New ${type}`, fields: {}, notes: '' }
    update((b) => ({ ...b, wiki: [...b.wiki, w] }))
    nav(`/wiki/${w.id}`)
  }

  return (
    <div className="write">
      <aside>
        <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">+ New entry...</option>
          {Object.keys(types).map((t) => <option key={t}>{t}</option>)}
          <option value="__new">+ New type...</option>
        </select>
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
