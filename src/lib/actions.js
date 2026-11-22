import { D, TODAY, addDays, nowStr, sum, wa } from './utils'

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
    const { mi } = sel
    if (me.off) return { err: 'Akun nonaktif tidak bisa membuat request.' }
    if (status == 'Menunggu Approval' && !me.boss)
      return { err: 'Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.' }
    for (const x of lines) {
      const m = x.kode && mi(x.kode)
      if (!m) return { err: 'Pilih barang di setiap baris.' }
      if (!(+x.qty > 0)) return { err: 'Jumlah harus lebih dari 0.' }
      if (!x.datang || x.datang < addDays(TODAY, +m.lead))
        return { err: `${m.n}: tgl datang paling cepat ${D(addDays(TODAY, +m.lead))}.` }
      if (m.buf == '0' && !x.pakai) return { err: `${m.n}: tgl pakai wajib untuk barang non buffer.` }
      if (x.pakai && x.pakai < x.datang) return { err: `${m.n}: tgl pakai tidak boleh sebelum tgl datang.` }
    }
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
    setR(d, id, 'Menunggu Approval')
    return { ok: 'Diajukan ke atasan.' }
  },
  batal(sel, d, id) {
    setR(d, id, 'Dibatalkan')
    return { ok: 'Request dibatalkan.' }
  },

  setuju(sel, d, id) {
    const r = d.R.find(x => x.id == id)
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
    d.R.find(x => x.id == id).cat = catatan
    setR(d, id, 'Ditolak')
    return { ok: 'Ditolak.' }
  },

  tahan(sel, d, id, alasan) {
    if (!alasan) return { err: 'Isi alasan menahan.' }
    const i = d.I.find(x => x.id == id)
    i.tahan = 'Y'
    i.alasan = alasan
    return { ok: 'Ditahan.' }
  },
  lepas(sel, d, id) {
    const i = d.I.find(x => x.id == id)
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
    let n = Math.max(...d.K.map(k => +k.id.slice(4)))
    Object.entries(g).forEach(([k, a]) => {
      const id = 'KON-' + pad3(++n)
      d.K.push({ id, dept, by: me.n, kode: k, tahap: 'Sudah di ERO', srl: no, ero: String(sum(a, i => i.qty)), tutup: '0', alasan: '' })
      a.forEach(i => {
        i.status = 'Sudah di ERO'
        i.kon = id
      })
    })
    return { ok: `${p.length} request masuk ${no}. Status otomatis Sudah di ERO.` }
  },

  tutup(sel, d, id, alasan) {
    if (!alasan) return { err: 'Isi alasan menutup sisa.' }
    const k = d.K.find(x => x.id == id)
    const s = sel.sisa(k)
    k.alasan = alasan
    k.tutup = String(+k.tutup + s)
    return { ok: 'Sisa ditutup.' }
  },

  datang(sel, d, { id, q, l, cat, by }) {
    const k = sel.KN(id)
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

  ingat(sel, d, id, by) {
    d.RM.push({ item: id, by, at: nowStr() })
  },

  // ---- Cek SRL oleh Admin Warehouse ----
  cekSrl(sel, d, no, by) {
    const l = d.L.find(x => x.no == no)
    if (!l) return { err: 'SRL tidak ditemukan.' }
    l.cek = 'Y'
    l.cekby = by
    l.cekat = nowStr()
    return { ok: no + ' ditandai selesai dicek.' }
  },

  // Barang di SRL yang ternyata tidak bisa diorder: keluarkan, kembalikan request ke Admin Dept (ditahan) + riwayat.
  keluarkan(sel, d, { kon, alasan, by }) {
    const k = d.K.find(x => x.id == kon)
    if (!k || k.tahap != 'Sudah di ERO') return { err: 'Barang ini tidak ada di SRL aktif.' }
    if (!alasan) return { err: 'Isi alasan barang dikeluarkan.' }
    if (sel.datang(k) > 0) return { err: 'Barang ini sudah ada yang datang. Gunakan "Tutup sisa" oleh Admin Dept.' }
    const items = d.I.filter(i => i.kon == k.id && sel.live(i))
    const qty = sum(items, i => i.qty)
    items.forEach(i => {
      i.status = 'Approved'
      i.kon = ''
      i.tahan = 'Y'
      i.alasan = `Dikeluarkan dari ${k.srl} oleh Warehouse: ${alasan}`
    })
    k.tahap = 'Dikeluarkan'
    k.alasan = alasan
    k.tutup = '0'
    d.H = d.H || []
    d.H.push({ at: nowStr(), jenis: 'Dikeluarkan', srl: k.srl, kon: k.id, kode: k.kode, qty: String(qty), by, alasan, item: items.map(i => i.id).join(',') })
    return { ok: `${sel.mi(k.kode).n} dikeluarkan dari ${k.srl}. ${items.length} request kembali ke Admin ${k.dept}.` }
  },

  // Catat pengingat ke Admin Dept untuk barang yang dikeluarkan
  ingatKeluar(sel, d, { kon, by }) {
    const o = (d.H || []).find(h => h.jenis == 'Dikeluarkan' && h.kon == kon)
    if (!o) return { err: 'Riwayat tidak ditemukan.' }
    d.H.push({ at: nowStr(), jenis: 'Diingatkan', srl: o.srl, kon, kode: o.kode, qty: o.qty, by, alasan: '', item: o.item })
  },

  // ---- Master item (Admin Warehouse) ----
  simpanMaster(sel, d, { mode, k, n, sat, buf, kons, lead }) {
    const kode = String(k || '').trim().toUpperCase().replace(/\s+/g, '-')
    n = String(n || '').trim()
    sat = String(sat || '').trim()
    if (!kode) return { err: 'Isi kode barang.' }
    if (!n) return { err: 'Isi nama barang.' }
    if (!sat) return { err: 'Isi satuan.' }
    if (!/^\d+$/.test(String(lead).trim())) return { err: 'Lead time harus angka hari (0 atau lebih).' }
    const row = { k: kode, n, sat, buf: buf ? '1' : '0', kons: kons ? '1' : '0', lead: String(+lead) }
    if (mode == 'new') {
      if (d.M.find(x => x.k.toUpperCase() == kode)) return { err: 'Kode ' + kode + ' sudah dipakai.' }
      d.M.push({ ...row, off: '' })
      return { ok: n + ' ditambahkan ke master.' }
    }
    const m = d.M.find(x => x.k == k)
    if (!m) return { err: 'Barang tidak ditemukan.' }
    Object.assign(m, { n, sat, buf: row.buf, kons: row.kons, lead: row.lead })
    return { ok: 'Perubahan ' + n + ' disimpan.' }
  },
  masterOff(sel, d, k, off) {
    const m = d.M.find(x => x.k == k)
    if (!m) return { err: 'Barang tidak ditemukan.' }
    m.off = off ? 'Y' : ''
    return { ok: m.n + (off ? ' dinonaktifkan. Tidak muncul di request baru.' : ' diaktifkan lagi.') }
  },
}
