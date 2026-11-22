import { D, addDays, isDate, nextId, nowStr, sum, today, wa } from './utils'

// Setiap aksi: (sel, d, ...args) => { err } | { ok } | undefined
// `d` adalah draft immer (boleh dimutasi), `sel` selector atas draft yang sama.
// Jika mengembalikan { err }, perubahan dibuang oleh store.
//
// Aturan umum:
//  - Setiap aksi memeriksa ulang status data saat ini (bukan percaya tombol di layar), karena layar bisa
//    basi bila pengguna lain sudah mengubah data.
//  - Kolom by/to di tabel log menyimpan ID pengguna (bukan nama), agar relasi tetap benar saat nama diganti.

const EPS = 1e-9
const ROLES = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']
const dead = s => s == 'Ditolak' || s == 'Dibatalkan'
const num = v => (v === '' || v == null ? NaN : +v)

const reqIn = (d, id, allowed) => {
  const r = d.R.find(x => x.id == id)
  if (!r) return { err: 'Request tidak ditemukan. Muat ulang halaman.' }
  if (!allowed.includes(r.st)) return { err: `${id} sudah berstatus "${r.st}", aksi ini tidak bisa dilakukan.` }
  return { r }
}

// Mengubah status request dan semua barang yang masih hidup di dalamnya
const setR = (d, id, s) => {
  d.R.find(r => r.id == id).st = s
  d.I.filter(i => i.req == id).forEach(i => {
    if (!dead(i.status)) i.status = s
  })
}

// Pesan galat bila pengguna tidak bisa mengajukan ke atasan; null bila boleh
const bossErr = (sel, u) => {
  if (!u?.boss) return 'Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.'
  const b = sel.user(u.boss)
  if (!b) return 'Atasan Anda tidak ditemukan di daftar pengguna. Hubungi admin departemen.'
  if (b.off) return `Atasan Anda (${b.n}) nonaktif. Hubungi admin departemen untuk menggantinya.`
  return null
}

// Pengguna aktif dengan peran tertentu (diambil dari data terkini, bukan objek lama di layar)
const actor = (sel, id, role) => {
  const u = sel.user(id)
  if (!u || u.off) return { err: 'Pengguna tidak dikenal atau nonaktif.' }
  if (role && u.role != role) return { err: `Aksi ini hanya untuk ${role}.` }
  return { u }
}

// Apakah `boss` berada di atas `id` pada rantai atasan (mencegah rantai atasan berputar)
const above = (d, id, boss) => {
  const seen = new Set()
  for (let c = boss; c && !seen.has(c); c = d.U.find(u => u.id == c)?.boss) {
    if (c == id) return true
    seen.add(c)
  }
  return false
}

export const actions = {
  saveUser(sel, d, f) {
    const { mode, self, id, n, rawWa, email, role, boss, dept, active, me } = f
    const a = actor(sel, me?.id)
    if (a.err) return a
    const admin = a.u.role == 'Admin Warehouse' || a.u.role == 'Admin Dept'
    const w = wa(rawWa)
    if (!n) return { err: 'Isi nama.' }
    if (rawWa && !w) return { err: 'Nomor WhatsApp tidak valid. Contoh: 081234567890.' }

    // Aturan atasan: harus ada, berperan Atasan, bukan diri sendiri, tidak membuat rantai berputar
    const bossCheck = (uid, r, dp) => {
      if (r == 'User' && !boss) return 'Pilih atasan untuk user, supaya request bisa disetujui.'
      if (!boss) return null
      const b = d.U.find(x => x.id == boss)
      if (!b) return 'Atasan tidak ditemukan.'
      if (b.role != 'Atasan') return `${b.n} bukan berperan Atasan.`
      if (b.off) return `${b.n} nonaktif, pilih atasan lain.`
      if (uid && above(d, uid, boss)) return 'Atasan tidak valid: membuat rantai atasan berputar.'
      if (a.u.role == 'Admin Dept' && b.dept != dp) return 'Atasan harus dari departemen yang sama.'
      return null
    }

    if (mode == 'new') {
      if (!admin) return { err: 'Hanya admin yang bisa menambah pengguna.' }
      const e = (email || '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+$/.test(e)) return { err: 'Isi email yang valid.' }
      if (d.U.find(u => u.id.toLowerCase() == e)) return { err: 'Email sudah terdaftar.' }
      if (!w) return { err: 'Nomor WhatsApp wajib diisi untuk pengguna baru.' }
      if (!ROLES.includes(role)) return { err: 'Role tidak valid.' }
      if (a.u.role == 'Admin Dept' && !['User', 'Atasan', 'Admin Dept'].includes(role))
        return { err: 'Admin Dept hanya bisa menambah User, Atasan, atau Admin Dept.' }
      const dp = a.u.role == 'Admin Warehouse' ? (dept || '').trim() : a.u.dept
      if (!dp) return { err: 'Isi departemen.' }
      const be = bossCheck(null, role, dp)
      if (be) return { err: be }
      d.U.push({ id: e, n, dept: dp, role, boss: boss || '' })
      d.HP[e] = w
      return { ok: 'Pengguna ditambahkan.' }
    }

    const u = d.U.find(x => x.id == id)
    if (!u) return { err: 'Pengguna tidak ditemukan. Muat ulang halaman.' }
    if (self) {
      if (u.id != a.u.id) return { err: 'Profil hanya bisa diubah oleh pemiliknya.' }
    } else {
      if (!admin) return { err: 'Hanya admin yang bisa mengubah pengguna.' }
      if (a.u.role == 'Admin Dept' && u.dept != a.u.dept) return { err: 'Pengguna ini bukan dari departemen Anda.' }
      if (!ROLES.includes(role)) return { err: 'Role tidak valid.' }
      if (a.u.role == 'Admin Dept' && !['User', 'Atasan', 'Admin Dept'].includes(role))
        return { err: 'Admin Dept hanya bisa memberi role User, Atasan, atau Admin Dept.' }
      const dp = a.u.role == 'Admin Warehouse' && dept ? dept : u.dept
      const be = bossCheck(u.id, role, dp)
      if (be) return { err: be }
      const willOff = active !== undefined ? !active : !!u.off
      if (u.id == a.u.id && (willOff || role != u.role)) return { err: 'Anda tidak bisa menonaktifkan atau mengubah role akun sendiri.' }
      // Atasan yang masih punya bawahan aktif tidak boleh dinonaktifkan / diubah role: request bawahan akan nyangkut
      if (u.role == 'Atasan' && (willOff || role != 'Atasan')) {
        const subs = d.U.filter(x => x.boss == u.id && !x.off)
        if (subs.length) return { err: `${u.n} masih jadi atasan ${subs.length} pengguna aktif. Pindahkan atasan mereka dulu.` }
      }
    }
    u.n = n
    if (w) d.HP[u.id] = w
    else delete d.HP[u.id]
    if (!self) {
      u.role = role
      u.boss = boss || ''
      if (a.u.role == 'Admin Warehouse' && dept) u.dept = dept
      if (active !== undefined) u.off = !active
    }
    return { ok: 'Perubahan disimpan.' }
  },

  saveRequest(sel, d, { status, lines, me }) {
    const { mi } = sel
    if (status != 'Draft' && status != 'Menunggu Approval') return { err: 'Status request tidak valid.' }
    const a = actor(sel, me?.id)
    if (a.err) return { err: 'Akun nonaktif tidak bisa membuat request.' }
    if (status == 'Menunggu Approval') {
      const e = bossErr(sel, a.u)
      if (e) return { err: e }
    }
    if (!lines?.length) return { err: 'Tambahkan minimal satu barang.' }
    const t = today()
    for (const x of lines) {
      const m = x.kode && mi(x.kode)
      if (!m) return { err: 'Pilih barang di setiap baris.' }
      const q = num(x.qty)
      if (!Number.isFinite(q) || !(q > 0)) return { err: `${m.n}: jumlah harus lebih dari 0.` }
      const min = addDays(t, +m.lead)
      if (!isDate(x.datang) || x.datang < min) return { err: `${m.n}: tgl datang paling cepat ${D(min)}.` }
      if (m.buf == '0' && !x.pakai) return { err: `${m.n}: tgl pakai wajib untuk barang non buffer.` }
      if (x.pakai && !isDate(x.pakai)) return { err: `${m.n}: tgl pakai tidak valid.` }
      if (x.pakai && x.pakai < x.datang) return { err: `${m.n}: tgl pakai tidak boleh sebelum tgl datang.` }
    }
    const id = nextId(d.R, 'RQ-')
    d.R.push({ id, by: a.u.id, tgl: t, st: status, cat: '' })
    lines.forEach(x =>
      d.I.push({
        id: nextId(d.I, 'ITM-'), req: id, kode: x.kode, qty: String(+x.qty), datang: x.datang,
        pakai: x.pakai || '', status, appr: '', kon: '', tahan: '', alasan: '',
      })
    )
    return { ok: status == 'Draft' ? 'Draft disimpan.' : 'Diajukan ke atasan.' }
  },

  ajukan(sel, d, id, by) {
    const g = reqIn(d, id, ['Draft'])
    if (g.err) return g
    if (g.r.by != by) return { err: 'Hanya pembuat request yang bisa mengajukan.' }
    const u = sel.user(g.r.by)
    if (u?.off) return { err: 'Akun nonaktif tidak bisa mengajukan request.' }
    const e = bossErr(sel, u)
    if (e) return { err: e }
    // Aturan lead time dihitung dari hari pengajuan; draft lama bisa sudah lewat batas
    const t = today()
    for (const i of d.I.filter(x => x.req == id && !dead(x.status))) {
      const m = sel.mi(i.kode)
      if (!m) return { err: `Barang ${i.kode} tidak ada di master. Hubungi admin.` }
      const min = addDays(t, +m.lead)
      if (i.datang < min)
        return { err: `${m.n}: tgl datang ${D(i.datang)} sudah lewat batas minimal (${D(min)}). Batalkan draft ini lalu buat request baru.` }
    }
    setR(d, id, 'Menunggu Approval')
    return { ok: 'Diajukan ke atasan.' }
  },
  batal(sel, d, id, by) {
    const g = reqIn(d, id, ['Draft', 'Menunggu Approval'])
    if (g.err) return g
    if (g.r.by != by) return { err: 'Hanya pembuat request yang bisa membatalkan.' }
    setR(d, id, 'Dibatalkan')
    return { ok: 'Request dibatalkan.' }
  },

  setuju(sel, d, id, by) {
    const g = reqIn(d, id, ['Menunggu Approval'])
    if (g.err) return g
    const r = g.r
    if (sel.user(r.by)?.boss != by) return { err: 'Hanya atasan langsung pembuat request yang bisa menyetujui.' }
    r.st = 'Disetujui'
    // Hanya barang yang masih menunggu; barang yang sudah dibatalkan/ditolak tidak boleh hidup lagi
    d.I.filter(i => i.req == id && i.status == 'Menunggu Approval').forEach(i => {
      i.status = 'Approved'
      i.appr = nowStr()
    })
    const dp = sel.user(r.by)?.dept
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
      d.I.filter(i => i.req == r.id && i.status == 'Menunggu Approval').forEach(i => {
        i.status = 'Approved'
        i.appr = nowStr()
      })
    })
    return { ok: l.length + ' request disetujui dan diteruskan ke admin departemen.' }
  },
  tolak(sel, d, id, catatan, by) {
    const g = reqIn(d, id, ['Menunggu Approval'])
    if (g.err) return g
    if (sel.user(g.r.by)?.boss != by) return { err: 'Hanya atasan langsung pembuat request yang bisa menolak.' }
    if (!catatan) return { err: 'Isi catatan sebelum menolak.' }
    g.r.cat = catatan
    setR(d, id, 'Ditolak')
    return { ok: 'Ditolak.' }
  },

  tahan(sel, d, id, alasan, by) {
    const a = actor(sel, by, 'Admin Dept')
    if (a.err) return a
    const i = d.I.find(x => x.id == id)
    if (!i) return { err: 'Barang tidak ditemukan. Muat ulang halaman.' }
    if (i.status != 'Approved' || i.kon) return { err: 'Hanya barang yang menunggu diproses ke ERO yang bisa ditahan.' }
    if (sel.deptOf(i) != a.u.dept) return { err: 'Barang ini bukan dari departemen Anda.' }
    if (!alasan) return { err: 'Isi alasan menahan.' }
    i.tahan = 'Y'
    i.alasan = alasan
    return { ok: 'Ditahan.' }
  },
  lepas(sel, d, id, by) {
    const a = actor(sel, by, 'Admin Dept')
    if (a.err) return a
    const i = d.I.find(x => x.id == id)
    if (!i) return { err: 'Barang tidak ditemukan. Muat ulang halaman.' }
    if (i.status != 'Approved' || i.kon || !i.tahan) return { err: 'Barang ini tidak sedang ditahan.' }
    if (sel.deptOf(i) != a.u.dept) return { err: 'Barang ini bukan dari departemen Anda.' }
    i.tahan = ''
    i.alasan = ''
    return { ok: 'Tahan dilepas.' }
  },

  simpanSrl(sel, d, { no, est, me }) {
    const a = actor(sel, me?.id, 'Admin Dept')
    if (a.err) return a
    const dept = a.u.dept
    const nomor = (no || '').trim()
    if (!nomor) return { err: 'Isi nomor SRL dari ERO.' }
    if (d.L.find(l => String(l.no).toLowerCase() == nomor.toLowerCase())) return { err: 'Nomor SRL ini sudah pernah disimpan.' }
    if (est && (!isDate(est) || est < today())) return { err: 'Estimasi datang tidak valid (tidak boleh sebelum hari ini).' }
    const p = sel.poolOf(dept)
    if (!p.length) return { err: 'Tidak ada request yang siap diproses.' }
    d.L.push({ no: nomor, dept, est: est || '' })
    const g = {}
    p.forEach(i => (g[i.kode] = g[i.kode] || []).push(i))
    Object.entries(g).forEach(([k, arr]) => {
      const id = nextId(d.K, 'KON-')
      d.K.push({ id, dept, by: a.u.id, kode: k, tahap: 'Sudah di ERO', srl: nomor, ero: String(sum(arr, i => i.qty)), tutup: '0', alasan: '' })
      arr.forEach(i => {
        i.status = 'Sudah di ERO'
        i.kon = id
      })
    })
    return { ok: `${p.length} request masuk ${nomor}. Status otomatis Sudah di ERO.` }
  },

  tutup(sel, d, id, alasan, by) {
    const a = actor(sel, by, 'Admin Dept')
    if (a.err) return a
    const k = d.K.find(x => x.id == id)
    if (!k) return { err: 'Konsolidasi tidak ditemukan. Muat ulang halaman.' }
    if (k.dept != a.u.dept) return { err: 'Konsolidasi ini bukan dari departemen Anda.' }
    const s = sel.sisa(k)
    if (!(s > 0)) return { err: 'Tidak ada sisa untuk ditutup.' }
    if (!alasan) return { err: 'Isi alasan menutup sisa.' }
    k.alasan = alasan
    k.tutup = String(sum([{ v: k.tutup }, { v: s }], x => x.v))
    return { ok: 'Sisa ditutup.' }
  },

  datang(sel, d, { id, q, l, cat, by }) {
    const a = actor(sel, by, 'Admin Warehouse')
    if (a.err) return a
    const k = d.K.find(x => x.id == id)
    if (!k) return { err: 'Konsolidasi tidak ditemukan. Muat ulang halaman.' }
    const qq = num(q) || 0
    const ll = num(l) || 0
    if (!Number.isFinite(qq) || !Number.isFinite(ll) || qq < 0 || ll < 0) return { err: 'Qty tidak boleh negatif.' }
    if (!(qq > 0) && !(ll > 0)) return { err: 'Isi Qty datang.' }
    const s = sel.sisa(k)
    if (qq > s + EPS) return { err: 'Qty datang melebihi sisa (' + s + ').' }
    if (ll > 0 && !cat) return { err: 'Isi catatan untuk kelebihan.' }
    d.KD.push({ kon: id, qty: String(qq), lebih: String(ll), by: a.u.id, cat: cat || '', tgl: today() })
    return { ok: 'Kedatangan dicatat.' }
  },
  datangAll(sel, d, no, by) {
    const a = actor(sel, by, 'Admin Warehouse')
    if (a.err) return a
    const list = d.K.filter(k => k.srl == no && k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0)
    if (!list.length) return { err: 'Tidak ada sisa untuk dicatat.' }
    list.forEach(k => d.KD.push({ kon: k.id, qty: String(sel.sisa(k)), lebih: '0', by: a.u.id, cat: '', tgl: today() }))
    return { ok: list.length + ' barang dicatat datang sesuai jumlah di ' + no + '.' }
  },

  serah(sel, d, id, q, by) {
    const a = actor(sel, by, 'Admin Warehouse')
    if (a.err) return a
    const i = d.I.find(x => x.id == id)
    if (!i) return { err: 'Barang tidak ditemukan. Muat ulang halaman.' }
    if (i.status != 'Sudah di ERO') return { err: 'Barang ini belum masuk ERO.' }
    const mx = sel.siap(i)
    const qq = num(q)
    if (!Number.isFinite(qq) || !(qq > 0) || qq > mx + EPS) return { err: 'Qty harus antara 1 dan ' + mx + '.' }
    d.SR.push({ item: id, qty: String(qq), to: sel.RQ(i.req).by, tgl: today() })
    return { ok: 'Diserahkan.' }
  },

  ingat(sel, d, id, by) {
    const a = actor(sel, by, 'Admin Warehouse')
    if (a.err) return a
    const i = d.I.find(x => x.id == id)
    if (!i) return { err: 'Barang tidak ditemukan. Muat ulang halaman.' }
    if (!(sel.siap(i) > 0)) return { err: 'Barang ini belum siap diambil, tidak perlu diingatkan.' }
    d.RM.push({ item: id, by: a.u.id, at: nowStr() })
  },
}
