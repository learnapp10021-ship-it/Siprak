import { D, TODAY, addDays, cleanMaster, nowStr, sum, wa } from './utils'

// Setiap aksi: (sel, d, ...args) => { err } | { ok } | undefined
// `d` adalah draft immer (boleh dimutasi), `sel` selector atas draft yang sama.
// Jika mengembalikan { err }, perubahan dibuang oleh store.

const pad3 = n => String(n).padStart(3, '0')
const setR = (d, id, s) => {
  d.R.find(r => r.id == id).st = s
  d.I.filter(i => i.req == id).forEach(i => {
    if (!['Ditolak', 'Dibatalkan'].includes(i.status)) i.status = s
  })
}

// Validasi baris barang (dipakai saat simpan dan saat Ajukan draft). Mengembalikan pesan galat atau ''.
const checkLines = (sel, lines) => {
  for (const x of lines) {
    const m = x.kode && sel.mi(x.kode)
    if (!m) return 'Pilih barang di setiap baris.'
    if (!(+x.qty > 0)) return 'Jumlah harus lebih dari 0.'
    if (!x.datang || x.datang < addDays(TODAY, +m.lead))
      return `${m.n}: tgl datang paling cepat ${D(addDays(TODAY, +m.lead))}.`
    if (m.buf == '0' && !x.pakai) return `${m.n}: tgl pakai wajib untuk barang non buffer.`
    if (x.pakai && x.pakai < x.datang) return `${m.n}: tgl pakai tidak boleh sebelum tgl datang.`
  }
  return ''
}

// Pastikan request masih di salah satu status yang diizinkan (layar bisa usang saat dua orang bekerja bersamaan).
const reqIn = (d, id, ...sts) => {
  const r = d.R.find(x => x.id == id)
  return r && sts.includes(r.st) ? r : null
}
const STALE = 'Status request sudah berubah. Muat ulang halaman.'

export const actions = {
  saveUser(sel, d, f) {
    const { mode, self, id, n, rawWa, email, role, boss, dept, active, me } = f
    const w = wa(rawWa)
    if (!n) return { err: 'Isi nama.' }
    if (rawWa && !w) return { err: 'Nomor WhatsApp tidak valid. Contoh: 081234567890.' }
    if (mode == 'new') {
      const e = (email || '').toLowerCase()
      if (!e.includes('@')) return { err: 'Isi email yang valid.' }
      if (d.U.find(u => u.id == e)) return { err: 'Email sudah terdaftar.' }
      if (!w) return { err: 'Nomor WhatsApp wajib diisi untuk pengguna baru.' }
      if (role == 'User' && !boss) return { err: 'Pilih atasan untuk user, supaya request bisa disetujui.' }
      const dp = me.role == 'Admin Warehouse' ? dept : me.dept
      if (!dp) return { err: 'Isi departemen.' }
      d.U.push({ id: e, n, dept: dp, role, boss: boss || '' })
      d.HP[e] = w
      return { ok: 'Pengguna ditambahkan.' }
    }
    if (!self && role == 'User' && !boss) return { err: 'Pilih atasan untuk user, supaya request bisa disetujui.' }
    const u = d.U.find(x => x.id == id)
    u.n = n
    if (w) d.HP[u.id] = w
    else delete d.HP[u.id]
    if (!self) {
      u.role = role
      u.boss = boss || ''
      if (dept) u.dept = dept
      if (active !== undefined) u.off = !active
    }
    return { ok: 'Perubahan disimpan.' }
  },

  saveRequest(sel, d, { status, lines, me }) {
    if (me.off) return { err: 'Akun nonaktif tidak bisa membuat request.' }
    if (!lines.length) return { err: 'Tambahkan minimal satu barang.' }
    if (status == 'Menunggu Approval' && !me.boss)
      return { err: 'Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.' }
    const bad = checkLines(sel, lines)
    if (bad) return { err: bad }
    const id = 'RQ-' + pad3(d.R.length + 1)
    d.R.push({ id, by: me.id, tgl: TODAY, st: status, cat: '' })
    lines.forEach(x =>
      d.I.push({
        id: 'ITM-' + pad3(d.I.length + 1), req: id, kode: x.kode, qty: x.qty, datang: x.datang,
        pakai: x.pakai, status, appr: '', kon: '', tahan: '', alasan: '',
      })
    )
    return { ok: status == 'Draft' ? 'Draft disimpan.' : 'Diajukan ke atasan.' }
  },

  ajukan(sel, d, id) {
    const r = reqIn(d, id, 'Draft')
    if (!r) return { err: STALE }
    const u = sel.user(r.by)
    if (!u?.boss)
      return { err: 'Akun Anda belum punya atasan. Hubungi admin departemen agar atasan diisi.' }
    const bad = checkLines(sel, d.I.filter(i => i.req == id))
    if (bad) return { err: bad + ' Buat ulang request dengan tanggal yang baru.' }
    setR(d, id, 'Menunggu Approval')
    return { ok: 'Diajukan ke atasan.' }
  },
  batal(sel, d, id) {
    if (!reqIn(d, id, 'Draft', 'Menunggu Approval')) return { err: STALE }
    setR(d, id, 'Dibatalkan')
    return { ok: 'Request dibatalkan.' }
  },

  setuju(sel, d, id) {
    const r = reqIn(d, id, 'Menunggu Approval')
    if (!r) return { err: STALE }
    r.st = 'Disetujui'
    d.I.filter(i => i.req == id).forEach(i => {
      i.status = 'Approved'
      i.appr = nowStr()
    })
    const dp = sel.user(r.by).dept
    const ad = d.U.find(u => u.role == 'Admin Dept' && u.dept == dp && !u.off)
    return {
      ok: ad
        ? `Disetujui. Diteruskan ke ${ad.n} (Admin ${dp}).`
        : `Disetujui, tapi belum ada Admin Dept aktif di ${dp}. Hubungi Admin Warehouse.`,
    }
  },
  setujuAll(sel, d, meId) {
    const l = d.R.filter(r => r.st == 'Menunggu Approval' && sel.user(r.by)?.boss == meId)
    if (!l.length) return { err: 'Tidak ada request yang menunggu.' }
    l.forEach(r => {
      r.st = 'Disetujui'
      d.I.filter(i => i.req == r.id).forEach(i => {
        i.status = 'Approved'
        i.appr = nowStr()
      })
    })
    return { ok: l.length + ' request disetujui dan diteruskan ke admin departemen.' }
  },
  tolak(sel, d, id, catatan) {
    if (!catatan) return { err: 'Isi catatan sebelum menolak.' }
    const r = reqIn(d, id, 'Menunggu Approval')
    if (!r) return { err: STALE }
    r.cat = catatan
    setR(d, id, 'Ditolak')
    return { ok: 'Ditolak.' }
  },

  tahan(sel, d, id, alasan) {
    if (!alasan) return { err: 'Isi alasan menahan.' }
    const i = d.I.find(x => x.id == id)
    if (!i || i.status != 'Approved' || i.kon) return { err: 'Barang sudah diproses, tidak bisa ditahan. Muat ulang halaman.' }
    i.tahan = 'Y'
    i.alasan = alasan
    return { ok: 'Ditahan.' }
  },
  lepas(sel, d, id) {
    const i = d.I.find(x => x.id == id)
    if (!i || i.status != 'Approved' || i.kon) return { err: 'Barang sudah diproses. Muat ulang halaman.' }
    i.tahan = ''
    i.alasan = ''
    return { ok: 'Tahan dilepas.' }
  },

  simpanSrl(sel, d, { no, est, me }) {
    const dept = me.dept
    const p = sel.poolOf(dept)
    if (!no) return { err: 'Isi nomor SRL dari ERO.' }
    if (d.L.find(l => l.no == no)) return { err: 'Nomor SRL ini sudah pernah disimpan.' }
    if (!p.length) return { err: 'Tidak ada request yang siap diproses.' }
    d.L.push({ no, dept, est })
    const g = {}
    p.forEach(i => (g[i.kode] = g[i.kode] || []).push(i))
    let n = Math.max(0, ...d.K.map(k => +k.id.slice(4)))
    Object.entries(g).forEach(([k, a]) => {
      const id = 'KON-' + pad3(++n)
      d.K.push({ id, dept, by: me.n, kode: k, tahap: 'Validasi Warehouse', srl: no, ero: String(sum(a, i => i.qty)), tutup: '0', alasan: '' })
      a.forEach(i => {
        i.status = 'Validasi Warehouse'
        i.kon = id
        i.alasan = ''
      })
    })
    return { ok: `${p.length} request masuk ${no}. Menunggu validasi Admin Warehouse.` }
  },

  tutup(sel, d, id, alasan) {
    if (!alasan) return { err: 'Isi alasan menutup sisa.' }
    const k = d.K.find(x => x.id == id)
    if (!k || k.tahap != 'Sudah di ERO') return { err: 'Konsolidasi ini belum/tidak aktif di ERO. Muat ulang halaman.' }
    const s = sel.sisa(k)
    if (!(s > 0)) return { err: 'Tidak ada sisa untuk ditutup.' }
    k.alasan = alasan
    k.tutup = String(+k.tutup + s)
    return { ok: 'Sisa ditutup.' }
  },

  datang(sel, d, { id, q, l, cat, by }) {
    const k = sel.KN(id)
    if (!k || k.tahap != 'Sudah di ERO') return { err: 'SRL ini belum divalidasi. Kedatangan belum bisa dicatat.' }
    if (q < 0 || l < 0) return { err: 'Jumlah tidak boleh negatif.' }
    if (!(q > 0) && !(l > 0)) return { err: 'Isi Qty datang.' }
    if (q > sel.sisa(k)) return { err: 'Qty datang melebihi sisa (' + sel.sisa(k) + ').' }
    if (l > 0 && !cat) return { err: 'Isi catatan untuk kelebihan.' }
    d.KD.push({ kon: id, qty: String(q), lebih: String(l), by, cat, tgl: TODAY })
    return { ok: 'Kedatangan dicatat.' }
  },
  datangAll(sel, d, no, by) {
    const a = d.K.filter(k => k.srl == no && k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0)
    if (!a.length) return { err: 'Tidak ada sisa untuk dicatat.' }
    a.forEach(k => d.KD.push({ kon: k.id, qty: String(sel.sisa(k)), lebih: '0', by, cat: '', tgl: TODAY }))
    return { ok: a.length + ' barang dicatat datang sesuai jumlah di ' + no + '.' }
  },

  serah(sel, d, id, q) {
    const i = d.I.find(x => x.id == id)
    const mx = sel.siap(i)
    if (!(q > 0) || q > mx) return { err: 'Qty harus antara 1 dan ' + mx + '.' }
    d.SR.push({ item: id, qty: String(q), to: sel.nm(sel.RQ(i.req).by), tgl: TODAY })
    return { ok: 'Diserahkan.' }
  },

  saveMaster(sel, d, { mode, f }) {
    const r = cleanMaster(f)
    if (r.err) return { err: r.err + '.' }
    const { err, ...row } = r
    const ex = d.M.find(m => m.k == row.k)
    if (mode == 'new') {
      if (ex) return { err: 'Kode ' + row.k + ' sudah ada.' }
      d.M.push(row)
      return { ok: 'Item ditambahkan.' }
    }
    if (!ex) return { err: 'Item tidak ditemukan.' }
    Object.assign(ex, row)
    return { ok: 'Item disimpan.' }
  },
  importMaster(sel, d, rows) {
    const ok = rows.filter(r => !r.err)
    if (!ok.length) return { err: 'Tidak ada baris yang valid.' }
    let baru = 0
    let ubah = 0
    ok.forEach(r => {
      const { err, ...row } = r
      const ex = d.M.find(m => m.k == row.k)
      if (ex) { Object.assign(ex, row); ubah++ } else { d.M.push(row); baru++ }
    })
    return { ok: `${baru} item baru, ${ubah} item diperbarui.` }
  },

  // Admin Warehouse memeriksa SRL dari Admin Dept: barang yang tidak sesuai dikeluarkan (kembali ke Pool), sisanya divalidasi.
  keluarkan(sel, d, { ids, alasan, by }) {
    if (!alasan) return { err: 'Isi alasan mengeluarkan barang.' }
    const kons = new Set()
    let n = 0
    let srl = ''
    ids.forEach(id => {
      const i = d.I.find(x => x.id == id)
      if (!i || i.status != 'Validasi Warehouse') return
      const k = d.K.find(x => x.id == i.kon)
      srl = k?.srl || srl
      kons.add(i.kon)
      i.status = 'Approved'
      i.kon = ''
      i.tahan = ''
      i.alasan = `Dikeluarkan Warehouse (${by}) dari ${srl}: ${alasan}`
      n++
    })
    if (!n) return { err: 'Barang tidak ditemukan atau sudah divalidasi.' }
    kons.forEach(kid => {
      const k = d.K.find(x => x.id == kid)
      const rest = d.I.filter(x => x.kon == kid && x.status == 'Validasi Warehouse')
      if (rest.length) k.ero = String(sum(rest, x => x.qty))
      else {
        k.tahap = 'Dikeluarkan'
        k.ero = '0'
        k.alasan = alasan
      }
    })
    return { ok: `${n} barang dikeluarkan dari ${srl} dan dikembalikan ke Pool Admin Dept.` }
  },
  validasiSrl(sel, d, no) {
    const ks = d.K.filter(k => k.srl == no && k.tahap == 'Validasi Warehouse')
    if (!ks.length) return { err: 'SRL ini tidak sedang menunggu validasi.' }
    let n = 0
    ks.forEach(k => {
      k.tahap = 'Sudah di ERO'
      d.I.filter(i => i.kon == k.id && i.status == 'Validasi Warehouse').forEach(i => {
        i.status = 'Sudah di ERO'
        n++
      })
    })
    return { ok: `${no} divalidasi: ${n} barang menunggu kedatangan.` }
  },

  serahAll(sel, d, ids) {
    let n = 0
    let to = ''
    ids.forEach(id => {
      const i = d.I.find(x => x.id == id)
      const q = i ? sel.siap(i) : 0
      if (!(q > 0)) return
      to = sel.nm(sel.RQ(i.req).by)
      d.SR.push({ item: id, qty: String(q), to, tgl: TODAY })
      n++
    })
    if (!n) return { err: 'Tidak ada barang yang siap diserahkan.' }
    return { ok: n + ' barang diserahkan ke ' + to + '.' }
  },

  ingat(sel, d, id, by) {
    d.RM.push({ item: id, by, at: nowStr() })
  },
}
