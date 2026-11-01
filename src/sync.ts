import { type Book, emptyBook } from './store'

// Book <-> files in a private GitHub repo. One file per chapter/wiki entry keeps git diffs readable.
export const toFiles = (b: Book): Record<string, string> => {
  const f: Record<string, string> = {
    'book.json': JSON.stringify({ title: b.title, chapterOrder: b.chapters.map((c) => c.id) }, null, 2),
    'ideas.json': JSON.stringify(b.ideas, null, 2),
    'scenes.json': JSON.stringify(b.scenes, null, 2),
  }
  for (const c of b.chapters) f[`chapters/${c.id}.json`] = JSON.stringify(c, null, 2)
  for (const w of b.wiki) f[`wiki/${w.id}.json`] = JSON.stringify(w, null, 2)
  for (const m of b.maps) f[`maps/${m.id}.json`] = JSON.stringify(m)
  return f
}

export const fromFiles = (f: Record<string, string>): Book => {
  const meta = f['book.json'] ? JSON.parse(f['book.json']) : {}
  const dir = (p: string) => Object.keys(f).filter((k) => k.startsWith(p)).map((k) => JSON.parse(f[k]))
  const chapters = dir('chapters/')
  const order: string[] = meta.chapterOrder ?? []
  chapters.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  return {
    ...emptyBook(),
    title: meta.title ?? emptyBook().title,
    chapters,
    wiki: dir('wiki/'),
    maps: dir('maps/'),
    ideas: f['ideas.json'] ? JSON.parse(f['ideas.json']) : [],
    scenes: f['scenes.json'] ? JSON.parse(f['scenes.json']) : [],
  }
}

export interface Settings { token: string; repo: string } // repo = "owner/name"
const SKEY = 'sync-settings'
const HKEY = 'sync-head'
export const loadSettings = (): Settings => {
  try { return JSON.parse(localStorage.getItem(SKEY) ?? '') } catch { return { token: '', repo: '' } }
}
export const saveSettings = (s: Settings) => localStorage.setItem(SKEY, JSON.stringify(s))
const lastHead = () => localStorage.getItem(HKEY)
const setLastHead = (h: string) => localStorage.setItem(HKEY, h)

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

const head = async (s: Settings): Promise<string> => (await api(s, '/git/ref/heads/main')).object.sha

export type SyncStatus = 'in-sync' | 'remote-ahead' | 'local-ahead' | 'conflict'

// ponytail: whole-book granularity; conflict = both sides changed, user picks a winner. Per-file merge if it bites.
export const status = async (s: Settings, dirty: boolean): Promise<SyncStatus> => {
  const remoteChanged = (await head(s)) !== lastHead()
  return remoteChanged ? (dirty ? 'conflict' : 'remote-ahead') : dirty ? 'local-ahead' : 'in-sync'
}

export const pull = async (s: Settings): Promise<Book> => {
  const sha = await head(s)
  const tree = await api(s, `/git/trees/${sha}?recursive=1`)
  const files: Record<string, string> = {}
  await Promise.all(
    tree.tree
      .filter((t: { type: string; path: string }) => t.type === 'blob' && t.path.endsWith('.json'))
      .map(async (t: { path: string; sha: string }) => { files[t.path] = decode((await api(s, `/git/blobs/${t.sha}`)).content) }),
  )
  setLastHead(sha)
  return fromFiles(files)
}

export const push = async (s: Settings, book: Book): Promise<void> => {
  const parent = await head(s)
  const baseTree = (await api(s, `/git/commits/${parent}`)).tree.sha
  const files = toFiles(book)
  const old = await api(s, `/git/trees/${baseTree}?recursive=1`)
  const entries: { path: string; mode: string; type: string; sha: string | null }[] = []
  for (const [path, content] of Object.entries(files)) {
    const blob = await post(s, '/git/blobs', { content, encoding: 'utf-8' })
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  for (const t of old.tree)
    if (t.type === 'blob' && t.path.endsWith('.json') && !(t.path in files)) entries.push({ path: t.path, mode: '100644', type: 'blob', sha: null })
  const tree = await post(s, '/git/trees', { base_tree: baseTree, tree: entries })
  const commit = await post(s, '/git/commits', { message: `Sync ${new Date().toISOString()}`, tree: tree.sha, parents: [parent] })
  await post(s, '/git/refs/heads/main', { sha: commit.sha }, 'PATCH')
  setLastHead(commit.sha)
}
