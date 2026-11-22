import { D, ISO_DATE, addDays, sum, wa } from './util.js'

// Semua aksi dijalankan di SERVER di dalam lock, di atas data terbaru.
// Signature: (c, a) => { ok, ids } | { err }
//   c = { d (state, boleh dimutasi), sel, actor, today, now, newId(tabel, prefix, pad) }
//   a = argumen dari klien (TIDAK dipercaya: divalidasi di sini)
// Setiap aksi memeriksa: (1) peran pelaku, (2) kepemilikan/departemen, (3) status SAAT INI
// (supaya klik basi tidak menimpa perubahan user lain), (4) duplikat.

const EPS = 1e-9
const err = m => ({ err: m })
const txt = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max)
const num = v => (v === '' || v == null ? NaN : Number(v))
const fmt = v => String(Math.round(v * 1e6) / 1e6)
const secs = s => Date.parse(s) / 1000
const only = (c, ...roles) => (roles.includes(c.actor.role) ? null : err('Peran Anda tidak berhak melakukan aksi ini.'))
const ALL_ROLES = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']
const DEPT_ROLES = ['User', 'Atasan', 'Admin Dept']

const setR = (d, id, s) => {
  d.R.find(r => r.id == id).st = s
  d.I.filter(i => i.req == id).forEach(i => {
    if (!['Ditolak', 'Dibatalkan'].includes(i.status)) i.status = s
  })
}
// Duplikat "kembar" dalam jendela waktu pendek (mis. dua tab, dua perangkat)
const recent = (rows, now, sec) => rows.filter(r => r._cr && secs(now) - secs(r._cr) <= sec)

export const ACTIONS = {
  saveUser(c, a) {
    const { d, sel, actor } = c
    const n = txt(a.n, 100)
    const rawWa = txt(a.rawWa, 30)
    const w = wa(rawWa)
    if (!n) return err('Isi nama.')
    if (rawWa && !w) return err('Nomor WhatsApp tidak valid. Contoh: 081234567890.')
    const aw = actor.role == 'Admin Warehouse'
    const roles = aw ? ALL_ROLES : DEPT_ROLES
    const checkBoss = (role, boss, dept) => {
      if (role == 'User' && !boss) return err('Pilih atasan untuk user, supaya request bisa disetujui.')
      if (boss) {
        const b = sel.user(boss)
        if (!b || b.role != 'Atasan') return err('Atasan tidak valid.')
        if (!aw && b.dept != dept) return err('Atasan harus dari departemen yang sama.')
      }
      return null
    }
    if (a.mode == 'new') {
      const g = only(c, 'Admin Dept', 'Admin Warehouse')
      if (g) return g
      const e = txt(a.email, 120).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+$/.test(e)) return err('Isi email yang valid.')
      if (sel.user(e)) return err('Email sudah terdaftar.')
      if (!w) return err('Nomor WhatsApp wajib diisi untuk pengguna baru.')
      if (!roles.includes(a.role)) return err('Role tidak diizinkan.')
      const dept = aw ? txt(a.dept, 60) : actor.dept
      if (!dept) return err('Isi departemen.')
      const eb = checkBoss(a.role, a.boss, dept)
      if (eb) return eb
      d.U.push({ id: e, n, dept, role: a.role, boss: a.boss || '', wa: w, off: false })
      return { ok: 'Pengguna ditambahkan.', ids: [e] }
    }
    const u = sel.user(a.id)
    if (!u) return err('Pengguna tidak ditemukan.')
    if (u.id == actor.id) {
      // profil sendiri: hanya nama dan nomor WA
      u.n = n
      u.wa = w
      return { ok: 'Perubahan disimpan.', ids: [u.id] }
    }
    const g = only(c, 'Admin Dept', 'Admin Warehouse')
    if (g) return g
    if (!aw && (u.dept != actor.dept || !roles.includes(u.role))) return err('Pengguna ini tidak bisa Anda ubah.')
    if (!roles.includes(a.role)) return err('Role tidak diizinkan.')
    const dept = aw && a.dept ? txt(a.dept, 60) : u.dept
    const eb = checkBoss(a.role, a.boss, dept)
    if (eb) return eb
    u.n = n
    u.wa = w
    u.role = a.role
    u.boss = a.boss || ''
    u.dept = dept
    if (typeof a.active == 'boolean') u.off = !a.active
    return { ok: 'Perubahan disimpan.', ids: [u.id] }
  },

  saveRequest(c, a) {
    const { d, sel, actor, today, now } = c
    const g = only(c, 'User')
    if (g) return g
    const status = a.status
    if (!['Draft', 'Menunggu Approval'].includes(status)) return err('Status tidak valid.')
    if (status == 'Menunggu Approval' && !actor.boss)
      return err('Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.')
    const lines = Array.isArray(a.lines) ? a.lines : []
    if (!lines.length) return err('Tambahkan minimal satu barang.')
    if (lines.length > 50) return err('Maksimal 50 barang per request.')
    const seen = new Set()
    const clean = []
    for (const x of lines) {
      const m = x && x.kode && sel.mi(x.kode)
      if (!m) return err('Pilih barang di setiap baris.')
      const q = num(x.qty)
      if (!(q > 0) || q > 1e7) return err('Jumlah harus lebih dari 0.')
      const datang = txt(x.datang, 10)
      const pakai = txt(x.pakai, 10)
      const min = addDays(today, +m.lead)
      if (!ISO_DATE.test(datang) || datang < min) return err(`${m.n}: tgl datang paling cepat ${D(min)}.`)
      if (m.buf == '0' && !pakai) return err(`${m.n}: tgl pakai wajib untuk barang non buffer.`)
      if (pakai && !ISO_DATE.test(pakai)) return err(`${m.n}: tgl pakai tidak valid.`)
      if (pakai && pakai < datang) return err(`${m.n}: tgl pakai tidak boleh sebelum tgl datang.`)
      const sig = [m.k, q, datang, pakai].join('|')
      if (seen.has(sig)) return err(`${m.n}: baris identik muncul dua kali. Gabungkan jumlahnya.`)
      seen.add(sig)
      clean.push({ kode: m.k, qty: fmt(q), datang, pakai })
    }
    // anti-duplikat: request identik dari user yang sama dalam 2 menit terakhir
    const sigOf = ls => ls.map(x => [x.kode, +x.qty, x.datang, x.pakai || ''].join('|')).sort().join(';')
    const mine = recent(d.R.filter(r => r.by == actor.id && !['Dibatalkan', 'Ditolak'].includes(r.st)), now, 120)
    for (const r of mine)
      if (sigOf(d.I.filter(i => i.req == r.id)) == sigOf(clean))
        return err(`Request yang sama (${r.id}) baru saja dibuat. Cek di Request saya sebelum membuat lagi.`)
    const id = c.newId('R', 'RQ', 3)
    d.R.push({ id, by: actor.id, tgl: today, st: status, cat: '' })
    const ids = [id]
    clean.forEach(x => {
      const iid = c.newId('I', 'ITM', 3)
      d.I.push({ id: iid, req: id, kode: x.kode, qty: x.qty, datang: x.datang, pakai: x.pakai, status, appr: '', kon: '', tahan: '', alasan: '' })
    })
    return { ok: status == 'Draft' ? 'Draft disimpan.' : 'Diajukan ke atasan.', ids }
  },

  ajukan(c, a) {
    const r = c.d.R.find(x => x.id == a.id)
    if (!r) return err('Request tidak ditemukan.')
    if (r.by != c.actor.id) return err('Ini bukan request Anda.')
    if (r.st != 'Draft') return err(`Request sudah berstatus ${r.st}. Muat ulang halaman.`)
    if (!c.actor.boss) return err('Akun Anda belum punya atasan. Hubungi admin departemen.')
    setR(c.d, r.id, 'Menunggu Approval')
    return { ok: 'Diajukan ke atasan.', ids: [r.id] }
  },
  batal(c, a) {
    const r = c.d.R.find(x => x.id == a.id)
    if (!r) return err('Request tidak ditemukan.')
    if (r.by != c.actor.id) return err('Ini bukan request Anda.')
    if (!['Draft', 'Menunggu Approval'].includes(r.st)) return err(`Request sudah berstatus ${r.st} dan tidak bisa dibatalkan.`)
    setR(c.d, r.id, 'Dibatalkan')
    return { ok: 'Request dibatalkan.', ids: [r.id] }
  },

  setuju(c, a) {
    const { d, sel, actor } = c
    const g = only(c, 'Atasan')
    if (g) return g
    const r = d.R.find(x => x.id == a.id)
    if (!r) return err('Request tidak ditemukan.')
    if (sel.user(r.by)?.boss != actor.id) return err('Request ini bukan dari tim Anda.')
    if (r.st != 'Menunggu Approval') return err(`Request sudah berstatus ${r.st} (mungkin dibatalkan atau sudah diputuskan).`)
    r.st = 'Disetujui'
    d.I.filter(i => i.req == r.id).forEach(i => {
      i.status = 'Approved'
      i.appr = c.now
    })
    const dp = sel.user(r.by).dept
    const ad = d.U.find(u => u.role == 'Admin Dept' && u.dept == dp && !u.off)
    return {
      ok: ad ? `Disetujui. Diteruskan ke ${ad.n} (Admin ${dp}).` : `Disetujui, tapi belum ada Admin Dept aktif di ${dp}. Hubungi Admin Warehouse.`,
      ids: [r.id],
    }
  },
  setujuAll(c) {
    const { d, sel, actor } = c
    const g = only(c, 'Atasan')
    if (g) return g
    const l = d.R.filter(r => r.st == 'Menunggu Approval' && sel.user(r.by)?.boss == actor.id)
    if (!l.length) return err('Tidak ada request yang menunggu.')
    l.forEach(r => {
      r.st = 'Disetujui'
      d.I.filter(i => i.req == r.id).forEach(i => {
        i.status = 'Approved'
        i.appr = c.now
      })
    })
    return { ok: l.length + ' request disetujui dan diteruskan ke admin departemen.', ids: l.map(r => r.id) }
  },
  tolak(c, a) {
    const { d, sel, actor } = c
    const g = only(c, 'Atasan')
    if (g) return g
    const cat = txt(a.catatan, 500)
    if (!cat) return err('Isi catatan sebelum menolak.')
    const r = d.R.find(x => x.id == a.id)
    if (!r) return err('Request tidak ditemukan.')
    if (sel.user(r.by)?.boss != actor.id) return err('Request ini bukan dari tim Anda.')
    if (r.st != 'Menunggu Approval') return err(`Request sudah berstatus ${r.st} (mungkin dibatalkan atau sudah diputuskan).`)
    r.cat = cat
    setR(d, r.id, 'Ditolak')
    return { ok: 'Ditolak.', ids: [r.id] }
  },

  tahan(c, a) {
    const g = only(c, 'Admin Dept')
    if (g) return g
    const alasan = txt(a.alasan, 300)
    if (!alasan) return err('Isi alasan menahan.')
    const i = c.d.I.find(x => x.id == a.id)
    if (!i) return err('Barang tidak ditemukan.')
    if (c.sel.deptOf(i) != c.actor.dept) return err('Barang ini bukan dari departemen Anda.')
    if (i.status != 'Approved' || i.kon) return err('Barang sudah diproses ke ERO atau tidak lagi berstatus Approved.')
    i.tahan = 'Y'
    i.alasan = alasan
    return { ok: 'Ditahan.', ids: [i.id] }
  },
  lepas(c, a) {
    const g = only(c, 'Admin Dept')
    if (g) return g
    const i = c.d.I.find(x => x.id == a.id)
    if (!i) return err('Barang tidak ditemukan.')
    if (c.sel.deptOf(i) != c.actor.dept) return err('Barang ini bukan dari departemen Anda.')
    if (i.status != 'Approved' || i.kon || !i.tahan) return err('Barang tidak sedang ditahan.')
    i.tahan = ''
    i.alasan = ''
    return { ok: 'Tahan dilepas.', ids: [i.id] }
  },

  simpanSrl(c, a) {
    const { d, sel, actor } = c
    const g = only(c, 'Admin Dept')
    if (g) return g
    const no = txt(a.no, 40)
    const est = txt(a.est, 10)
    if (!no) return err('Isi nomor SRL dari ERO.')
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/.test(no)) return err('Format nomor SRL tidak valid.')
    if (est && !ISO_DATE.test(est)) return err('Estimasi datang tidak valid.')
    if (d.L.find(l => l.no == no)) return err('Nomor SRL ini sudah pernah disimpan.')
    const p = sel.poolOf(actor.dept)
    if (!p.length) return err('Tidak ada request yang siap diproses (mungkin sudah diproses admin lain). Muat ulang.')
    d.L.push({ no, dept: actor.dept, est })
    const grp = {}
    p.forEach(i => (grp[i.kode] = grp[i.kode] || []).push(i))
    const ids = [no]
    Object.entries(grp).forEach(([k, arr]) => {
      const id = c.newId('K', 'KON', 3)
      d.K.push({ id, dept: actor.dept, kode: k, tahap: 'Sudah di ERO', srl: no, ero: fmt(sum(arr, i => i.qty)), tutup: '0', alasan: '', by: actor.n })
      arr.forEach(i => {
        i.status = 'Sudah di ERO'
        i.kon = id
      })
      ids.push(id)
    })
    return { ok: `${p.length} request masuk ${no}. Status otomatis Sudah di ERO.`, ids }
  },

  tutup(c, a) {
    const g = only(c, 'Admin Dept')
    if (g) return g
    const alasan = txt(a.alasan, 300)
    if (!alasan) return err('Isi alasan menutup sisa.')
    const k = c.sel.KN(a.id)
    if (!k) return err('Konsolidasi tidak ditemukan.')
    if (k.dept != c.actor.dept) return err('Ini bukan SRL departemen Anda.')
    const s = c.sel.sisa(k)
    if (!(s > EPS)) return err('Tidak ada sisa untuk ditutup.')
    k.alasan = alasan
    k.tutup = fmt(+k.tutup + s)
    return { ok: 'Sisa ditutup.', ids: [k.id] }
  },

  datang(c, a) {
    const { d, sel, actor, now } = c
    const g = only(c, 'Admin Warehouse')
    if (g) return g
    const k = sel.KN(a.id)
    if (!k) return err('Konsolidasi tidak ditemukan.')
    if (k.tahap != 'Sudah di ERO') return err('SRL belum berstatus Sudah di ERO.')
    const q = a.q === '' || a.q == null ? 0 : num(a.q)
    const l = a.l === '' || a.l == null ? 0 : num(a.l)
    if (!Number.isFinite(q) || !Number.isFinite(l) || q < 0 || l < 0) return err('Qty tidak valid.')
    if (!(q > 0) && !(l > 0)) return err('Isi Qty datang.')
    if (q > sel.sisa(k) + EPS) return err('Qty datang melebihi sisa (' + fmt(sel.sisa(k)) + '). Mungkin sudah dicatat admin lain.')
    const cat = txt(a.cat, 300)
    if (l > 0 && !cat) return err('Isi catatan untuk kelebihan.')
    const dupe = recent(d.KD, now, 15).find(x => x.kon == k.id && +x.qty == q && +x.lebih == l && x.by == actor.n)
    if (dupe) return err(`Kedatangan yang sama baru saja dicatat (${dupe.id}).`)
    const id = c.newId('KD', 'KDG', 6)
    d.KD.push({ id, kon: k.id, qty: fmt(q), lebih: fmt(l), by: actor.n, cat, tgl: c.today })
    return { ok: 'Kedatangan dicatat.', ids: [id] }
  },
  datangAll(c, a) {
    const { d, sel, actor } = c
    const g = only(c, 'Admin Warehouse')
    if (g) return g
    const arr = d.K.filter(k => k.srl == a.no && k.tahap == 'Sudah di ERO' && sel.sisa(k) > EPS)
    if (!arr.length) return err('Tidak ada sisa untuk dicatat (mungkin sudah dicatat admin lain).')
    const ids = []
    arr.forEach(k => {
      const id = c.newId('KD', 'KDG', 6)
      d.KD.push({ id, kon: k.id, qty: fmt(sel.sisa(k)), lebih: '0', by: actor.n, cat: '', tgl: c.today })
      ids.push(id)
    })
    return { ok: arr.length + ' barang dicatat datang sesuai jumlah di ' + a.no + '.', ids }
  },

  serah(c, a) {
    const { d, sel, now } = c
    const g = only(c, 'Admin Warehouse')
    if (g) return g
    const i = d.I.find(x => x.id == a.id)
    if (!i) return err('Barang tidak ditemukan.')
    if (i.status != 'Sudah di ERO') return err('Barang belum berstatus Sudah di ERO.')
    const q = num(a.q)
    const mx = sel.siap(i)
    if (!Number.isFinite(q) || !(q > 0) || q > mx + EPS) return err('Qty harus antara 1 dan ' + fmt(mx) + '. Mungkin sudah diserahkan admin lain.')
    const dupe = recent(d.SR, now, 15).find(x => x.item == i.id && +x.qty == q)
    if (dupe) return err(`Serah terima yang sama baru saja dicatat (${dupe.id}).`)
    const id = c.newId('SR', 'SRH', 6)
    d.SR.push({ id, item: i.id, qty: fmt(q), to: sel.nm(sel.RQ(i.req).by), tgl: c.today })
    return { ok: 'Diserahkan.', ids: [id] }
  },

  ingat(c, a) {
    const { d, sel, actor, now } = c
    const g = only(c, 'Admin Warehouse')
    if (g) return g
    const i = d.I.find(x => x.id == a.id)
    if (!i) return err('Barang tidak ditemukan.')
    if (i.status != 'Sudah di ERO' || !(sel.siap(i) > EPS)) return err('Barang ini tidak sedang menunggu diambil.')
    if (recent(d.RM, now, 15).find(x => x.item == i.id && x.by == actor.n)) return { ok: 'Pengingat sudah dicatat.', ids: [] }
    const id = c.newId('RM', 'RMD', 6)
    d.RM.push({ id, item: i.id, by: actor.n, at: now })
    return { ok: 'Pengingat dicatat.', ids: [id] }
  },
}

