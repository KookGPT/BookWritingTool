import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { zipSync } from 'fflate'
import { blocks, docxFiles, epubFiles } from '../src/export.ts'

const html = '<h2>Head</h2><p>Plain <strong>bold</strong> and <em>ital</em> &amp; more</p><blockquote><p>quoted</p></blockquote><ul><li><p>item</p></li></ul><hr><p></p><p>line<br>two</p>'
const b = blocks(html)
assert.deepEqual(b.map((x) => x.kind), ['h', 'p', 'quote', 'li', 'hr', 'p'])
assert.equal(b[1].runs.map((r) => r.t).join(''), 'Plain bold and ital & more')
assert.ok(b[1].runs.find((r) => r.t === 'bold')?.b && b[1].runs.find((r) => r.t === 'ital')?.i)

const book = { title: 'Test & Book', chapters: [{ id: '1', title: 'One', body: html, status: 'draft', notes: '' }] } as never
const docx = docxFiles(book)
assert.ok(docx['word/document.xml'] && docx['[Content_Types].xml'])
assert.match(new TextDecoder().decode(docx['word/document.xml']), /Test &amp; Book/)
const epub = epubFiles(book, 'id-1', new Date('2026-01-01T00:00:00Z'))
assert.equal(Object.keys(epub)[0], 'mimetype')
assert.ok(epub['OEBPS/ch1.xhtml'])

// write real files so they can be opened/validated outside the test
mkdirSync('test/out', { recursive: true })
writeFileSync('test/out/sample.docx', zipSync(docx))
writeFileSync('test/out/sample.epub', zipSync(epub))
console.log('export: all checks passed')
