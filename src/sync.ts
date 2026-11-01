import { create } from 'zustand'
import { merge, type Files, type Shas } from './merge'
import { type Book, emptyBook, uid, useBook } from './store'

// Book <-> files in a private GitHub repo. One file per item keeps git diffs readable and merges per item.
export const toFiles = (b: Book): Files => {
  const f: Files = {
    'book.json': JSON.stringify({
      title: b.title,
      chapterOrder: b.chapters.map((c) => c.id),
      sceneOrder: b.scenes.map((s) => s.id),
      ideaOrder: b.ideas.map((i) => i.id),
      threadOrder: b.threads.map((t) => t.id),
    }, null, 2),
    'stats.json': JSON.stringify(b.stats, null, 2),
    'config.json': JSON.stringify(b.config, null, 2),
  }
  for (const c of b.chapters) f[`chapters/${c.id}.json`] = JSON.stringify(c, null, 2)
  for (const w of b.wiki) f[`wiki/${w.id}.json`] = JSON.stringify(w, null, 2)
  for (const s of b.scenes) f[`scenes/${s.id}.json`] = JSON.stringify(s, null, 2)
  for (const i of b.ideas) f[`ideas/${i.id}.json`] = JSON.stringify(i, null, 2)
  for (const t of b.threads) f[`threads/${t.id}.json`] = JSON.stringify(t, null, 2)
  for (const m of b.maps) f[`maps/${m.id}.json`] = JSON.stringify(m)
  return f
}

const ordered = <T extends { id: string }>(items: T[], order: string[] = []) => {
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i }
  return [...items].sort((a, b) => rank(a.id) - rank(b.id))
}

export const fromFiles = (f: Files): Book => {
  const meta = f['book.json'] ? JSON.parse(f['book.json']) : {}
  const dir = (p: string) => Object.keys(f).filter((k) => k.startsWith(p)).map((k) => JSON.parse(f[k]))
  return {
    ...emptyBook(),
    title: meta.title ?? emptyBook().title,
    chapters: ordered(dir('chapters/'), meta.chapterOrder),
    scenes: ordered(dir('scenes/'), meta.sceneOrder),
    ideas: ordered(dir('ideas/'), meta.ideaOrder),
    threads: ordered(dir('threads/'), meta.threadOrder),
    wiki: dir('wiki/'),
    maps: dir('maps/'),
    config: f['config.json'] ? JSON.parse(f['config.json']) : emptyBook().config,
    stats: f['stats.json'] ? JSON.parse(f['stats.json']) : emptyBook().stats,
  }
}

const isEmpty = (b: Book) => !(b.chapters.length || b.threads.length || b.wiki.length || b.ideas.length || b.scenes.length || b.maps.length)

export interface Settings { token: string; repo: string; auto?: boolean } // repo = "owner/name"
const SKEY = 'sync-settings'
const HKEY = 'sync-head'
const BKEY = 'sync-base'
export const loadSettings = (): Settings => {
  try { return JSON.parse(localStorage.getItem(SKEY) ?? '') } catch { return { token: '', repo: '' } }
}
export const saveSettings = (s: Settings) => localStorage.setItem(SKEY, JSON.stringify(s))
const loadBase = (): Shas => { try { return JSON.parse(localStorage.getItem(BKEY) ?? '') } catch { return {} } }

const api = async (s: Settings, path: string, init?: RequestInit) => {
  const r = await fetch(`https://api.github.com/repos/${s.repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/vnd.github+json', ...init?.headers },
  })
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const post = (s: Settings, path: string, body: unknown, method = 'POST') =>
  api(s, path, { method, body: JSON.stringify(body) })

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)))

// Git's own blob hash, so local files can be compared to GitHub's tree without downloading anything.
const gitSha = async (text: string) => {
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const buf = new Uint8Array(head.length + body.length)
  buf.set(head)
  buf.set(body, head.length)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map((x) => x.toString(16).padStart(2, '0')).join('')
}
const shas = async (f: Files): Promise<Shas> =>
  Object.fromEntries(await Promise.all(Object.entries(f).map(async ([p, c]) => [p, await gitSha(c)])))

export type Mode = 'normal' | 'pull' | 'push' // pull/push = the other side is overwritten

// Returns a message, or 'retry' if you typed while it was working (nothing was changed in that case).
export async function sync(s: Settings, mode: Mode = 'normal'): Promise<string> {
  const book0 = useBook.getState().book
  const headSha: string = (await api(s, '/git/ref/heads/main')).object.sha
  if (mode === 'normal' && headSha === localStorage.getItem(HKEY) && !useBook.getState().dirty) return 'In sync.'

  const treeSha: string = (await api(s, `/git/commits/${headSha}`)).tree.sha
  const tree = await api(s, `/git/trees/${treeSha}?recursive=1`)
  const remote: Shas = Object.fromEntries(
    tree.tree.filter((t: { type: string; path: string }) => t.type === 'blob' && t.path.endsWith('.json')).map((t: { path: string; sha: string }) => [t.path, t.sha]),
  )

  let local = toFiles(book0)
  let base = loadBase()
  if (mode === 'pull') { local = {}; base = {} }
  else if (mode === 'push') base = { ...remote }
  else if (!localStorage.getItem(BKEY) && Object.keys(remote).length) {
    if (!isEmpty(book0)) throw new Error('This device and GitHub both already have data. Open Advanced and choose which one wins.')
    local = {} // brand-new device: plain pull
  }

  const lsha = await shas(local)
  const { out, conflicts } = await merge({
    local, lsha, remote, base, newId: uid,
    blob: async (sha) => decode((await api(s, `/git/blobs/${sha}`)).content),
  })
  const merged = fromFiles(out)
  const files = toFiles(merged) // what this device will regenerate, so later comparisons are consistent
  const fsha = await shas(files)

  const changedHere = Object.keys(fsha).some((p) => fsha[p] !== lsha[p]) || Object.keys(lsha).some((p) => !(p in fsha))
  const pushNeeded = Object.keys(fsha).some((p) => fsha[p] !== remote[p]) || Object.keys(remote).some((p) => !(p in fsha))

  if (changedHere) {
    if (useBook.getState().book !== book0) return 'retry'
    useBook.getState().replace(merged, pushNeeded)
  }
  const applied = changedHere ? merged : book0

  let head = headSha
  if (pushNeeded) {
    const entries: { path: string; mode: string; type: string; sha: string | null }[] = await Promise.all(
      Object.keys(files).filter((p) => fsha[p] !== remote[p]).map(async (p) => ({
        path: p, mode: '100644', type: 'blob', sha: (await post(s, '/git/blobs', { content: files[p], encoding: 'utf-8' })).sha as string,
      })),
    )
    for (const p of Object.keys(remote)) if (!(p in files)) entries.push({ path: p, mode: '100644', type: 'blob', sha: null })
    const newTree = await post(s, '/git/trees', { base_tree: treeSha, tree: entries })
    const commit = await post(s, '/git/commits', { message: `Sync ${new Date().toISOString()}`, tree: newTree.sha, parents: [headSha] })
    await post(s, '/git/refs/heads/main', { sha: commit.sha }, 'PATCH')
    head = commit.sha
  }
  localStorage.setItem(HKEY, head)
  localStorage.setItem(BKEY, JSON.stringify(fsha))
  useBook.getState().markSynced(applied)

  const note = conflicts ? ` ${conflicts} item(s) edited on both devices: yours kept, the other saved as "(other device)".` : ''
  return (pushNeeded ? 'Synced.' : changedHere ? 'Pulled changes from GitHub.' : 'Up to date.') + note
}

export const useSyncStatus = create<{ text: string; busy: boolean }>(() => ({ text: '', busy: false }))

export async function runSync(mode: Mode = 'normal'): Promise<void> {
  const s = loadSettings()
  if (!s.token || !s.repo || useSyncStatus.getState().busy) return
  useSyncStatus.setState({ busy: true, text: 'Syncing...' })
  try {
    let r = await sync(s, mode)
    if (r === 'retry') { await new Promise((ok) => setTimeout(ok, 2000)); r = await sync(s, mode) }
    useSyncStatus.setState({ text: r === 'retry' ? 'Busy, will retry.' : r })
  } catch (e) {
    useSyncStatus.setState({ text: String(e) })
  } finally {
    useSyncStatus.setState({ busy: false })
  }
}
