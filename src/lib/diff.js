// Mengubah selisih dua snapshot db menjadi operasi untuk server: { t, op: 'add'|'set', row }.
// Aksi di actions.js tetap murni (immer); penyimpanan tinggal membandingkan sebelum/sesudah.

const KEYED = { U: 'id', M: 'k', R: 'id', I: 'id', K: 'id', L: 'no' }
const APPEND = ['KD', 'SR', 'RM', 'H'] // hanya bertambah di akhir

// U di sheet memuat nomor WA (db.HP) dan penanda nonaktif (off)
const userRows = db => db.U.map(u => ({ ...u, hp: db.HP[u.id] || '', off: u.off ? 'Y' : '' }))

export function diffDb(a, b) {
  if (a === b) return []
  const ops = []

  for (const t of Object.keys(KEYED)) {
    const key = KEYED[t]
    const ra = t === 'U' ? userRows(a) : a[t]
    const rb = t === 'U' ? userRows(b) : b[t]
    if (t !== 'U' && ra === rb) continue
    const old = new Map(ra.map(r => [r[key], r]))
    for (const r of rb) {
      const o = old.get(r[key])
      if (!o) ops.push({ t, op: 'add', row: r })
      else if (o !== r && JSON.stringify(o) !== JSON.stringify(r)) ops.push({ t, op: 'set', row: r })
    }
  }

  for (const t of APPEND) {
    for (let i = (a[t] || []).length; i < (b[t] || []).length; i++) ops.push({ t, op: 'add', row: b[t][i] })
  }
  return ops
}

export const emptyDb = () => ({ U: [], HP: {}, M: [], R: [], I: [], K: [], L: [], KD: [], SR: [], RM: [], H: [] })
