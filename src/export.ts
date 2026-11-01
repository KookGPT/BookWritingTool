import { strToU8, zipSync } from 'fflate'
import type { Book } from './store'

// Chapters are Tiptap HTML (p, h2, blockquote, ul/li, strong, em, hr, br), regular enough to tokenize without a DOM.
export interface Run { t: string; b?: boolean; i?: boolean }
export interface Block { kind: 'p' | 'h' | 'quote' | 'li' | 'hr'; runs: Run[] }

const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function blocks(html: string): Block[] {
  const out: Block[] = []
  let cur: Block | null = null
  let b = false, i = false, quote = false, li = false
  for (const tok of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (tok[0] !== '<') { if (cur) cur.runs.push({ t: decode(tok), b, i }); continue }
    const m = /^<(\/?)(\w+)/.exec(tok)
    if (!m) continue
    const close = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (tag === 'strong' || tag === 'b') b = !close
    else if (tag === 'em' || tag === 'i') i = !close
    else if (tag === 'blockquote') quote = !close
    else if (tag === 'li') li = !close
    else if (tag === 'br') cur?.runs.push({ t: '\n' })
    else if (tag === 'hr') out.push({ kind: 'hr', runs: [] })
    else if (tag === 'p' || /^h\d$/.test(tag)) {
      if (close) cur = null
      else { cur = { kind: tag === 'p' ? (li ? 'li' : quote ? 'quote' : 'p') : 'h', runs: [] }; out.push(cur) }
    }
  }
  return out.filter((x) => x.kind === 'hr' || x.runs.some((r) => r.t.trim()))
}

const download = (name: string, data: Uint8Array, type: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')

// ---------- DOCX ----------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const run = (r: Run) =>
  r.t === '\n' ? '<w:r><w:br/></w:r>'
    : `<w:r><w:rPr>${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`
const para = (style: string, ppr: string, runs: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${ppr}</w:pPr>${runs}</w:p>`

export function docxFiles(book: Book): Record<string, Uint8Array> {
  const body: string[] = [para('Title', '', run({ t: book.title }))]
  for (const c of book.chapters) {
    body.push(para('Heading1', '<w:pageBreakBefore/>', run({ t: c.title })))
    for (const bl of blocks(c.body)) {
      const runs = bl.runs.map(run).join('')
      if (bl.kind === 'hr') body.push(para('Normal', '<w:jc w:val="center"/>', run({ t: '* * *' })))
      else if (bl.kind === 'h') body.push(para('Heading2', '', runs))
      else if (bl.kind === 'quote') body.push(para('Normal', '<w:ind w:left="720" w:right="720"/>', runs))
      else if (bl.kind === 'li') body.push(para('Normal', '<w:ind w:left="720" w:hanging="360"/>', run({ t: '• ' }) + runs))
      else body.push(para('Normal', '<w:ind w:firstLine="720"/>', runs))
    }
  }
  const style = (id: string, name: string, ppr: string, rpr: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/></w:pPr></w:style>
${style('Title', 'Title', '<w:spacing w:before="3600" w:after="480"/><w:jc w:val="center"/>', '<w:b/><w:sz w:val="56"/>')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="480" w:after="480"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="36"/>')}
${style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="28"/>')}
</w:styles>`
  return {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'word/styles.xml': strToU8(styles),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  }
}

// ---------- EPUB ----------
const xhtml = (title: string, inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" href="style.css"/></head><body>${inner}</body></html>`
const inline = (runs: Run[]) =>
  runs.map((r) => {
    if (r.t === '\n') return '<br/>'
    let s = esc(r.t)
    if (r.b) s = `<strong>${s}</strong>`
    if (r.i) s = `<em>${s}</em>`
    return s
  }).join('')

export function epubFiles(book: Book, id = crypto.randomUUID(), now = new Date()): Record<string, Uint8Array | [Uint8Array, { level: 0 }]> {
  const chapters = book.chapters.map((c, n) => ({
    file: `ch${n + 1}.xhtml`, title: c.title,
    html: xhtml(c.title, `<h1>${esc(c.title)}</h1>` + blocks(c.body).map((bl) =>
      bl.kind === 'hr' ? '<hr/>' : bl.kind === 'h' ? `<h2>${inline(bl.runs)}</h2>` : bl.kind === 'quote' ? `<blockquote><p>${inline(bl.runs)}</p></blockquote>`
        : bl.kind === 'li' ? `<p class="li">• ${inline(bl.runs)}</p>` : `<p>${inline(bl.runs)}</p>`).join('')),
  }))
  const f = (s: string) => strToU8(s)
  const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:${id}</dc:identifier><dc:title>${esc(book.title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${chapters.map((c, n) => `<item id="c${n + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, n) => `<itemref idref="c${n + 1}"/>`).join('')}</spine></package>`
  return {
    mimetype: [f('application/epub+zip'), { level: 0 }], // must be first and uncompressed
    'META-INF/container.xml': f(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'OEBPS/content.opf': f(opf),
    'OEBPS/nav.xhtml': f(xhtml('Contents', `<nav epub:type="toc"><h1>${esc(book.title)}</h1><ol>${chapters.map((c) => `<li><a href="${c.file}">${esc(c.title)}</a></li>`).join('')}</ol></nav>`)),
    'OEBPS/style.css': f('body{font-family:serif;line-height:1.5}h1{text-align:center;margin:2em 0 1em}p{margin:0;text-indent:1.5em}p.li{text-indent:0;margin-left:1.5em}blockquote{margin:1em 2em}hr{border:0;text-align:center}hr::after{content:"* * *"}'),
    ...Object.fromEntries(chapters.map((c) => [`OEBPS/${c.file}`, f(c.html)])),
  }
}

export const saveDocx = (book: Book) => download(`${safe(book.title)}.docx`, zipSync(docxFiles(book)), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
export const saveEpub = (book: Book) => download(`${safe(book.title)}.epub`, zipSync(epubFiles(book)), 'application/epub+zip')
