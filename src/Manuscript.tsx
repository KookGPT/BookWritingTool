import { Link } from 'react-router-dom'
import { useBook, words } from './store'

// Chapter HTML is the user's own Tiptap output (and their private repo), but strip anything executable anyway.
const clean = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes])
      if (a.name.startsWith('on') || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name)
  })
  return doc.body.innerHTML
}

export default function Manuscript() {
  const { book } = useBook()
  const total = book.chapters.reduce((n, c) => n + words(c.body), 0)
  return (
    <div className="manuscript">
      <h1>{book.title}</h1>
      <p className="muted">
        {book.chapters.length} chapters · {total.toLocaleString()} words · about {Math.round(total / 250)} pages · {Math.max(1, Math.round(total / 238))} min read
      </p>
      {book.chapters.map((c) => (
        <section key={c.id}>
          <h2>
            {c.title} <Link to={`/write?c=${c.id}`} className="chip">edit</Link>
            <small className="muted"> {c.status} · {words(c.body)} words</small>
          </h2>
          {c.body ? <div dangerouslySetInnerHTML={{ __html: clean(c.body) }} /> : <p className="muted">(empty)</p>}
        </section>
      ))}
      {!book.chapters.length && <p className="muted">No chapters yet. Add some in Write.</p>}
    </div>
  )
}
