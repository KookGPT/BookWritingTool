import { useState } from 'react'
import { useBook } from './store'
import { loadSettings, pull, push, saveSettings, status } from './sync'

const STATUS_MSG = {
  'in-sync': 'In sync.',
  'local-ahead': 'You have unsynced local changes: push.',
  'remote-ahead': 'Remote has newer changes: pull.',
  conflict: 'Conflict: both changed. Push (keep mine) or pull (keep theirs).',
}

export default function Settings() {
  const [s, setS] = useState(loadSettings)
  const [msg, setMsg] = useState('')
  const { book, dirty, update, replace } = useBook()
  const run = async (fn: () => Promise<string>) => {
    saveSettings(s)
    setMsg('Working...')
    try { setMsg(await fn()) } catch (e) { setMsg(String(e)) }
  }
  const doPull = async () => { replace(await pull(s), false); return 'Pulled from GitHub.' }
  const doPush = async () => { await push(s, book); replace(book, false); return 'Pushed to GitHub.' }

  return (
    <div className="page">
      <h1>Settings and Sync</h1>
      <label>Book title<input value={book.title} onChange={(e) => update((b) => ({ ...b, title: e.target.value }))} /></label>
      <h2>GitHub sync</h2>
      <p className="muted">Use a private data repo (e.g. <code>you/bookwriting-data</code>, with a <code>main</code> branch) and a fine-grained token with Contents read/write on that repo only. Stored only in this browser.</p>
      <label>Data repo<input value={s.repo} placeholder="owner/bookwriting-data" onChange={(e) => setS({ ...s, repo: e.target.value.trim() })} /></label>
      <label>Token<input type="password" value={s.token} onChange={(e) => setS({ ...s, token: e.target.value.trim() })} /></label>
      <div className="row">
        <button onClick={() => run(async () => STATUS_MSG[await status(s, dirty)])}>Check</button>
        <button onClick={() => run(doPull)}>Pull (keep theirs)</button>
        <button onClick={() => run(doPush)}>Push (keep mine)</button>
      </div>
      <p>{dirty ? '● Unsynced local changes' : '✓ Nothing unsynced'}</p>
      <p>{msg}</p>
    </div>
  )
}
