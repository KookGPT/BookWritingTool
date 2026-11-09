// Before/after contact sheet for the Locations standard shots.
//   node scripts/loc-sheet.ts <before-prefix> <after-prefix> [test/out/sheet.html]
// Pairs test/out/shots/<before><rest>.jpg with <after><rest>.jpg (take both sets with `await locScene.standard('<prefix>')`
// in the browser pane) and writes one page with each pair side by side. Shots in only one set are listed too.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const [before, after, out = 'test/out/sheet.html'] = process.argv.slice(2)
if (!before || !after) { console.log('usage: node scripts/loc-sheet.ts <before-prefix> <after-prefix> [out.html]'); process.exit(1) }
const dir = 'test/out/shots', files = readdirSync(dir).filter((f) => f.endsWith('.jpg'))
const rest = (p: string) => new Set(files.filter((f) => f.startsWith(p)).map((f) => f.slice(p.length, -4)))
const a = rest(before), b = rest(after), names = [...new Set([...a, ...b])].sort()
// images go inside the page, so it opens anywhere (a static preview, a copy sent elsewhere)
const cell = (p: string, n: string, has: Set<string>) => (has.has(n) ? `<img src="data:image/jpeg;base64,${readFileSync(`${dir}/${p}${n}.jpg`).toString('base64')}">` : '<div class="none">missing</div>')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${before} vs ${after}</title>
<style>body{background:#1b1b1f;color:#ddd;font:14px system-ui;margin:16px}h2{font-size:14px;margin:18px 0 6px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;display:block}.none{display:grid;place-items:center;aspect-ratio:16/9;background:#2a2a30;color:#888}</style>
<h1>${before} (left) vs ${after} (right): ${names.length} shots</h1>
${names.map((n) => `<h2>${n}</h2><div class="row">${cell(before, n, a)}${cell(after, n, b)}</div>`).join('\n')}`)
console.log(`${out}: ${names.length} shots, ${[...a].filter((n) => b.has(n)).length} paired, ${names.filter((n) => !a.has(n)).length} only after, ${names.filter((n) => !b.has(n)).length} only before`)
