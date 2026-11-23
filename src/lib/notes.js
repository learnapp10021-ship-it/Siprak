import { makeSel } from './selectors'

// Hitungan antrean kerja per menu (badge merah). Dipakai Shell dan notifikasi perubahan.
export function badgeCounts(db, sel, me) {
  const ad = me.role == 'Admin Dept'
  const aw = me.role == 'Admin Warehouse'
  return {
    appr: db.R.filter(r => r.st == 'Menunggu Approval' && sel.user(r.by)?.boss == me.id).length,
    pool: ad ? sel.poolOf(me.dept).length : 0,
    kon: ad ? db.K.filter(k => k.dept == me.dept && k.tahap == 'Konsolidasi').length : 0,
    val: aw ? new Set(db.K.filter(k => k.tahap == 'Validasi Warehouse').map(k => k.srl)).size : 0,
    dtg: aw ? db.K.filter(k => k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0).length : 0,
    srh: aw ? db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).length : 0,
  }
}

const BARU = {
  appr: n => `${n} request baru menunggu persetujuan Anda`,
  pool: n => `${n} barang baru siap dibuat ERO`,
  val: n => `${n} SRL baru menunggu validasi`,
  dtg: n => `${n} SRL baru menunggu kedatangan`,
  srh: n => `${n} barang baru siap diserahkan`,
}

// Ringkasan perubahan yang dibawa data baru dari server (ditulis user lain) dan relevan untuk `meId`.
// Mengembalikan daftar kalimat singkat (maksimal 3 baris), kosong bila tidak ada yang relevan.
export function incomingNotes(prev, next, meId) {
  if (!prev?.U?.length || !next?.U?.length) return []
  const sp = makeSel(prev)
  const sn = makeSel(next)
  const me = sn.user(meId)
  if (!me || !sp.user(meId)) return []
  const out = []

  // 1. Status request & barang milik saya yang berubah
  const rOld = new Map(prev.R.map(r => [r.id, r.st]))
  const iOld = new Map(prev.I.map(i => [i.id, i.status]))
  const mine = new Set(next.R.filter(r => r.by == meId).map(r => r.id))
  const rChanged = new Set()
  next.R.filter(r => r.by == meId && rOld.has(r.id) && rOld.get(r.id) !== r.st).forEach(r => {
    rChanged.add(r.id)
    out.push(`${r.id}: ${r.st}${r.st == 'Ditolak' && r.cat ? ` (${r.cat})` : ''}`)
  })
  next.I.filter(i => mine.has(i.req) && !rChanged.has(i.req) && iOld.has(i.id) && iOld.get(i.id) !== i.status).forEach(i =>
    out.push(`${sn.mi(i.kode)?.n || i.kode}: ${i.status}`)
  )

  // 2. Antrean kerja yang bertambah
  const a = badgeCounts(prev, sp, sp.user(meId))
  const b = badgeCounts(next, sn, me)
  Object.keys(BARU).forEach(k => {
    if (b[k] > a[k]) out.push(BARU[k](b[k] - a[k]))
  })

  return out.length > 3 ? [...out.slice(0, 3), `+${out.length - 3} perubahan lain`] : out
}

// Nama aksi yang ramah dibaca, untuk status "Menyimpan …"
export const AKSI = {
  saveUser: 'data pengguna', saveRequest: 'request', ajukan: 'pengajuan request', batal: 'pembatalan request',
  setuju: 'persetujuan', setujuAll: 'persetujuan massal', tolak: 'penolakan', tahan: 'penahanan barang',
  lepas: 'pelepasan tahan', simpanSrl: 'SRL', tutup: 'penutupan sisa', datang: 'kedatangan barang',
  datangAll: 'kedatangan barang', datangBatch: 'kedatangan barang', serah: 'serah terima', serahAll: 'serah terima', saveMaster: 'master item',
  importMaster: 'impor master item', keluarkan: 'pengeluaran barang dari SRL', validasiSrl: 'validasi SRL', ingat: 'pengingat',
}
