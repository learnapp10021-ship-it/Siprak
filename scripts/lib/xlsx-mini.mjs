// Pembaca .xlsx minimal TANPA dependensi (zip + XML via modul bawaan Node).
// Cukup untuk memeriksa isi sheet SIPRAK: berkas dari Google Sheets (File > Download > .xlsx) maupun templat repo.
// Hanya membaca nilai sel (teks, angka, string bersama); rumus dan format diabaikan.
import fs from 'node:fs'
import zlib from 'node:zlib'

const unesc = s =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]
  })

// ---- zip ----
export function unzip(buf) {
  let e = buf.length - 22
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--
  if (e < 0) throw new Error('Bukan berkas .xlsx yang valid (zip tidak ditemukan).')
  const n = buf.readUInt16LE(e + 10)
  let p = buf.readUInt32LE(e + 16)
  const files = {}
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Direktori zip rusak.')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nl = buf.readUInt16LE(p + 28)
    const el = buf.readUInt16LE(p + 30)
    const cl = buf.readUInt16LE(p + 32)
    const lo = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nl)
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28)
    const raw = buf.subarray(ds, ds + csize)
    files[name] = () => (method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : (() => { throw new Error('Kompresi zip tidak didukung: ' + method) })()).toString('utf8')
    p += 46 + nl + el + cl
  }
  return files
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))
  return m ? unesc(m[1]) : ''
}
const colNum = ref => [...ref.replace(/\d+/g, '')].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1
const texts = x => [...x.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('')
const num = v => (/e/i.test(v) && isFinite(+v) ? (+v).toLocaleString('fullwide', { useGrouping: false }) : v)

// Hasil: { NamaSheet: [[sel, ...], ...] } dengan baris kosong di ujung dibuang.
export function bacaXlsx(path) {
  const z = unzip(fs.readFileSync(path))
  const get = n => (z[n] ? z[n]() : null)
  const wb = get('xl/workbook.xml')
  if (!wb) throw new Error('Bukan berkas .xlsx yang valid (workbook.xml tidak ada).')
  const rels = {}
  for (const m of (get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    let t = attr(m[0], 'Target').replace(/^\//, '')
    if (!t.startsWith('xl/')) t = 'xl/' + t
    rels[attr(m[0], 'Id')] = t
  }
  const shared = [...(get('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]))
  const out = {}
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const file = rels[attr(m[0], 'r:id')]
    const xml = file && get(file)
    if (!xml) continue
    const rows = []
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const ri = +attr(rm[1], 'r') - 1
      const row = []
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = attr(cm[1], 't')
        const body = cm[2] || ''
        let v = ''
        if (t === 'inlineStr') v = texts(body)
        else {
          const vm = body.match(/<v>([\s\S]*?)<\/v>/)
          if (vm) v = t === 's' ? shared[+vm[1]] ?? '' : t === 'b' ? (vm[1] === '1' ? 'TRUE' : 'FALSE') : t === 'str' || t === 'e' ? unesc(vm[1]) : num(vm[1])
        }
        row[colNum(attr(cm[1], 'r'))] = String(v).trim()
      }
      rows[ri] = Array.from(row, x => x ?? '')
    }
    const dense = Array.from(rows, r => r || [])
    while (dense.length && dense[dense.length - 1].every(c => c === '')) dense.pop()
    out[attr(m[0], 'name')] = dense
  }
  return out
}
