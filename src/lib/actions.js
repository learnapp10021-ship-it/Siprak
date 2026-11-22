import { D, TODAY, addDays, nowStr, sum, wa, nextId, minsAgo, cleanMaster } from './utils'

// Setiap aksi: (sel, d, ...args) => { err } | { ok } | undefined
// `d` adalah draft immer / salinan data (boleh dimutasi), `sel` selector atas data yang sama.
// Jika mengembalikan { err }, perubahan dibuang.
//
// Aksi ini dipakai dua kali dengan kode yang sama:
//  - di browser (validasi cepat sebelum kirim, dan mode demo lokal)
//  - di server Google Apps Script, di dalam LockService, atas data TERBARU dari spreadsheet.
// Karena itu semua pemeriksaan status ("sudah diproses orang lain?") harus ada di sini.

const setR = (d, id, s) => {
  d.R.find(r => r.id == id).st = s
  d.I.filter(i => i.req == id).forEach(i => {
    if (!['Ditolak', 'Dibatalkan'].includes(i.status)) i.status = s
  })
}

// Dua entri identik dalam rentang ini dianggap input ganda (klik ulang, dua admin menginput hal yang sama)
const DUP_MENIT = 2

// Validasi baris barang (dipakai saat simpan dan saat Ajukan draft). Mengembalikan pesan galat atau ''.
const checkLines = (sel, lines) => {
  for (const x of lines) {
    const m = x.kode && sel.mi(x.kode)
    if (!m) return 'Pilih barang di setiap baris.'
    if (!(+x.qty > 0) || !isFinite(+x.qty)) return 'Jumlah harus lebih dari 0.'
    if (!x.datang || x.datang < addDays(TODAY, +m.lead))
      return `${m.n}: tgl datang paling cepat ${D(addDays(TODAY, +m.lead))}.`
    if (m.buf == '0' && !x.pakai) return `${m.n}: tgl pakai wajib untuk barang non buffer.`
    if (x.pakai && x.pakai < x.datang) return `${m.n}: tgl pakai tidak boleh sebelum tgl datang.`
  }
  return ''
}

const sidik = ls => ls.map(x => [x.kode, +x.qty, x.datang, x.pakai || ''].join('~')).sort().join('|')

export const actions = {
  saveUser(sel, d, f) {
    const { mode, self, id, n, rawWa, email, role, boss, dept, active, me, baseV } = f
    const w = wa(rawWa)
    if (!n) return { err: 'Isi nama.' }
    if (rawWa && !w) return { err: 'Nomor WhatsApp tidak valid. Contoh: 081234567890.' }
    if (boss && !d.U.find(x => x.id == boss)) return { err: 'Atasan yang dipilih tidak ditemukan.' }
    if (mode == 'new') {
      const e = (email || '').toLowerCase()
      if (!e.includes('@')) return { err: 'Isi email yang valid.' }
      if (d.U.find(u => String(u.id).toLowerCase() == e)) return { err: 'Email sudah terdaftar.' }
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
    if (!u) return { err: 'Pengguna tidak ditemukan.' }
    // Jangan menimpa perubahan orang lain: versi baris harus sama dengan yang dilihat pengguna
    if (baseV !== undefined && String(u._v == null ? '' : u._v) !== String(baseV == null ? '' : baseV))
      return { err: 'Data pengguna ini baru saja diubah orang lain. Tutup lalu buka lagi untuk melihat data terbaru.' }
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
    if (!['Draft', 'Menunggu Approval'].includes(status)) return { err: 'Status request tidak valid.' }
    if (!Array.isArray(lines) || !lines.length) return { err: 'Tambahkan minimal satu barang.' }
    if (lines.length > 50) return { err: 'Maksimal 50 barang per request.' }
    if (me.off) return { err: 'Akun nonaktif tidak bisa membuat request.' }
    if (status == 'Menunggu Approval' && !me.boss)
      return { err: 'Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.' }
    const bad = checkLines(sel, lines)
    if (bad) return { err: bad }
    // Penjaga duplikat: request identik dari orang yang sama dalam beberapa menit terakhir
    const fp = sidik(lines)
    const kembar = d.R.find(
      r => r.by == me.id && r.st == status && minsAgo(r.at) <= DUP_MENIT && sidik(d.I.filter(i => i.req == r.id)) == fp
    )
    if (kembar) return { err: `Request yang sama sudah tersimpan sebagai ${kembar.id} beberapa saat lalu. Tidak dibuat ganda.` }

    const id = nextId(d.R, 'RQ-')
    d.R.push({ id, by: me.id, tgl: TODAY, st: status, cat: '', at: nowStr() })
    lines.forEach(x =>
      d.I.push({
        id: nextId(d.I, 'ITM-'), req: id, kode: x.kode, qty: String(+x.qty), datang: x.datang,
        pakai: x.pakai || '', status, appr: '', kon: '', tahan: '', alasan: '',
      })
    )
    return { ok: (status == 'Draft' ? 'Draft disimpan' : 'Diajukan ke atasan') + ' sebagai ' + id + '.' }
  },

  ajukan(sel, d, id) {
    const r = sel.RQ(id)
    if (!r) return { err: 'Request tidak ditemukan.' }
    if (r.st != 'Draft') return { err: `Request ${id} sudah tidak berstatus draft (sekarang: ${r.st}).` }
    if (!sel.user(r.by)?.boss) return { err: 'Akun Anda belum punya atasan. Hubungi admin departemen.' }
    const bad = checkLines(sel, d.I.filter(i => i.req == id))
    if (bad) return { err: bad + ' Buat ulang request dengan tanggal yang baru.' }
    setR(d, id, 'Menunggu Approval')
    return { ok: 'Diajukan ke atasan.' }
  },
  batal(sel, d, id) {
    const r = sel.RQ(id)
    if (!r) return { err: 'Request tidak ditemukan.' }
    if (!['Draft', 'Menunggu Approval'].includes(r.st))
      return { err: `Request ${id} tidak bisa dibatalkan lagi (sekarang: ${r.st}).` }
    setR(d, id, 'Dibatalkan')
    return { ok: 'Request dibatalkan.' }
  },

  setuju(sel, d, id) {
    const r = sel.RQ(id)
    if (!r) return { err: 'Request tidak ditemukan.' }
    if (r.st != 'Menunggu Approval') return { err: `Request ${id} sudah diproses (sekarang: ${r.st}).` }
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
  // ids (opsional): hanya request yang tadi terlihat di layar, supaya request baru yang masuk
  // setelah layar dimuat tidak ikut disetujui tanpa dilihat.
  setujuAll(sel, d, meId, ids) {
    const l = d.R.filter(
      r => r.st == 'Menunggu Approval' && sel.user(r.by)?.boss == meId && (!Array.isArray(ids) || ids.includes(r.id))
    )
    if (!l.length) return { err: 'Tidak ada request yang menunggu (mungkin sudah diproses).' }
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
    const r = sel.RQ(id)
    if (!r) return { err: 'Request tidak ditemukan.' }
    if (r.st != 'Menunggu Approval') return { err: `Request ${id} sudah diproses (sekarang: ${r.st}).` }
    r.cat = catatan
    setR(d, id, 'Ditolak')
    return { ok: 'Ditolak.' }
  },

  tahan(sel, d, id, alasan) {
    if (!alasan) return { err: 'Isi alasan menahan.' }
    const i = d.I.find(x => x.id == id)
    if (!i) return { err: 'Barang tidak ditemukan.' }
    if (i.status != 'Approved' || i.kon) return { err: 'Barang ini sudah tidak ada di pool (sudah diproses ke ERO).' }
    if (i.tahan) return { err: 'Barang ini sudah ditahan.' }
    i.tahan = 'Y'
    i.alasan = alasan
    return { ok: 'Ditahan.' }
  },
  lepas(sel, d, id) {
    const i = d.I.find(x => x.id == id)
    if (!i) return { err: 'Barang tidak ditemukan.' }
    if (i.status != 'Approved' || i.kon) return { err: 'Barang sudah diproses ke ERO. Muat ulang halaman.' }
    if (!i.tahan) return { err: 'Barang ini sudah tidak ditahan.' }
    i.tahan = ''
    i.alasan = ''
    return { ok: 'Tahan dilepas.' }
  },

  // ids (opsional): barang yang tadi terlihat siap diproses. Jika salah satunya sudah ditahan atau
  // diproses orang lain, seluruh simpan ditolak agar SRL tidak berisi barang yang tidak dilihat admin.
  simpanSrl(sel, d, { no, est, me, ids }) {
    const dept = me.dept
    let p = sel.poolOf(dept)
    if (!no) return { err: 'Isi nomor SRL dari ERO.' }
    if (d.L.find(l => String(l.no).trim().toUpperCase() == String(no).trim().toUpperCase()))
      return { err: 'Nomor SRL ini sudah pernah disimpan.' }
    if (Array.isArray(ids)) {
      const ada = new Set(p.map(i => i.id))
      if (ids.some(x => !ada.has(x)))
        return { err: 'Daftar pool berubah (ada barang yang baru ditahan atau sudah diproses). Periksa daftar terbaru lalu simpan lagi.' }
      p = p.filter(i => ids.includes(i.id))
    }
    if (!p.length) return { err: 'Tidak ada request yang siap diproses.' }
    d.L.push({ no, dept, est: est || '' })
    const g = {}
    p.forEach(i => (g[i.kode] = g[i.kode] || []).push(i))
    Object.entries(g).forEach(([k, a]) => {
      const id = nextId(d.K, 'KON-')
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
    if (!k) return { err: 'Konsolidasi tidak ditemukan.' }
    if (k.tahap != 'Sudah di ERO') return { err: 'Konsolidasi ini belum/tidak aktif di ERO. Muat ulang halaman.' }
    const s = sel.sisa(k)
    if (!(s > 0)) return { err: 'Tidak ada sisa untuk ditutup (sudah datang semua atau sudah ditutup).' }
    k.alasan = alasan
    k.tutup = String(+k.tutup + s)
    return { ok: 'Sisa ditutup.' }
  },

  datang(sel, d, { id, q, l, cat, by }) {
    const k = sel.KN(id)
    if (!k) return { err: 'Konsolidasi tidak ditemukan.' }
    if (k.tahap != 'Sudah di ERO') return { err: 'SRL ini belum divalidasi. Kedatangan belum bisa dicatat.' }
    if (!(q > 0) && !(l > 0)) return { err: 'Isi Qty datang.' }
    if (q < 0 || l < 0) return { err: 'Qty tidak boleh negatif.' }
    if (q > sel.sisa(k)) return { err: 'Qty datang melebihi sisa (' + sel.sisa(k) + ').' }
    if (l > 0 && !cat) return { err: 'Isi catatan untuk kelebihan.' }
    const kembar = d.KD.find(
      x => x.kon == id && +x.qty == +q && +x.lebih == +l && minsAgo(x.at) <= DUP_MENIT
    )
    if (kembar) return { err: 'Kedatangan yang sama baru saja dicatat. Tidak dicatat ganda. Periksa jumlah datang terbaru.' }
    d.KD.push({ id: nextId(d.KD, 'KD-'), kon: id, qty: String(q), lebih: String(l), by, cat, tgl: TODAY, at: nowStr() })
    return { ok: 'Kedatangan dicatat.' }
  },
  datangAll(sel, d, no, by) {
    const a = d.K.filter(k => k.srl == no && k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0)
    if (!a.length) return { err: 'Tidak ada sisa untuk dicatat (mungkin sudah dicatat orang lain).' }
    a.forEach(k =>
      d.KD.push({ id: nextId(d.KD, 'KD-'), kon: k.id, qty: String(sel.sisa(k)), lebih: '0', by, cat: '', tgl: TODAY, at: nowStr() })
    )
    return { ok: a.length + ' barang dicatat datang sesuai jumlah di ' + no + '.' }
  },

  serah(sel, d, id, q) {
    const i = d.I.find(x => x.id == id)
    if (!i) return { err: 'Barang tidak ditemukan.' }
    if (i.status != 'Sudah di ERO') return { err: 'Barang ini belum berstatus Sudah di ERO.' }
    const mx = sel.siap(i)
    if (!(q > 0) || q > mx) return { err: 'Qty harus antara 1 dan ' + mx + '. (Mungkin sudah diserahkan oleh admin lain.)' }
    const kembar = d.SR.find(x => x.item == id && +x.qty == +q && minsAgo(x.at) <= DUP_MENIT)
    if (kembar) return { err: 'Serah terima yang sama baru saja dicatat. Tidak dicatat ganda.' }
    d.SR.push({ id: nextId(d.SR, 'SR-'), item: id, qty: String(q), to: sel.nm(sel.RQ(i.req).by), tgl: TODAY, at: nowStr() })
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
    if (!Array.isArray(rows) || rows.length > 3000) return { err: 'Impor maksimal 3000 baris sekali jalan.' }
    const ok = rows.map(cleanMaster).filter(r => !r.err) // dibersihkan ulang di server
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
    ;(ids || []).forEach(id => {
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
    if (!ks.length) return { err: 'SRL ini tidak sedang menunggu validasi (mungkin sudah divalidasi admin lain).' }
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
    ;(ids || []).forEach(id => {
      const i = d.I.find(x => x.id == id)
      const q = i && i.status == 'Sudah di ERO' ? sel.siap(i) : 0
      if (!(q > 0)) return
      to = sel.nm(sel.RQ(i.req).by)
      d.SR.push({ id: nextId(d.SR, 'SR-'), item: id, qty: String(q), to, tgl: TODAY, at: nowStr() })
      n++
    })
    if (!n) return { err: 'Tidak ada barang yang siap diserahkan (mungkin sudah diserahkan admin lain).' }
    return { ok: n + ' barang diserahkan ke ' + to + '.' }
  },

  ingat(sel, d, id, by) {
    if (!d.I.find(x => x.id == id)) return { err: 'Barang tidak ditemukan.' }
    // pengingat berulang dari orang yang sama dalam 1 menit tidak dicatat ganda (tanpa pesan)
    if (d.RM.find(x => x.item == id && x.by == by && minsAgo(x.at) <= 1)) return
    d.RM.push({ id: nextId(d.RM, 'RM-'), item: id, by, at: nowStr() })
  },
}
