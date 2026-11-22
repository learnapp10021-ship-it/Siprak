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
// Fungsi (bukan konstanta) supaya tetap benar bila aplikasi dibiarkan terbuka melewati tengah malam
export const today = todayStr

export const D = d =>
  d
    ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
    : 'belum diisi'

export const days = d =>
  Math.max(0, Math.round((Date.parse(today()) - Date.parse(d.slice(0, 10))) / 864e5))
export const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
export const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)
// Dibulatkan 6 desimal agar jumlah pecahan (Kg, Meter) tidak bergeser akibat floating point
export const sum = (a, f) => Math.round(a.reduce((s, x) => s + (+f(x) || 0), 0) * 1e6) / 1e6
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s))
// ID berikutnya dari nomor TERBESAR yang ada (bukan jumlah baris), mis. nextId(db.R, 'RQ-')
export const nextId = (rows, prefix, key = 'id', width = 3) =>
  prefix + String(rows.reduce((m, r) => Math.max(m, parseInt(String(r[key]).slice(prefix.length), 10) || 0), 0) + 1).padStart(width, '0')
export const f1 = x => (x == null ? '-' : String(Math.round(x * 10) / 10).replace('.', ','))
export const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
