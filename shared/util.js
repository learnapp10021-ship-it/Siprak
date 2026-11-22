// Helper murni (tanpa DOM, tanpa Intl) agar bisa jalan di browser DAN Google Apps Script.

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

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const D = d => (d ? `${+d.slice(8, 10)} ${BLN[+d.slice(5, 7) - 1]}` : 'belum diisi')

export const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)
export const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
export const daysSince = (d, today) => Math.max(0, dayDiff(d.slice(0, 10), today))
export const sum = (a, f) => a.reduce((s, x) => s + +f(x), 0)
export const f1 = x => (x == null ? '-' : String(Math.round(x * 10) / 10).replace('.', ','))
export const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const pad = (n, w = 2) => String(n).padStart(w, '0')
