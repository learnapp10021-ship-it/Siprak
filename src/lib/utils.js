// Parser tabel teks "a|b|c" -> array objek
export const T = (s, k) =>
  s.trim().split('\n').map(l => Object.fromEntries(l.split('|').map((v, i) => [k[i], v])))

// Nomor WhatsApp: normalisasi ke 628xxxxxxxxx, kosong jika tidak valid
export const wa = s => {
  let d = String(s || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '62' + d.slice(1)
  return /^628\d{8,11}$/.test(d) ? d : ''
}
export const disp = d => (d ? '0' + d.slice(2) : '')

const pad = n => String(n).padStart(2, '0')
// Tanggal lokal (bukan UTC) supaya tidak mundur sehari di zona Asia/Jakarta
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const nowStr = () => {
  const d = new Date()
  return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const TODAY = todayStr()

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
// Format tanggal pendek Indonesia, tanpa Intl supaya sama di browser dan Google Apps Script
export const D = d => (d ? +d.slice(8, 10) + ' ' + BLN[+d.slice(5, 7) - 1] : 'belum diisi')

export const days = d =>
  Math.max(0, Math.round((Date.parse(TODAY) - Date.parse(d.slice(0, 10))) / 864e5))
export const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
export const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)
export const sum = (a, f) => a.reduce((s, x) => s + +f(x), 0)
export const f1 = x => (x == null ? '-' : String(Math.round(x * 10) / 10).replace('.', ','))
export const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

// ID unik berikutnya, berdasarkan nomor terbesar yang ada (bukan jumlah baris).
// Di server dipanggil di dalam lock atas data terbaru, sehingga tidak pernah bentrok.
export const nextId = (rows, prefix, key = 'id') => {
  let m = 0
  for (const r of rows) {
    const s = String(r[key] == null ? '' : r[key])
    if (s.startsWith(prefix)) {
      const n = parseInt(s.slice(prefix.length), 10)
      if (n > m) m = n
    }
  }
  return prefix + String(m + 1).padStart(3, '0')
}

// Selisih menit antara sekarang dan sebuah stempel waktu (Infinity jika kosong)
export const minsAgo = at => {
  const t = at ? Date.parse(at) : NaN
  return isNaN(t) ? Infinity : (Date.parse(nowStr()) - t) / 6e4
}

// Master item: normalisasi dan parser tempel dari Excel/CSV.
export const flag = v => (/^(1|y|ya|yes|true|buffer|konsinyasi)$/i.test(String(v ?? '').trim()) ? '1' : '0')
export function cleanMaster(r) {
  const k = String(r.k || '').trim().toUpperCase().replace(/\s+/g, '-')
  const n = String(r.n || '').trim()
  const sat = String(r.sat || '').trim()
  const lead = r.lead === '' || r.lead == null ? '3' : String(r.lead).trim()
  let err = ''
  if (!k) err = 'Kode kosong'
  else if (!n) err = 'Nama kosong'
  else if (!sat) err = 'Satuan kosong'
  else if (!/^\d+$/.test(lead)) err = 'Lead time harus angka hari'
  return { k, n, sat, buf: flag(r.buf), kons: flag(r.kons), lead, err }
}
// Urutan kolom: Kode | Nama | Satuan | Buffer | Konsinyasi | Lead time (hari). Pemisah: tab, ; | atau koma.
export function parseMaster(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = [/\t/, /;/, /\|/, /,/].find(re => re.test(lines[0])) || /\t/
  const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')))
  if (/^(kode|code|item)/i.test(rows[0][0]) && !/^[A-Z]{2,}-?\d/.test(rows[0][0])) rows.shift()
  return rows.map(c => cleanMaster({ k: c[0], n: c[1], sat: c[2], buf: c[3], kons: c[4], lead: c[5] }))
}
