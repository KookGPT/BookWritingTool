import { useState } from 'react'
import { saveDocx, saveEpub } from './export'
import { sampleBook } from './sample'
import { type Book, useBook } from './store'
import { loadSettings, runSync, saveSettings, useSyncStatus } from './sync'

const download = (name: string, text: string, type: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// Tiptap HTML -> Markdown for the few tags the editor produces.
const toMarkdown = (b: Book) =>
  `# ${b.title}\n\n` + b.chapters.map((c) => `## ${c.title}\n\n` + c.body
    .replace(/<h2>(.*?)<\/h2>/g, '### $1\n\n')
    .replace(/<\/?(strong|b)>/g, '**').replace(/<\/?(em|i)>/g, '*')
    .replace(/<li><p>(.*?)<\/p><\/li>|<li>(.*?)<\/li>/g, '- $1$2\n')
    .replace(/<blockquote>(.*?)<\/blockquote>/g, (_, q) => q.replace(/<\/?p>/g, '') .replace(/^/, '> ') + '\n\n')
    .replace(/<\/p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim()).join('\n\n')

export default function Settings() {
  const [s, setS] = useState(loadSettings)
  const { book, dirty, update } = useBook()
  const { text, busy } = useSyncStatus()
  const edit = (p: Partial<typeof s>) => { const n = { ...s, ...p }; setS(n); saveSettings(n) }

  return (
    <div className="page">
      <h1>Settings and Sync</h1>
      <label>Book title<input value={book.title} onChange={(e) => update((b) => ({ ...b, title: e.target.value }))} /></label>
      <h2>Export</h2>
      <div className="row">
        <button className="alt" onClick={() => saveDocx(book)}>Word (.docx)</button>
        <button className="alt" onClick={() => saveEpub(book)}>E-book (.epub)</button>
        <button className="alt" onClick={() => download(`${book.title}.md`, toMarkdown(book), 'text/markdown')}>Book as Markdown</button>
        <button className="alt" onClick={() => download(`${book.title}-backup.json`, JSON.stringify(book), 'application/json')}>Full backup (JSON)</button>
      </div>
      <h2>GitHub sync</h2>
      <p className="muted">Use a private data repo (e.g. <code>you/bookwriting-data</code>, with a <code>main</code> branch) and a fine-grained token with Contents read/write on that repo only. Stored only in this browser.</p>
      <label>Data repo<input value={s.repo} placeholder="owner/bookwriting-data" onChange={(e) => edit({ repo: e.target.value.trim() })} /></label>
      <label>Token<input type="password" value={s.token} onChange={(e) => edit({ token: e.target.value.trim() })} /></label>
      <label className="check">
        <input type="checkbox" checked={s.auto !== false} onChange={(e) => edit({ auto: e.target.checked })} />
        Sync automatically (on open, when you return to the app, and 20 seconds after you stop typing)
      </label>
      <div className="row">
        <button disabled={busy} onClick={() => runSync()}>Sync now</button>
      </div>
      <p>{dirty ? '● Unsynced local changes' : '✓ Everything synced'}</p>
      <p>{text}</p>
      <details>
        <summary>Advanced: force one side to win</summary>
        <div className="row" style={{ paddingTop: '.5rem' }}>
          <button className="danger" disabled={busy} onClick={() => confirm('Replace EVERYTHING on this device with what is on GitHub?') && runSync('pull')}>Replace local with GitHub</button>
          <button className="danger" disabled={busy} onClick={() => confirm('Replace EVERYTHING on GitHub with what is on this device?') && runSync('push')}>Replace GitHub with local</button>
        </div>
      </details>
      {import.meta.env.DEV && (
        <button className="alt" onClick={() => confirm('Replace this dev copy with the sample book?') && useBook.getState().replace(sampleBook(), false)}>
          Load sample book (dev only)
        </button>
      )}
    </div>
  )
}
