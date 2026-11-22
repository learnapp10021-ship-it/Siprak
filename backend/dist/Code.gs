// ============================================================================
// FILE HASIL BUILD -- JANGAN DIEDIT LANGSUNG.
// Sumber: src/lib/utils.js, selectors.js, actions.js, src/data/seed.js, backend/src/server.gs
// Bangun ulang: npm run build:backend
// ============================================================================

// ---------- src/lib/utils.js ----------
// Parser tabel teks "a|b|c" -> array objek
const T = (s, k) =>
  s.trim().split('\n').map(l => Object.fromEntries(l.split('|').map((v, i) => [k[i], v])))

// Nomor WhatsApp: normalisasi ke 628xxxxxxxxx, kosong jika tidak valid
const wa = s => {
  let d = String(s || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '62' + d.slice(1)
  return /^628\d{8,11}$/.test(d) ? d : ''
}
const disp = d => (d ? '0' + d.slice(2) : '')

const pad = n => String(n).padStart(2, '0')
// Tanggal lokal (bukan UTC) supaya tidak mundur sehari di zona Asia/Jakarta
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const nowStr = () => {
  const d = new Date()
  return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const TODAY = todayStr()

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
// Format tanggal pendek Indonesia, tanpa Intl supaya sama di browser dan Google Apps Script
const D = d => (d ? +d.slice(8, 10) + ' ' + BLN[+d.slice(5, 7) - 1] : 'belum diisi')

const days = d =>
  Math.max(0, Math.round((Date.parse(TODAY) - Date.parse(d.slice(0, 10))) / 864e5))
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)
const sum = (a, f) => a.reduce((s, x) => s + +f(x), 0)
const f1 = x => (x == null ? '-' : String(Math.round(x * 10) / 10).replace('.', ','))
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

// ID unik berikutnya, berdasarkan nomor terbesar yang ada (bukan jumlah baris).
// Di server dipanggil di dalam lock atas data terbaru, sehingga tidak pernah bentrok.
const nextId = (rows, prefix, key = 'id') => {
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
const minsAgo = at => {
  const t = at ? Date.parse(at) : NaN
  return isNaN(t) ? Infinity : (Date.parse(nowStr()) - t) / 6e4
}

// Master item: normalisasi dan parser tempel dari Excel/CSV.
const flag = v => (/^(1|y|ya|yes|true|buffer|konsinyasi)$/i.test(String(v ?? '').trim()) ? '1' : '0')
function cleanMaster(r) {
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
function parseMaster(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = [/\t/, /;/, /\|/, /,/].find(re => re.test(lines[0])) || /\t/
  const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')))
  if (/^(kode|code|item)/i.test(rows[0][0]) && !/^[A-Z]{2,}-?\d/.test(rows[0][0])) rows.shift()
  return rows.map(c => cleanMaster({ k: c[0], n: c[1], sat: c[2], buf: c[3], kons: c[4], lead: c[5] }))
}


// ---------- src/lib/selectors.js ----------


// Semua turunan data (jatah, sisa, status) dihitung dari snapshot db.
// Dipakai di render (db biasa) maupun di dalam aksi (draft immer).
function makeSel(db) {
  const { U, M, R, I, K, L, KD, SR, RM } = db

  const user = id => U.find(u => u.id == id)
  const nm = id => user(id)?.n || id
  const mi = k => M.find(m => m.k == k)
  const KN = id => K.find(k => k.id == id)
  const RQ = id => R.find(r => r.id == id)
  const SRLof = no => L.find(l => l.no == no)

  const live = i => !['Ditolak', 'Dibatalkan'].includes(i.status)
  const total = k => sum(I.filter(i => i.kon == k.id && live(i)), i => i.qty)
  const datang = k => sum(KD.filter(d => d.kon == k.id), d => d.qty)
  const sisa = k => Math.max(0, total(k) - datang(k) - +k.tutup)

  // urut kebutuhan paling dekat; tanpa tgl pakai dianggap paling akhir
  const ord = (a, b) =>
    (a.pakai || '9') < (b.pakai || '9')
      ? -1
      : (a.pakai || '9') > (b.pakai || '9')
      ? 1
      : a.appr < b.appr
      ? -1
      : 1

  // Jatah barang yang sudah datang dibagi ke request sesuai urutan kebutuhan
  const berhak = it => {
    const k = KN(it.kon)
    if (!k) return 0
    let r = datang(k)
    for (const x of I.filter(i => i.kon == k.id && live(i)).sort(ord)) {
      const g = Math.min(r, +x.qty)
      if (x.id == it.id) return g
      r -= g
    }
    return 0
  }
  const diambil = it => sum(SR.filter(s => s.item == it.id), s => s.qty)
  const siap = it => berhak(it) - diambil(it)
  const deptOf = it => user(RQ(it.req).by).dept
  const lastArrival = kon => KD.filter(d => d.kon == kon).map(d => d.tgl).sort().pop()
  const firstArrival = kon => KD.filter(d => d.kon == kon).map(d => d.tgl).sort()[0]

  // [tahap 0-4, kelas warna, label]
  const st = it => {
    const s = it.status
    const sat = mi(it.kode).sat
    if (s == 'Draft') return [0, 't-gray', 'Draft, belum diajukan']
    if (s == 'Menunggu Approval') return [0, 't-warn', 'Menunggu persetujuan atasan']
    if (s == 'Approved')
      return it.tahan
        ? [1, 't-warn', 'Ditahan: ' + it.alasan]
        : it.alasan
        ? [1, 't-warn', it.alasan]
        : [1, 't-info', 'Disetujui, menunggu diproses ke ERO']
    if (s == 'Validasi Warehouse') return [2, 't-warn', 'SRL ' + (KN(it.kon)?.srl || '') + ' menunggu validasi Warehouse']
    if (s == 'Masuk Konsolidasi') return [2, 't-vio', 'Dikonsolidasi, belum masuk ERO']
    if (s == 'Sudah di ERO') {
      const b = berhak(it)
      const a = diambil(it)
      if (a >= +it.qty) return [4, 't-ok', 'Sudah diambil semua']
      if (b - a > 0) return [4, 't-ok', `Siap diambil ${b - a} dari ${it.qty} ${sat}`]
      // Tidak ada lagi yang akan datang (sisa ditutup): jangan menunggu selamanya
      const kk = KN(it.kon)
      if (kk && sisa(kk) == 0 && +kk.tutup > 0)
        return [4, 't-warn', `Sisa ditutup${kk.alasan ? ': ' + kk.alasan : ''}. Diambil ${a} dari ${it.qty} ${sat}`]
      const srl = SRLof(KN(it.kon)?.srl)
      return [
        3,
        't-vio',
        'Sudah di ERO (' + KN(it.kon).srl + '), menunggu barang datang' +
          (srl ? ' (est. ' + D(srl.est) + ')' : ''),
      ]
    }
    return [-1, s == 'Ditolak' ? 't-bad' : 't-gray', s]
  }

  const poolAll = d => I.filter(i => i.status == 'Approved' && !i.kon && RQ(i.req) && deptOf(i) == d)
  const poolOf = d => poolAll(d).filter(i => !i.tahan)

  return {
    user, nm, mi, KN, RQ, SRLof, live, total, datang, sisa, ord, berhak, diambil, siap,
    deptOf, lastArrival, firstArrival, st, poolAll, poolOf,
    reminders: itemId => RM.filter(x => x.item == itemId),
  }
}


// ---------- src/lib/actions.js ----------


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

const actions = {
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


// ---------- src/data/seed.js ----------



// Data contoh (sama dengan versi HTML). Ganti dengan API/backend saat produksi.
function buildSeed() {
  const U = T(
    `hendra.mgr|Hendra Wijaya|Produksi|Atasan|
budi.spv|Budi Hartono|Produksi|Atasan|hendra.mgr
andi.prod|Andi Saputra|Produksi|User|budi.spv
siti.prod|Siti Rahma|Produksi|User|budi.spv
rudi.prod|Rudi Firmansyah|Produksi|User|budi.spv
dewi.admin|Dewi Lestari|Produksi|Admin Dept|budi.spv
tono.spv|Tono Sugiarto|Maintenance|Atasan|
maya.mt|Maya Anggraeni|Maintenance|User|tono.spv
rina.mt|Rina Marlina|Maintenance|User|tono.spv
yani.admin|Yani Kusuma|Maintenance|Admin Dept|tono.spv
wati.wh|Wati Handayani|Warehouse|Admin Warehouse|
joko.wh|Joko Susilo|Warehouse|Admin Warehouse|
agus.spv|Agus Prasetyo|Warehouse|Spv Warehouse|`,
    ['id', 'n', 'dept', 'role', 'boss']
  )
  const HP = {
    'hendra.mgr': '6281234560001', 'budi.spv': '6281234560002', 'andi.prod': '6281234560003',
    'siti.prod': '6281234560004', 'rudi.prod': '6281234560005', 'dewi.admin': '6281234560006',
    'tono.spv': '6281234560007', 'maya.mt': '6281234560008', 'rina.mt': '6281234560009',
    'yani.admin': '6281234560010', 'wati.wh': '6281234560011', 'joko.wh': '6281234560012',
    'agus.spv': '6281234560013',
  }
  const M = T(
    `SRG-001|Sarung Tangan Kain|Pasang|0|0|3
SRG-002|Masker KN95|Box|1|0|3
APD-007|Helm Safety|Pcs|1|0|7
OLI-010|Oli Hidrolik 20L|Jerigen|0|1|5
BRG-204|Bearing 6204|Pcs|1|1|7
KBL-005|Kabel Tie 30cm|Pack|0|0|2
LAS-021|Kawat Las RB26|Kg|0|0|3`,
    ['k', 'n', 'sat', 'buf', 'kons', 'lead']
  )
  const R = T(
    `RQ-001|andi.prod|2026-11-03|Disetujui|
RQ-002|siti.prod|2026-11-03|Disetujui|
RQ-003|rudi.prod|2026-11-03|Disetujui|
RQ-004|siti.prod|2026-11-12|Disetujui|
RQ-005|rudi.prod|2026-11-12|Disetujui|
RQ-006|maya.mt|2026-11-04|Disetujui|
RQ-007|rina.mt|2026-11-04|Disetujui|
RQ-008|siti.prod|2026-11-18|Menunggu Approval|
RQ-009|andi.prod|2026-11-18|Draft|
RQ-010|rudi.prod|2026-11-09|Ditolak|Stok helm masih cukup, tunda dulu
RQ-011|andi.prod|2026-11-10|Dibatalkan|`,
    ['id', 'by', 'tgl', 'st', 'cat']
  )
  const I = T(
    `ITM-001|RQ-001|SRG-001|10|2026-11-16|2026-11-25|Sudah di ERO|2026-11-04|KON-001||
ITM-002|RQ-001|SRG-002|20|2026-11-16||Sudah di ERO|2026-11-04|KON-002||
ITM-003|RQ-002|SRG-001|10|2026-11-16|2026-11-20|Sudah di ERO|2026-11-04|KON-001||
ITM-004|RQ-003|SRG-001|10|2026-11-16|2026-12-02|Sudah di ERO|2026-11-04|KON-001||
ITM-005|RQ-004|BRG-204|4|2026-11-30||Approved|2026-11-12||Y|Menunggu konfirmasi spesifikasi bearing
ITM-006|RQ-005|LAS-021|5|2026-11-30|2026-12-05|Approved|2026-11-13|||
ITM-007|RQ-006|OLI-010|4|2026-11-17|2026-11-25|Sudah di ERO|2026-11-05|KON-003||
ITM-008|RQ-006|BRG-204|6|2026-11-25||Approved|2026-11-05|||
ITM-009|RQ-007|OLI-010|2|2026-11-17|2026-12-02|Sudah di ERO|2026-11-05|KON-003||
ITM-010|RQ-008|KBL-005|3|2026-12-03|2026-12-10|Menunggu Approval||||
ITM-011|RQ-009|OLI-010|2|2026-12-03|2026-12-10|Draft||||
ITM-012|RQ-010|APD-007|2|2026-11-23||Ditolak||||
ITM-013|RQ-011|LAS-021|1|2026-11-20|2026-12-01|Dibatalkan||||`,
    ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan']
  )
  const K = T(
    `KON-001|Produksi|SRG-001|Sudah di ERO|SRL-2611-001|30|0|
KON-002|Produksi|SRG-002|Sudah di ERO|SRL-2611-001|20|0|
KON-003|Maintenance|OLI-010|Sudah di ERO|SRL-2611-002|6|2|Supplier tidak bisa kirim sisa 2 jerigen`,
    ['id', 'dept', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan']
  )
  const L = T(
    `SRL-2611-001|Produksi|2026-11-16
SRL-2611-002|Maintenance|2026-11-17`,
    ['no', 'dept', 'est']
  )
  const KD = T(
    `KON-001|15|0|Wati Handayani||2026-11-16
KON-002|20|5|Wati Handayani|Supplier kirim 25, kelebihan 5 dicatat terpisah|2026-11-16
KON-003|4|0|Joko Susilo||2026-11-17`,
    ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl']
  )
  const SR = T(
    `ITM-003|10|Siti Rahma
ITM-002|20|Andi Saputra`,
    ['item', 'qty', 'to']
  )
  const nmOf = id => U.find(u => u.id == id)?.n || id

  // Tambahan data contoh: SRL-2611-003 dengan 20 barang
  {
    const A = [
      ['GRD-101', 'Mata Gerinda Potong 4 inci', 'Pcs', 0], ['GRD-102', 'Mata Gerinda Poles 4 inci', 'Pcs', 0],
      ['BOR-201', 'Mata Bor HSS 8mm', 'Pcs', 0], ['BOR-202', 'Mata Bor HSS 10mm', 'Pcs', 0],
      ['BLT-301', 'Baut Hex M10x50', 'Box', 1], ['BLT-302', 'Mur Hex M10', 'Box', 1],
      ['BLT-303', 'Ring Plat M10', 'Box', 1], ['SLG-401', 'Selang Hidrolik 1/2 inci', 'Meter', 0],
      ['SLG-402', 'Klem Selang 1 inci', 'Pcs', 0], ['FTG-501', 'Fitting Nipple 1/2 inci', 'Pcs', 0],
      ['BRG-205', 'Bearing 6205', 'Pcs', 1], ['BRG-206', 'Bearing 6206', 'Pcs', 1],
      ['SEL-601', 'Oil Seal 35x52x7', 'Pcs', 1], ['VBT-401', 'V-Belt B-52', 'Pcs', 1],
      ['KBL-006', 'Kabel NYAF 1.5mm', 'Roll', 0], ['LMP-701', 'Lampu LED Highbay 100W', 'Pcs', 0],
      ['CTR-801', 'Kontaktor 3P 25A', 'Pcs', 0], ['SKR-901', 'Sekring Cartridge 10A', 'Box', 1],
      ['LKT-101', 'Lakban Isolasi Hitam', 'Roll', 0], ['PNT-201', 'Cat Marking Kuning', 'Kaleng', 0],
    ]
    const P = ['andi.prod', 'siti.prod', 'rudi.prod']
    const no = 'SRL-2611-003'
    for (let n = 0; n < 6; n++)
      R.push({ id: 'RQ-0' + (12 + n), by: P[n % 3], tgl: n < 3 ? '2026-11-14' : '2026-11-15', st: 'Disetujui', cat: '' })
    L.push({ no, dept: 'Produksi', est: '2026-11-24' })
    A.forEach(([k, nama, sat, buf], i) => {
      M.push({ k, n: nama, sat, buf: String(buf), kons: '0', lead: String(3 + (i % 4)) })
      const kid = 'KON-' + String(5 + i).padStart(3, '0')
      const rs = i % 2 ? [i % 3] : [i % 3, (i + 1) % 3]
      const dt = addDays('2026-11-20', i % 6)
      let tot = 0
      rs.forEach((r, j) => {
        const q = j ? ((i * 5) % 6) + 1 : ((i * 7) % 9) + 2
        const id = 'ITM-' + String(I.length + 1).padStart(3, '0')
        tot += q
        I.push({
          id, req: 'RQ-0' + (12 + r + (i < 10 ? 0 : 3)), kode: k, qty: String(q), datang: dt,
          pakai: buf ? '' : addDays(dt, 3 + (i % 5)), status: 'Sudah di ERO',
          appr: '2026-11-16T08:' + String(10 + i).padStart(2, '0'), kon: kid, tahan: '', alasan: '',
        })
        if (i < 3 && !j) SR.push({ item: id, qty: String(q), to: nmOf(P[r]) })
      })
      K.push({ id: kid, dept: 'Produksi', kode: k, tahap: 'Sudah di ERO', srl: no, ero: String(tot), tutup: '0', alasan: '' })
      if (i < 6)
        KD.push({ kon: kid, qty: String(tot), lebih: '0', by: 'Wati Handayani', cat: '', tgl: '2026-11-18' })
      else if (i < 12)
        KD.push({ kon: kid, qty: String(Math.floor(tot / 2) || 1), lebih: '0', by: 'Joko Susilo', cat: '', tgl: '2026-11-21' })
    })
  }
  // Data contoh menu Validasi SRL: dua SRL dari Admin Dept yang menunggu diperiksa Admin Warehouse
  {
    const V = [
      { no: 'SRL-2611-004', dept: 'Maintenance', est: '2026-12-01', lines: [
        ['APD-007', [['RQ-018', 'maya.mt', 5], ['RQ-019', 'rina.mt', 3]]],
        ['KBL-005', [['RQ-018', 'maya.mt', 10]]],
        ['SRG-001', [['RQ-019', 'rina.mt', 12]]],
      ] },
      { no: 'SRL-2611-005', dept: 'Produksi', est: '2026-12-03', lines: [
        ['SRG-002', [['RQ-020', 'andi.prod', 6], ['RQ-021', 'siti.prod', 4]]],
        ['LAS-021', [['RQ-021', 'siti.prod', 8]]],
      ] },
    ]
    const made = new Set()
    let kn = Math.max(...K.map(k => +k.id.slice(4)))
    V.forEach((v, vi) => {
      L.push({ no: v.no, dept: v.dept, est: v.est })
      v.lines.forEach(([kode, rs], li) => {
        const kid = 'KON-' + String(++kn).padStart(3, '0')
        const buf = M.find(m => m.k == kode).buf == '1'
        let tot = 0
        rs.forEach(([rid, by, q], j) => {
          if (!made.has(rid)) {
            made.add(rid)
            R.push({ id: rid, by, tgl: '2026-11-19', st: 'Disetujui', cat: '' })
          }
          tot += q
          I.push({
            id: 'ITM-' + String(I.length + 1).padStart(3, '0'), req: rid, kode, qty: String(q),
            datang: addDays('2026-11-27', vi * 2 + li), pakai: buf ? '' : addDays('2026-12-04', vi * 2 + li + j),
            status: 'Validasi Warehouse', appr: '2026-11-20T08:' + String(10 + vi * 10 + li * 2 + j).padStart(2, '0'),
            kon: kid, tahan: '', alasan: '',
          })
        })
        K.push({ id: kid, dept: v.dept, kode, tahap: 'Validasi Warehouse', srl: v.no, ero: String(tot), tutup: '0', alasan: '' })
      })
    })
  }
  K.forEach(k => (k.by = nmOf(k.dept == 'Produksi' ? 'dewi.admin' : 'yani.admin')))
  SR.forEach((s, n) => (s.tgl = addDays('2026-11-18', n % 3)))

  const db = { U, HP, M, R, I, K, L, KD, SR, RM: [] }
  // Contoh riwayat pengingat
  const sel = makeSel(db)
  db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).forEach((i, n) => {
    for (let c = 0; c < n % 4; c++)
      db.RM.push({ item: i.id, by: 'Wati Handayani', at: addDays(TODAY, -((n % 4) - c)) + 'T09:00' })
  })
  return db
}


// ---------- backend/src/server.gs ----------
// =====================================================================================
// SIPRAK server (Google Apps Script) -- Google Spreadsheet sebagai database
// -------------------------------------------------------------------------------------
// Jaminan yang dibangun di sini:
//  1. Semua penulisan diserialkan oleh LockService (satu penulis pada satu waktu = antrean).
//  2. Setiap submit membawa ID transaksi (tx). Tx yang sama TIDAK PERNAH ditulis dua kali:
//     kirim ulang (retry) hanya mengembalikan hasil sebelumnya.
//  3. Aksi dijalankan atas data TERBARU yang dibaca di dalam lock, dengan kode yang sama dengan
//     browser (src/lib/actions.js). Status dicek ulang sehingga tidak menimpa keputusan orang lain.
//  4. Write-ahead: baris Tx berstatus PENDING + Journal (nilai lama) ditulis sebelum data.
//     Jika eksekusi mati di tengah jalan, percobaan berikutnya mengembalikan keadaan semula (rollback)
//     lalu menjalankan ulang dari awal.
//  5. Setelah menulis, data DIBACA ULANG dari spreadsheet dan dibandingkan. Hanya jika identik,
//     tx ditandai OK dan klien diberi tahu "berhasil". Jika tidak, di-rollback dan klien diberi tahu gagal.
//  6. Pembacaan (sync) dilayani dari cache tanpa lock; cache diperbarui penulis di dalam lock.
//
// File ini digabung otomatis dengan src/lib/*.js oleh scripts/build-backend.mjs -> backend/dist/Code.gs
// =====================================================================================

// Nama sheet dan urutan kolom mengikuti backend sebelumnya (data lama tetap terbaca); kolom baru
// (id, at, _v, tx) ada di AKHIR. Sheet lama dilengkapi dengan migrate().
//   key = kolom kunci unik; _v = nomor versi baris; tx = ID transaksi terakhir yang menyentuh baris.
const SCHEMA = {
  U: { sheet: 'Users', key: 'id', cols: ['id', 'n', 'dept', 'role', 'boss', 'hp', 'off', '_v', 'tx'] },
  M: { sheet: 'Master', key: 'k', cols: ['k', 'n', 'sat', 'buf', 'kons', 'lead', '_v', 'tx'] },
  R: { sheet: 'Request', key: 'id', cols: ['id', 'by', 'tgl', 'st', 'cat', 'at', '_v', 'tx'] },
  I: { sheet: 'Item', key: 'id', cols: ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan', '_v', 'tx'] },
  K: { sheet: 'Konsolidasi', key: 'id', cols: ['id', 'dept', 'by', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan', '_v', 'tx'] },
  L: { sheet: 'SRL', key: 'no', cols: ['no', 'dept', 'est', 'tx'] },
  KD: { sheet: 'Kedatangan', key: 'id', cols: ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl', 'id', 'at', 'tx'] },
  SR: { sheet: 'SerahTerima', key: 'id', cols: ['item', 'qty', 'to', 'tgl', 'id', 'at', 'tx'] },
  RM: { sheet: 'Pengingat', key: 'id', cols: ['item', 'by', 'at', 'id', 'tx'] },
}
const TABLES = Object.keys(SCHEMA)
const TX_SHEET = 'Tx'
const TX_COLS = ['tx', 'action', 'actor', 'at', 'status', 'msg', 'ms']
const JR_SHEET = 'Journal'
const JR_COLS = ['tx', 'tabel', 'key', 'lama', 'at']

const LOCK_WAIT_MS = 20000 // maksimal menunggu giliran; lewat ini klien diminta mencoba lagi
const CACHE_TTL = 21600 // 6 jam
const CHUNK = 32000 // karakter per potongan cache (batas CacheService 100 KB per kunci)
const MAX_BODY = 600000

// ---------- util ----------
let _ss = null
function ss_() {
  if (_ss) return _ss
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID')
  _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet()
  return _ss
}
function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k)
}
function out_(s) {
  return ContentService.createTextOutput(typeof s === 'string' ? s : JSON.stringify(s)).setMimeType(ContentService.MimeType.JSON)
}
function cell_(v, col) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone()
    v = Utilities.formatDate(v, tz, v.getHours() || v.getMinutes() ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd')
  } else if (typeof v === 'boolean') v = v ? 'Y' : ''
  v = v == null ? '' : String(v)
  if (col === 'off') return v === 'Y' || v.toUpperCase() === 'TRUE'
  return v
}
// Bentuk teks baku sebuah baris (untuk menulis dan membandingkan)
function ser_(row, def) {
  return def.cols.map(c => (c === 'off' ? (row.off ? 'Y' : '') : row[c] == null ? '' : String(row[c])))
}
function serRaw_(vals, def) {
  return def.cols.map((c, i) => (c === 'off' ? (cell_(vals[i], c) ? 'Y' : '') : cell_(vals[i], c)))
}
function same_(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// ---------- membaca tabel ----------
function readTable_(t) {
  const def = SCHEMA[t]
  const sh = ss_().getSheetByName(def.sheet)
  if (!sh) throw new Error('Sheet "' + def.sheet + '" tidak ada. Jalankan setup() sekali.')
  const n = def.cols.length
  const last = sh.getLastRow()
  const vals = sh.getRange(1, 1, Math.max(last, 1), n).getValues()
  def.cols.forEach((c, i) => {
    if (String(vals[0][i]) === '' && i >= def.cols.length - 4)
      throw new Error('Sheet "' + def.sheet + '" belum dimigrasi ke versi baru. Jalankan migrate() sekali di editor Apps Script.')
    if (String(vals[0][i]) !== c)
      throw new Error('Header sheet "' + def.sheet + '" kolom ' + (i + 1) + ' harus "' + c + '" (jangan ubah/urut ulang kolom).')
  })
  const ki = def.cols.indexOf(def.key)
  const rows = []
  const seen = {}
  for (let i = 1; i < vals.length; i++) {
    const key = cell_(vals[i][ki])
    if (key === '') continue
    if (seen[key])
      throw new Error('Data ganda di sheet "' + def.sheet + '": kunci ' + key + ' muncul lebih dari sekali. Perbaiki manual (lihat auditData()).')
    seen[key] = 1
    const o = {}
    def.cols.forEach((c, j) => (o[c] = cell_(vals[i][j], c)))
    o._row = i + 1
    rows.push(o)
  }
  return rows
}
function readAll_() {
  const all = {}
  TABLES.forEach(t => (all[t] = readTable_(t)))
  return all
}

// ---------- snapshot untuk klien + cache ----------
function snapJson_(all, ver) {
  const HP = {}
  const o = { ver: ver }
  TABLES.forEach(t => {
    const keep = SCHEMA[t].cols.filter(c => c !== 'tx' && !(t === 'U' && c === 'hp'))
    o[t] = all[t].map(r => {
      const x = {}
      keep.forEach(c => (x[c] = r[c]))
      if (t === 'U' && r.hp) HP[r.id] = r.hp
      return x
    })
  })
  o.HP = HP
  return JSON.stringify(o)
}
function bumpVer_() {
  const p = PropertiesService.getScriptProperties()
  const v = (+p.getProperty('ver') || 0) + 1
  p.setProperty('ver', String(v))
  return v
}
function cachePut_(ver, json) {
  const c = CacheService.getScriptCache()
  const o = {}
  let n = 0
  for (let i = 0; i < json.length; i += CHUNK) o['snap:' + ver + ':' + n++] = json.slice(i, i + CHUNK)
  o['snapmeta'] = JSON.stringify({ ver: ver, n: n })
  c.putAll(o, CACHE_TTL)
}
function cacheGet_() {
  const c = CacheService.getScriptCache()
  const m = c.get('snapmeta')
  if (!m) return null
  const meta = JSON.parse(m)
  const keys = []
  for (let i = 0; i < meta.n; i++) keys.push('snap:' + meta.ver + ':' + i)
  const got = c.getAll(keys)
  let json = ''
  for (let i = 0; i < keys.length; i++) {
    if (got[keys[i]] == null) return null
    json += got[keys[i]]
  }
  return { ver: meta.ver, json: json }
}
// Dipanggil di dalam lock
function currentSnap_(all) {
  const c = cacheGet_()
  if (c) return c
  const ver = bumpVer_()
  const json = snapJson_(typeof all === 'function' ? all() : all, ver)
  cachePut_(ver, json)
  return { ver: ver, json: json }
}
function withSnap_(head, snap) {
  const h = JSON.stringify(head)
  return h.slice(0, -1) + ',"snap":' + snap.json + '}'
}

// ---------- Tx log / Journal ----------
function findTx_(txId) {
  const sh = ss_().getSheetByName(TX_SHEET)
  const last = sh.getLastRow()
  if (last < 2) return null
  const f = sh.getRange(2, 1, last - 1, 1).createTextFinder(txId).matchEntireCell(true).matchCase(true).findNext()
  if (!f) return null
  const row = f.getRow()
  const v = sh.getRange(row, 1, 1, TX_COLS.length).getValues()[0]
  return { row: row, status: String(v[4]), msg: String(v[5]) }
}
function putTx_(row, vals) {
  const sh = ss_().getSheetByName(TX_SHEET)
  if (row) {
    sh.getRange(row, 1, 1, TX_COLS.length).setValues([vals])
    return row
  }
  const r = sh.getLastRow() + 1
  if (sh.getMaxRows() < r) sh.insertRowsAfter(sh.getMaxRows(), 200)
  const rg = sh.getRange(r, 1, 1, TX_COLS.length)
  rg.setNumberFormat('@')
  rg.setValues([vals])
  return r
}
function writeJournal_(txId, rows) {
  if (!rows.length) return
  const sh = ss_().getSheetByName(JR_SHEET)
  const r = sh.getLastRow() + 1
  const need = r + rows.length - 1
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200)
  const rg = sh.getRange(r, 1, rows.length, JR_COLS.length)
  rg.setNumberFormat('@')
  rg.setValues(rows)
}

// Kembalikan keadaan data seperti sebelum tx dijalankan (dipakai saat verifikasi gagal atau eksekusi mati)
function rollbackTx_(txId) {
  const ss = ss_()
  const jr = ss.getSheetByName(JR_SHEET)
  const old = {}
  const jl = jr.getLastRow()
  if (jl >= 2) {
    const hits = jr.getRange(2, 1, jl - 1, 1).createTextFinder(txId).matchEntireCell(true).matchCase(true).findAll()
    hits.forEach(h => {
      const v = jr.getRange(h.getRow(), 1, 1, JR_COLS.length).getValues()[0]
      ;(old[v[1]] = old[v[1]] || {})[String(v[2])] = JSON.parse(v[3])
    })
  }
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    if (def.cols[def.cols.length - 1] !== 'tx') return
    const sh = ss.getSheetByName(def.sheet)
    const n = def.cols.length
    const last = sh.getLastRow()
    if (last < 2) return
    const data = sh.getRange(2, 1, last - 1, n).getValues()
    const ki = def.cols.indexOf(def.key)
    const del = []
    data.forEach((v, i) => {
      if (String(v[n - 1]) !== txId) return
      const key = String(v[ki])
      if (old[t] && old[t][key]) sh.getRange(i + 2, 1, 1, n).setValues([old[t][key]])
      else del.push(i + 2)
    })
    del.sort((a, b) => b - a).forEach(r => sh.deleteRow(r))
  })
  SpreadsheetApp.flush()
}

// ---------- menghitung perubahan ----------
function diff_(before, after, txId) {
  const ch = {}
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const key = def.key
    const bMap = {}
    before[t].forEach(r => (bMap[r[key]] = r))
    const seen = {}
    const add = []
    const upd = []
    after[t].forEach(r => {
      const k = String(r[key])
      if (!k) throw new Error('Aksi menghasilkan baris tanpa ID di ' + t)
      if (seen[k]) throw new Error('Aksi menghasilkan ID ganda ' + k + ' di ' + t)
      seen[k] = 1
      const b = bMap[k]
      if (!b) add.push(r)
      else if (!same_(ser_(b, def), ser_(r, def))) upd.push({ row: b._row, before: b, after: r })
    })
    before[t].forEach(r => {
      if (!seen[String(r[key])]) throw new Error('Aksi mencoba menghapus data di ' + t)
    })
    const hasV = def.cols.indexOf('_v') >= 0
    add.forEach(r => {
      if (hasV) r._v = '1'
      r.tx = txId
    })
    upd.forEach(u => {
      if (hasV) u.after._v = String((+u.before._v || 0) + 1)
      u.after.tx = txId
    })
    ch[t] = { add: add, upd: upd }
  })
  return ch
}
function runs_(sorted) {
  const res = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1].row === sorted[j].row + 1) j++
    res.push(sorted.slice(i, j + 1))
    i = j + 1
  }
  return res
}
function applyChanges_(ch) {
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const c = ch[t]
    if (!c.add.length && !c.upd.length) return
    const sh = ss_().getSheetByName(def.sheet)
    const n = def.cols.length
    runs_(c.upd.slice().sort((a, b) => a.row - b.row)).forEach(run => {
      sh.getRange(run[0].row, 1, run.length, n).setValues(run.map(u => ser_(u.after, def)))
    })
    if (c.add.length) {
      const start = sh.getLastRow() + 1
      const need = start + c.add.length - 1
      if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200)
      const rg = sh.getRange(start, 1, c.add.length, n)
      rg.setNumberFormat('@')
      rg.setValues(c.add.map(r => ser_(r, def)))
      c.addAt = start
    }
  })
  SpreadsheetApp.flush()
}
// Baca ulang dari spreadsheet dan bandingkan dengan yang seharusnya tersimpan
function verify_(ch) {
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const c = ch[t]
    if (!c.add.length && !c.upd.length) return
    const sh = ss_().getSheetByName(def.sheet)
    const n = def.cols.length
    runs_(c.upd.slice().sort((a, b) => a.row - b.row)).forEach(run => {
      const got = sh.getRange(run[0].row, 1, run.length, n).getValues()
      run.forEach((u, i) => {
        if (!same_(serRaw_(got[i], def), ser_(u.after, def))) throw new Error('Verifikasi gagal: baris ' + u.row + ' di ' + def.sheet + ' tidak sesuai.')
      })
    })
    if (c.add.length) {
      const got = sh.getRange(c.addAt, 1, c.add.length, n).getValues()
      c.add.forEach((r, i) => {
        if (!same_(serRaw_(got[i], def), ser_(r, def))) throw new Error('Verifikasi gagal: baris baru di ' + def.sheet + ' tidak sesuai.')
      })
      // setiap ID baru harus muncul tepat satu kali di seluruh sheet
      const last = sh.getLastRow()
      const kc = def.cols.indexOf(def.key) + 1
      const keys = sh.getRange(2, kc, Math.max(last - 1, 1), 1).getValues().map(x => cell_(x[0]))
      const cnt = {}
      keys.forEach(k => (cnt[k] = (cnt[k] || 0) + 1))
      c.add.forEach(r => {
        if (cnt[String(r[def.key])] !== 1) throw new Error('Verifikasi gagal: ID ' + r[def.key] + ' ganda di ' + def.sheet + '.')
      })
    }
  })
}

// ---------- hak akses (server tidak percaya peran/identitas dari klien) ----------
const ADMIN_ROLES = ['Admin Dept', 'Admin Warehouse']
const WH_ROLES = ['Admin Warehouse', 'Spv Warehouse']
function deptOfItem_(d, sel, id) {
  const i = d.I.find(x => x.id === id)
  if (!i) return null
  const r = sel.RQ(i.req)
  return r ? sel.user(r.by) && sel.user(r.by).dept : null
}
const PERM = {
  saveUser(a, args, d, sel) {
    const f = args[0] || {}
    if (f.mode === 'new') {
      if (!ADMIN_ROLES.includes(a.role)) return 'Hanya admin yang boleh menambah pengguna.'
      if (a.role === 'Admin Dept' && WH_ROLES.includes(f.role)) return 'Role tersebut tidak diizinkan untuk Anda.'
      return ''
    }
    if (f.self) return f.id === a.id ? '' : 'Anda hanya boleh mengubah profil sendiri.'
    if (!ADMIN_ROLES.includes(a.role)) return 'Hanya admin yang boleh mengubah pengguna.'
    const u = sel.user(f.id)
    if (!u) return 'Pengguna tidak ditemukan.'
    if (a.role === 'Admin Dept' && (u.dept !== a.dept || WH_ROLES.includes(f.role))) return 'Anda hanya boleh mengubah pengguna di departemen Anda.'
    return ''
  },
  saveRequest: a => (a.role === 'User' ? '' : 'Hanya user yang boleh membuat request.'),
  ajukan(a, args, d, sel) {
    const r = sel.RQ(args[0])
    return !r ? 'Request tidak ditemukan.' : r.by === a.id ? '' : 'Ini bukan request Anda.'
  },
  batal(a, args, d, sel) {
    const r = sel.RQ(args[0])
    return !r ? 'Request tidak ditemukan.' : r.by === a.id ? '' : 'Ini bukan request Anda.'
  },
  setuju(a, args, d, sel) {
    const r = sel.RQ(args[0])
    if (!r) return 'Request tidak ditemukan.'
    const u = sel.user(r.by)
    return u && u.boss === a.id ? '' : 'Anda bukan atasan pemilik request ini.'
  },
  tolak(a, args, d, sel) {
    return PERM.setuju(a, args, d, sel)
  },
  setujuAll: a => (a.role === 'Atasan' ? '' : 'Hanya atasan yang boleh menyetujui.'),
  tahan(a, args, d, sel) {
    return a.role === 'Admin Dept' && deptOfItem_(d, sel, args[0]) === a.dept ? '' : 'Barang ini bukan di departemen Anda.'
  },
  lepas(a, args, d, sel) {
    return PERM.tahan(a, args, d, sel)
  },
  simpanSrl: a => (a.role === 'Admin Dept' ? '' : 'Hanya Admin Dept yang boleh membuat SRL.'),
  tutup(a, args, d, sel) {
    const k = sel.KN(args[0])
    return a.role === 'Admin Dept' && k && k.dept === a.dept ? '' : 'Konsolidasi ini bukan di departemen Anda.'
  },
  datang: a => (a.role === 'Admin Warehouse' ? '' : 'Hanya Admin Warehouse yang boleh mencatat kedatangan.'),
  saveMaster: a => (a.role === 'Admin Warehouse' ? '' : 'Hanya Admin Warehouse yang boleh mengubah master item.'),
  importMaster: a => PERM.saveMaster(a),
  keluarkan: a => PERM.saveMaster(a),
  validasiSrl: a => PERM.saveMaster(a),
  serahAll: a => PERM.saveMaster(a),
  datangAll: a => PERM.datang(a),
  serah: a => PERM.datang(a),
  ingat: a => PERM.datang(a),
}
// Identitas pelaku selalu diambil dari server, bukan dari argumen klien
const BIND = {
  // departemen hanya boleh ditentukan Admin Warehouse
  saveUser: (a, x) => [Object.assign({}, x[0], { me: a, dept: a.role === 'Admin Warehouse' ? x[0].dept : undefined })],
  saveRequest: (a, x) => [{ status: x[0].status, lines: x[0].lines, me: a }],
  simpanSrl: (a, x) => [Object.assign({}, x[0], { me: a })],
  datang: (a, x) => [Object.assign({}, x[0], { by: a.n })],
  datangAll: (a, x) => [x[0], a.n],
  keluarkan: (a, x) => [Object.assign({}, x[0], { by: a.n })],
  ingat: (a, x) => [x[0], a.n],
  setujuAll: (a, x) => [a.id, x[1]],
}

// ---------- hasil ----------
function reject_(msg, all) {
  return withSnap_({ ok: false, rejected: true, err: msg }, currentSnap_(all))
}
function retry_(msg, extra) {
  return JSON.stringify(Object.assign({ ok: false, retry: true, err: msg }, extra || {}))
}

// ---------- tulis (inti) ----------
function write_(req) {
  const t0 = Date.now()
  const txId = String(req.tx || '')
  if (!/^TX-[A-Za-z0-9_-]{8,80}$/.test(txId)) return JSON.stringify({ ok: false, rejected: true, err: 'ID transaksi tidak valid.' })
  const name = String(req.name || '')
  if (!Object.prototype.hasOwnProperty.call(actions, name) || !PERM[name])
    return JSON.stringify({ ok: false, rejected: true, err: 'Aksi tidak dikenal.' })
  const args = Array.isArray(req.args) ? req.args : []

  // jalur cepat: tx ini sudah sukses sebelumnya
  const hit = CacheService.getScriptCache().get('tx:' + txId)
  if (hit) {
    const c = cacheGet_()
    const head = { ok: true, verified: true, replay: true, msg: JSON.parse(hit).msg }
    return c ? withSnap_(head, c) : JSON.stringify(head)
  }

  const lock = LockService.getScriptLock()
  if (!lock.tryLock(LOCK_WAIT_MS))
    return retry_('Server sedang melayani banyak pengguna. Coba lagi sebentar lagi.', { busy: true })
  try {
    return locked_(txId, name, args, String(req.me || ''), t0)
  } catch (e) {
    return retry_('Terjadi kesalahan di server: ' + (e && e.message ? e.message : e))
  } finally {
    try {
      SpreadsheetApp.flush()
    } catch (e2) {}
    lock.releaseLock()
  }
}

function locked_(txId, name, args, actorId, t0) {
  const prior = findTx_(txId)
  if (prior && prior.status === 'OK') {
    return withSnap_({ ok: true, verified: true, replay: true, msg: prior.msg }, currentSnap_(readAll_))
  }
  if (prior && prior.status === 'PENDING') {
    // eksekusi sebelumnya mati di tengah jalan: kembalikan keadaan lalu jalankan ulang dengan bersih
    rollbackTx_(txId)
    putTx_(prior.row, [txId, name, actorId, nowStr(), 'ROLLED_BACK', 'dipulihkan otomatis', ''])
  }

  const before = readAll_()
  const actor = before.U.find(u => u.id === actorId)
  if (!actor || actor.off) return reject_('Akun tidak ditemukan atau nonaktif.', before)

  // salinan kerja untuk aksi (tanpa _row), plus peta HP yang dipakai aksi
  const d = {}
  TABLES.forEach(t =>
    (d[t] = before[t].map(r => {
      const c = Object.assign({}, r)
      delete c._row
      return c
    }))
  )
  d.HP = {}
  d.U.forEach(u => {
    if (u.hp) d.HP[u.id] = u.hp
  })
  const sel = makeSel(d)

  let res
  try {
    const pe = PERM[name](actor, args, d, sel)
    if (pe) return reject_(pe, before)
    const bound = (BIND[name] || ((a, x) => x))(actor, args)
    res = actions[name](sel, d, ...bound)
  } catch (e) {
    return reject_('Permintaan tidak valid.', before)
  }
  if (res && res.err) return reject_(res.err, before)

  d.U.forEach(u => (u.hp = d.HP[u.id] || ''))
  delete d.HP
  const ch = diff_(before, d, txId)

  const nChanged = TABLES.reduce((s, t) => s + ch[t].add.length + ch[t].upd.length, 0)
  if (!nChanged) return withSnap_({ ok: true, verified: true, noop: true, msg: (res && res.ok) || '' }, currentSnap_(before))

  // --- write-ahead: Journal (nilai lama) + Tx PENDING ---
  const jr = []
  TABLES.forEach(t =>
    ch[t].upd.forEach(u => jr.push([txId, t, String(u.before[SCHEMA[t].key]), JSON.stringify(ser_(u.before, SCHEMA[t])), nowStr()]))
  )
  writeJournal_(txId, jr)
  const txRow = putTx_(prior ? prior.row : 0, [txId, name, actorId, nowStr(), 'PENDING', '', ''])

  try {
    applyChanges_(ch)
    verify_(ch)
  } catch (e) {
    try {
      rollbackTx_(txId)
      putTx_(txRow, [txId, name, actorId, nowStr(), 'FAILED', String(e.message || e).slice(0, 400), String(Date.now() - t0)])
      cacheDrop_()
    } catch (e2) {
      // rollback gagal: biarkan PENDING; percobaan berikutnya memulihkan lebih dulu
    }
    return retry_('Data gagal diverifikasi setelah disimpan, perubahan dibatalkan otomatis. Tekan Coba lagi. Tidak akan ada data ganda.')
  }

  const msg = (res && res.ok) || ''
  putTx_(txRow, [txId, name, actorId, nowStr(), 'OK', msg, String(Date.now() - t0)])
  SpreadsheetApp.flush()

  const ver = bumpVer_()
  const json = snapJson_(d, ver)
  cachePut_(ver, json)
  CacheService.getScriptCache().put('tx:' + txId, JSON.stringify({ msg: msg }), CACHE_TTL)
  return withSnap_({ ok: true, verified: true, msg: msg }, { ver: ver, json: json })
}
function cacheDrop_() {
  CacheService.getScriptCache().remove('snapmeta')
}

// ---------- baca (sync) ----------
function sync_(since) {
  let c = cacheGet_()
  if (!c) {
    const lock = LockService.getScriptLock()
    if (!lock.tryLock(LOCK_WAIT_MS)) return retry_('Server sibuk, coba lagi.', { busy: true })
    try {
      c = cacheGet_()
      if (!c) {
        const all = readAll_()
        const ver = bumpVer_()
        const json = snapJson_(all, ver)
        cachePut_(ver, json)
        c = { ver: ver, json: json }
      }
    } finally {
      lock.releaseLock()
    }
  }
  if (since && String(since) === String(c.ver)) return JSON.stringify({ ok: true, same: true, ver: c.ver })
  return withSnap_({ ok: true }, c)
}

// ---------- pintu masuk web app ----------
function authOk_(key) {
  const k = prop_('API_KEY')
  return !k || key === k
}
function doGet(e) {
  try {
    const p = (e && e.parameter) || {}
    if (!authOk_(p.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
    if (p.action === 'ping') return out_({ ok: true, time: nowStr() })
    return out_(sync_(p.since))
  } catch (err) {
    return out_(retry_('Gagal membaca data: ' + (err && err.message ? err.message : err)))
  }
}
function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || ''
    if (raw.length > MAX_BODY) return out_({ ok: false, rejected: true, err: 'Permintaan terlalu besar.' })
    const req = JSON.parse(raw)
    if (!authOk_(req.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
    return out_(write_(req))
  } catch (err) {
    return out_(retry_('Permintaan tidak dapat diproses: ' + (err && err.message ? err.message : err)))
  }
}
// Edit manual di spreadsheet harus terlihat oleh semua pengguna aplikasi
function onEdit() {
  cacheDrop_()
}

// =====================================================================================
// Administrasi (jalankan manual dari editor Apps Script)
// =====================================================================================
function setup() {
  const ss = ss_()
  const make = (name, cols, protect) => {
    let sh = ss.getSheetByName(name)
    if (!sh) sh = ss.insertSheet(name)
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns())
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, cols.length).setValues([cols])
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@')
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
    sh.setFrozenRows(1)
    if (protect && sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0) sh.protect().setWarningOnly(true) // peringatan jika diedit manual
  }
  TABLES.forEach(t => make(SCHEMA[t].sheet, SCHEMA[t].cols, t !== 'M'))
  make(TX_SHEET, TX_COLS, true)
  make(JR_SHEET, JR_COLS, true)
  const def = ss.getSheetByName('Sheet1')
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def)
  cacheDrop_()
  return 'Sheet siap. Isi sheet Users dan Master, atau jalankan seedDemo() untuk data contoh.'
}

// Meningkatkan spreadsheet dari backend lama (tanpa kolom id/_v/tx) ke versi ini TANPA kehilangan data.
// Aman dijalankan berulang. Mengisi: header kolom baru, id untuk Kedatangan/SerahTerima/Pengingat,
// _v = 1 dan tx = LEGACY untuk baris lama. Data yang sudah ada tidak diubah.
function migrate() {
  const lock = LockService.getScriptLock()
  lock.waitLock(60000)
  try {
    setup()
    const ss = ss_()
    const log = []
    TABLES.forEach(t => {
      const def = SCHEMA[t]
      const sh = ss.getSheetByName(def.sheet)
      const n = def.cols.length
      const last = Math.max(sh.getLastRow(), 1)
      const vals = sh.getRange(1, 1, last, n).getValues()
      def.cols.forEach((c, i) => {
        if (String(vals[0][i]) === '') vals[0][i] = c
        else if (String(vals[0][i]) !== c) throw new Error('Header "' + def.sheet + '" kolom ' + (i + 1) + ' berisi "' + vals[0][i] + '", seharusnya "' + c + '". Perbaiki manual lalu ulangi.')
      })
      const idC = def.cols.indexOf('id')
      const vC = def.cols.indexOf('_v')
      const txC = def.cols.indexOf('tx')
      const pre = { KD: 'KD-', SR: 'SR-', RM: 'RM-' }[t]
      let maxN = 0
      if (pre) for (let i = 1; i < vals.length; i++) maxN = Math.max(maxN, parseInt(String(vals[i][idC]).slice(3), 10) || 0)
      let touched = 0
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]) === '') continue
        let ch = false
        if (pre && String(vals[i][idC]) === '') { vals[i][idC] = pre + String(++maxN).padStart(3, '0'); ch = true }
        if (vC >= 0 && String(vals[i][vC]) === '') { vals[i][vC] = '1'; ch = true }
        if (String(vals[i][txC]) === '') { vals[i][txC] = 'LEGACY'; ch = true }
        if (ch) touched++
      }
      const rg = sh.getRange(1, 1, last, n)
      rg.setNumberFormat('@')
      rg.setValues(vals.map(r => r.map(v => (v == null ? '' : String(v)))))
      log.push(def.sheet + ': ' + touched + ' baris dilengkapi')
    })
    SpreadsheetApp.flush()
    cacheDrop_()
    return log.join('\n') + '\nSelesai. Jalankan auditData() untuk memeriksa.'
  } finally {
    lock.releaseLock()
  }
}

function seedDemo() {
  const empty = TABLES.every(t => readTable_(t).length === 0)
  if (!empty) throw new Error('seedDemo hanya boleh dijalankan saat semua sheet masih kosong.')
  const s = buildSeed()
  s.U.forEach(u => (u.hp = s.HP[u.id] || ''))
  ;['KD', 'SR', 'RM'].forEach(t => {
    const pre = { KD: 'KD-', SR: 'SR-', RM: 'RM-' }[t]
    s[t].forEach((r, i) => {
      r.id = pre + String(i + 1).padStart(3, '0')
      r.at = r.at || (r.tgl ? r.tgl + 'T09:00' : '')
    })
  })
  s.R.forEach(r => (r.at = r.at || r.tgl + 'T08:00'))
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const rows = s[t].map(r => {
      const o = Object.assign({}, r)
      if (def.cols.indexOf('_v') >= 0) o._v = '1'
      o.tx = 'SEED'
      return ser_(o, def)
    })
    if (!rows.length) return
    const sh = ss_().getSheetByName(def.sheet)
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 100)
    const rg = sh.getRange(2, 1, rows.length, def.cols.length)
    rg.setNumberFormat('@')
    rg.setValues(rows)
  })
  SpreadsheetApp.flush()
  cacheDrop_()
  return 'Data contoh dimuat.'
}

// Memeriksa kesehatan data: ID ganda, referensi yatim, transaksi menggantung
function auditData() {
  const lines = []
  let all
  try {
    all = readAll_()
  } catch (e) {
    return 'GAGAL BACA: ' + e.message
  }
  const ids = t => new Set(all[t].map(r => r[SCHEMA[t].key]))
  const R = ids('R'), I = ids('I'), K = ids('K'), U = ids('U'), M = ids('M')
  all.R.forEach(r => { if (!U.has(r.by)) lines.push('Request ' + r.id + ': pemilik ' + r.by + ' tidak ada di Users') })
  all.I.forEach(i => {
    if (!R.has(i.req)) lines.push('Item ' + i.id + ': request ' + i.req + ' tidak ada')
    if (!M.has(i.kode)) lines.push('Item ' + i.id + ': barang ' + i.kode + ' tidak ada di Master')
    if (i.kon && !K.has(i.kon)) lines.push('Item ' + i.id + ': konsolidasi ' + i.kon + ' tidak ada')
  })
  all.KD.forEach(x => { if (!K.has(x.kon)) lines.push('Kedatangan ' + x.id + ': konsolidasi ' + x.kon + ' tidak ada') })
  all.SR.forEach(x => { if (!I.has(x.item)) lines.push('Serah terima ' + x.id + ': item ' + x.item + ' tidak ada') })
  all.K.forEach(k => {
    if (+k.tutup < 0) lines.push('Konsolidasi ' + k.id + ': nilai tutup negatif')
  })
  const tx = ss_().getSheetByName(TX_SHEET)
  if (tx.getLastRow() > 1) {
    tx.getRange(2, 1, tx.getLastRow() - 1, TX_COLS.length).getValues().forEach(v => {
      if (String(v[4]) === 'PENDING') lines.push('Transaksi ' + v[0] + ' masih PENDING (akan dipulihkan otomatis saat dikirim ulang)')
    })
  }
  return lines.length ? lines.join('\n') : 'OK: tidak ada masalah ditemukan.'
}

// Bersihkan Journal > 14 hari dan Tx > 120 hari. Pasang sebagai trigger mingguan lewat installTriggers().
function housekeeping() {
  const prune = (name, atCol, days) => {
    const sh = ss_().getSheetByName(name)
    const last = sh.getLastRow()
    if (last < 2) return 0
    const lim = Date.now() - days * 864e5
    const v = sh.getRange(2, atCol, last - 1, 1).getValues()
    const del = []
    v.forEach((x, i) => {
      const t = Date.parse(String(x[0]))
      if (!isNaN(t) && t < lim) del.push(i + 2)
    })
    del.reverse().forEach(r => sh.deleteRow(r))
    return del.length
  }
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) return 'sibuk'
  try {
    return 'Journal dihapus: ' + prune(JR_SHEET, 5, 14) + ', Tx dihapus: ' + prune(TX_SHEET, 4, 120)
  } finally {
    lock.releaseLock()
  }
}
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'housekeeping') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('housekeeping').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create()
  return 'Trigger mingguan housekeeping terpasang.'
}

