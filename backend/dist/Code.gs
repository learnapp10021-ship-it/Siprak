// ============================================================================
// FILE HASIL BUILD -- JANGAN DIEDIT LANGSUNG.
// Sumber: src/lib/utils.js, selectors.js, actions.js, src/data/seed.js, backend/src/server.gs, backend/src/rules.gs
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
// "Hari ini" dihitung saat dimuat, lalu disegarkan lewat refreshToday(): tab/PWA di HP sering terbuka
// melewati tengah malam, dan tanpa penyegaran status "terlambat" serta tanggal minimum jadi salah.
// (Di Apps Script setiap permintaan adalah eksekusi baru, jadi nilainya selalu segar.)
let TODAY = todayStr()
// Mengembalikan true bila hari berganti sejak pemuatan/penyegaran terakhir.
const refreshToday = () => {
  const t = todayStr()
  if (t === TODAY) return false
  TODAY = t
  return true
}

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
// Format tanggal pendek Indonesia, tanpa Intl supaya sama di browser dan Google Apps Script
const D = d => (d ? +d.slice(8, 10) + ' ' + BLN[+d.slice(5, 7) - 1] : 'belum diisi')

// "2026-11" -> "Nov 2026"
const monthLabel = ym => (ym ? BLN[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4) : '')

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
// cache: true HANYA untuk render (db beku/immutable): pencarian jadi Map sehingga ratusan SRL tetap mulus.
// Aksi dan server memakai makeSel(db) biasa karena db berubah di tengah aksi (cache akan basi).
function makeSel(db, { cache = false } = {}) {
  const { U, M, R, I, K, L, KD, SR, RM } = db

  const live = i => !['Ditolak', 'Dibatalkan'].includes(i.status)

  // ---- indeks malas (hanya dipakai bila cache) ----
  const EMPTY = []
  const lazy = f => { let v, ok = false; return () => (ok ? v : ((ok = true), (v = f()))) }
  const firstBy = (arr, key) => {
    const m = lazy(() => { const o = new Map(); for (const x of arr) if (!o.has(x[key])) o.set(x[key], x); return o })
    return v => m().get(v)
  }
  const groupBy = (get, key) => {
    const m = lazy(() => { const o = new Map(); for (const x of get()) { const a = o.get(x[key]); a ? a.push(x) : o.set(x[key], [x]) } return o })
    return v => m().get(v) || EMPTY
  }
  const liveByKon = cache ? groupBy(() => I.filter(live), 'kon') : null
  const kdByKon = cache ? groupBy(() => KD, 'kon') : null
  const srByItem = cache ? groupBy(() => SR, 'item') : null
  const itemsByReq = cache ? groupBy(() => I, 'req') : null
  const sortedMemo = new Map()
  const liveSorted = kon => {
    if (!cache) return I.filter(i => i.kon == kon && live(i)).sort(ord)
    let a = sortedMemo.get(kon)
    if (!a) sortedMemo.set(kon, (a = [...liveByKon(kon)].sort(ord)))
    return a
  }

  const user = cache ? firstBy(U, 'id') : id => U.find(u => u.id == id)
  const nm = id => user(id)?.n || id
  const mi = cache ? firstBy(M, 'k') : k => M.find(m => m.k == k)
  const KN = cache ? firstBy(K, 'id') : id => K.find(k => k.id == id)
  const RQ = cache ? firstBy(R, 'id') : id => R.find(r => r.id == id)
  const SRLof = cache ? firstBy(L, 'no') : no => L.find(l => l.no == no)

  const total = cache ? k => sum(liveByKon(k.id), i => i.qty) : k => sum(I.filter(i => i.kon == k.id && live(i)), i => i.qty)
  const datang = cache ? k => sum(kdByKon(k.id), d => d.qty) : k => sum(KD.filter(d => d.kon == k.id), d => d.qty)
  const sisa = k => Math.max(0, total(k) - datang(k) - +k.tutup)

  // urut kebutuhan paling dekat; tanpa tgl pakai dianggap paling akhir
  // Pembanding harus konsisten: untuk dua nilai yang sama hasilnya 0 (urutan awal dipertahankan oleh sort yang stabil).
  const ord = (a, b) => {
    const pa = a.pakai || '9'
    const pb = b.pakai || '9'
    if (pa !== pb) return pa < pb ? -1 : 1
    return a.appr < b.appr ? -1 : a.appr > b.appr ? 1 : 0
  }

  // Jatah barang yang sudah datang dibagi ke request sesuai urutan kebutuhan
  const berhak = it => {
    const k = KN(it.kon)
    if (!k) return 0
    let r = datang(k)
    for (const x of liveSorted(k.id)) {
      const g = Math.min(r, +x.qty)
      if (x.id == it.id) return g
      r -= g
    }
    return 0
  }
  const takenOf = cache ? id => srByItem(id) : id => SR.filter(s => s.item == id)
  const itemsOf = cache ? id => itemsByReq(id) : id => I.filter(i => i.req == id)
  const diambil = it => sum(takenOf(it.id), s => s.qty)
  const siap = it => berhak(it) - diambil(it)
  const deptOf = it => user(RQ(it.req)?.by)?.dept
  const kdOf = kon => (cache ? kdByKon(kon) : KD.filter(d => d.kon == kon))
  const lastArrival = kon => kdOf(kon).map(d => d.tgl).sort().pop()
  const firstArrival = kon => kdOf(kon).map(d => d.tgl).sort()[0]

  // [tahap 0-5 (0 Diajukan, 1 Disetujui, 2 Validasi, 3 Di ERO, 4 Telah tiba, 5 Diambil), kelas warna, label]
  const st = it => {
    const s = it.status
    // Data bisa diedit manual di spreadsheet: kode yang salah ketik tidak boleh membuat seluruh layar mati
    const sat = mi(it.kode)?.sat || ''
    if (s == 'Draft') return [0, 't-gray', 'Draft, belum diajukan']
    if (s == 'Menunggu Approval') return [0, 't-warn', 'Menunggu persetujuan atasan']
    if (s == 'Approved')
      return it.tahan
        ? [1, 't-warn', 'Ditahan: ' + it.alasan]
        : it.alasan
        ? [1, 't-warn', it.alasan]
        : [1, 't-info', 'Disetujui, menunggu diproses ke ERO']
    if (s == 'Validasi Warehouse') return [2, 't-warn', (KN(it.kon)?.srl || 'SRL') + ' menunggu validasi Warehouse']
    if (s == 'Masuk Konsolidasi') return [2, 't-vio', 'Dikonsolidasi, belum masuk ERO']
    if (s == 'Sudah di ERO') {
      const b = berhak(it)
      const a = diambil(it)
      if (a >= +it.qty) return [5, 't-ok', 'Sudah diambil semua']
      // Admin Warehouse sudah mencatat kedatangan: barang telah tiba dan menunggu diambil
      if (b - a > 0) return [4, 't-ok', `Telah tiba, siap diambil ${b - a} dari ${it.qty} ${sat}`]
      // Tidak ada lagi yang akan datang (sisa ditutup): jangan menunggu selamanya
      const kk = KN(it.kon)
      if (kk && sisa(kk) == 0 && +kk.tutup > 0)
        return [5, 't-warn', `Sisa ditutup${kk.alasan ? ': ' + kk.alasan : ''}. Diambil ${a} dari ${it.qty} ${sat}`]
      const srl = SRLof(kk?.srl)
      return [
        3,
        't-vio',
        'Sudah di ERO (' + (kk?.srl || 'SRL') + '), menunggu barang datang' +
          (srl ? ' (est. ' + D(srl.est) + ')' : ''),
      ]
    }
    return [-1, s == 'Ditolak' ? 't-bad' : 't-gray', s]
  }

  // Persen proses 0-100 untuk cincin progres: tahap alur, lalu (setelah masuk ERO) barang datang (sampai 90) dan diambil (sampai 100).
  // 100 HANYA bila barang tuntas (itemDone): angka di cincin selalu sama dengan aturan "pindah ke Histori".
  // Barang yang sudah datang tetapi belum diambil berhenti di 90 supaya tetap terlihat butuh tindakan.
  const progress = it => {
    const s = it.status
    if (s == 'Draft') return 0
    if (s == 'Menunggu Approval') return 15
    if (s == 'Approved') return 35
    if (s == 'Validasi Warehouse' || s == 'Masuk Konsolidasi') return 50
    if (s == 'Sudah di ERO') {
      if (itemDone(it)) return 100
      const q = +it.qty || 1
      const tiba = Math.min(1, Math.max(berhak(it), diambil(it)) / q)
      const ambil = Math.min(1, diambil(it) / q)
      return Math.min(99, Math.round(65 + 25 * tiba + 10 * ambil))
    }
    return 0
  }

  // Barang sudah tuntas: tidak ada lagi yang perlu ditunggu atau diambil.
  // Tuntas = ditolak/dibatalkan, sudah diambil semua, atau sisa ditutup dan semua yang datang sudah diambil.
  const itemDone = it => {
    if (!live(it)) return true
    if (it.status != 'Sudah di ERO') return false
    const a = diambil(it)
    if (a >= +it.qty) return true
    const k = KN(it.kon)
    return !!k && +k.tutup > 0 && sisa(k) == 0 && berhak(it) - a <= 0
  }

  // Akhir riwayat sebuah request: 'Selesai' (semua barang tuntas), 'Ditolak', 'Dibatalkan', atau '' bila masih berjalan.
  // Satu-satunya definisi "request selesai"; daftar aktif dan histori sama-sama memakainya.
  const reqEnd = r => {
    if (r.st == 'Ditolak' || r.st == 'Dibatalkan') return r.st
    if (r.st != 'Disetujui') return ''
    const its = itemsOf(r.id)
    return its.length > 0 && its.every(itemDone) ? 'Selesai' : ''
  }

  // Posisi antrian dalam konsolidasi yang sama (urutan kebutuhan), plus jumlah barang di depannya
  const antrian = it => {
    const k = KN(it.kon)
    if (!k) return null
    const arr = liveSorted(k.id)
    const idx = arr.findIndex(i => i.id == it.id)
    if (idx < 0) return null
    return { pos: idx + 1, n: arr.length, ahead: sum(arr.slice(0, idx), i => i.qty) }
  }

  const poolAll = d => I.filter(i => i.status == 'Approved' && !i.kon && RQ(i.req) && deptOf(i) == d)
  const poolOf = d => poolAll(d).filter(i => !i.tahan)

  return {
    user, nm, mi, KN, RQ, SRLof, live, total, datang, sisa, ord, berhak, diambil, siap,
    itemsOf, takenOf, itemDone, reqEnd,
    deptOf, lastArrival, firstArrival, st, progress, antrian, poolAll, poolOf,
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

// Galat per kolom untuk satu baris barang: { kode?, qty?, datang?, pakai? }. Satu-satunya sumber aturan baris;
// dipakai server (lewat checkLines) dan layar Buat request (untuk menandai kolom yang salah).
const lineErrors = (sel, x) => {
  const m = x.kode && sel.mi(x.kode)
  if (!m) return { kode: 'Pilih barang di setiap baris.' }
  const e = {}
  if (!(+x.qty > 0) || !isFinite(+x.qty)) e.qty = 'Jumlah harus lebih dari 0.'
  if (!x.datang || x.datang < addDays(TODAY, +m.lead)) e.datang = `${m.n}: tgl datang paling cepat ${D(addDays(TODAY, +m.lead))}.`
  if (m.buf == '0' && !x.pakai) e.pakai = `${m.n}: tgl pakai wajib untuk barang non buffer.`
  else if (x.pakai && x.pakai < x.datang) e.pakai = `${m.n}: tgl pakai tidak boleh sebelum tgl datang.`
  return e
}

// Validasi baris barang (dipakai saat simpan dan saat Ajukan draft). Mengembalikan pesan galat pertama atau ''.
const checkLines = (sel, lines) => {
  for (const x of lines) {
    const e = lineErrors(sel, x)
    const k = ['kode', 'qty', 'datang', 'pakai'].find(f => e[f])
    if (k) return e[k]
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
      d.K.push({ id, dept, by: me.id, kode: k, tahap: 'Validasi Warehouse', srl: no, ero: String(sum(a, i => i.qty)), tutup: '0', alasan: '' })
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
    d.SR.push({ id: nextId(d.SR, 'SR-'), item: id, qty: String(q), to: sel.RQ(i.req).by, tgl: TODAY, at: nowStr() })
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

  // qtys (opsional) = { [idBarang]: jumlah } untuk serah terima sebagian; tanpa itu, semua yang siap diserahkan.
  // Jumlah tidak pernah melebihi yang siap; baris yang tidak valid dilewati, sisanya tetap diproses.
  serahAll(sel, d, ids, qtys) {
    let n = 0
    const to = new Set()
    ;(ids || []).forEach(id => {
      const i = d.I.find(x => x.id == id)
      const mx = i && i.status == 'Sudah di ERO' ? sel.siap(i) : 0
      const want = qtys && qtys[id] != null ? +qtys[id] : mx
      const q = Math.min(mx, want)
      if (!(q > 0)) return
      const by = sel.RQ(i.req).by
      to.add(by)
      d.SR.push({ id: nextId(d.SR, 'SR-'), item: id, qty: String(q), to: by, tgl: TODAY, at: nowStr() })
      n++
    })
    if (!n) return { err: 'Tidak ada barang yang siap diserahkan (mungkin sudah diserahkan admin lain).' }
    return { ok: n + ' barang diserahkan ke ' + [...to].map(u => sel.nm(u)).join(', ') + '.' }
  },
  // Pengingat untuk banyak barang sekaligus (satu pesan WA ke satu penerima): satu panggilan, bukan satu per barang.
  ingatAll(sel, d, ids, by) {
    ;(ids || []).forEach(id => {
      if (!d.I.find(x => x.id == id)) return
      if (d.RM.find(x => x.item == id && x.by == by && minsAgo(x.at) <= 1)) return
      d.RM.push({ id: nextId(d.RM, 'RM-'), item: id, by, at: nowStr() })
    })
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
agus.spv|Agus Prasetyo|Warehouse|Spv Warehouse|
dika.prod|Dika Pratama|Produksi|User|budi.spv
lina.mt|Lina Wulandari|Maintenance|User|tono.spv
eko.prod|Eko Nugroho|Produksi|User|budi.spv`,
    ['id', 'n', 'dept', 'role', 'boss']
  )
  const HP = {
    'hendra.mgr': '6281234560001', 'budi.spv': '6281234560002', 'andi.prod': '6281234560003',
    'siti.prod': '6281234560004', 'rudi.prod': '6281234560005', 'dewi.admin': '6281234560006',
    'tono.spv': '6281234560007', 'maya.mt': '6281234560008', 'rina.mt': '6281234560009',
    'yani.admin': '6281234560010', 'wati.wh': '6281234560011', 'joko.wh': '6281234560012',
    'agus.spv': '6281234560013', 'dika.prod': '6281234560014', 'lina.mt': '6281234560015',
    'eko.prod': '6281234560016',
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
    `KON-001|15|0|wati.wh||2026-11-16
KON-002|20|5|wati.wh|Supplier kirim 25, kelebihan 5 dicatat terpisah|2026-11-16
KON-003|4|0|joko.wh||2026-11-17`,
    ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl']
  )
  const SR = T(
    `ITM-003|10|siti.prod
ITM-002|20|andi.prod`,
    ['item', 'qty', 'to']
  )

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
        if (i < 3 && !j) SR.push({ item: id, qty: String(q), to: P[r] })
      })
      K.push({ id: kid, dept: 'Produksi', kode: k, tahap: 'Sudah di ERO', srl: no, ero: String(tot), tutup: '0', alasan: '' })
      if (i < 6)
        KD.push({ kon: kid, qty: String(tot), lebih: '0', by: 'wati.wh', cat: '', tgl: '2026-11-18' })
      else if (i < 12)
        KD.push({ kon: kid, qty: String(Math.floor(tot / 2) || 1), lebih: '0', by: 'joko.wh', cat: '', tgl: '2026-11-21' })
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
  K.forEach(k => (k.by = k.dept == 'Produksi' ? 'dewi.admin' : 'yani.admin'))
  SR.forEach((s, n) => (s.tgl = addDays('2026-11-18', n % 3)))

  // ===== Data contoh lengkap: semua tahap proses, kedua departemen =====
  {
    const B = '2026-11-23'
    const WT = 'Wati Handayani', JK = 'Joko Susilo' // hanya untuk teks alasan; kolom relasi memakai ID
    const WI = 'wati.wh', JI = 'joko.wh'
    U.find(u => u.id == 'eko.prod').off = true // contoh akun nonaktif
    const buf = k => M.find(m => m.k == k).buf == '1'
    const rq = (id, by, tgl, st, cat = '') => R.push({ id, by, tgl, st, cat })
    const it = (req, kode, qty, o = {}) => {
      const id = 'ITM-' + String(I.length + 1).padStart(3, '0')
      I.push({ id, req, kode, qty: String(qty), datang: '', pakai: '', status: 'Draft', appr: '', kon: '', tahan: '', alasan: '', ...o })
      return id
    }
    // tanggal butuh: non-buffer wajib punya tgl pakai
    const need = (kode, dDatang, dPakai) => ({ datang: addDays(B, dDatang), pakai: buf(kode) ? '' : addDays(B, dPakai) })
    const apr = (tgl, m) => tgl + 'T08:' + String(m).padStart(2, '0')

    // --- Menunggu approval atasan (Produksi: Budi, Maintenance: Tono)
    rq('RQ-022', 'dika.prod', addDays(B, -1), 'Menunggu Approval')
    ;[['SRG-001', 20, 10, 14], ['APD-007', 10, 12, 0], ['KBL-006', 4, 9, 13]].forEach(([k, q, a, b]) => it('RQ-022', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    rq('RQ-023', 'siti.prod', B, 'Menunggu Approval')
    ;[['LAS-021', 15, 8, 12], ['GRD-101', 6, 8, 11]].forEach(([k, q, a, b]) => it('RQ-023', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    rq('RQ-024', 'maya.mt', B, 'Menunggu Approval')
    ;[['BRG-205', 4, 9, 0], ['SEL-601', 6, 8, 0]].forEach(([k, q, a, b]) => it('RQ-024', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    rq('RQ-025', 'lina.mt', addDays(B, -1), 'Menunggu Approval')
    ;[['CTR-801', 2, 8, 12], ['LMP-701', 3, 10, 14], ['KBL-005', 6, 7, 10]].forEach(([k, q, a, b]) => it('RQ-025', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    // --- Draft
    rq('RQ-026', 'rudi.prod', B, 'Draft')
    it('RQ-026', 'OLI-010', 2, { ...need('OLI-010', 9, 13), status: 'Draft' })
    rq('RQ-027', 'rina.mt', addDays(B, -1), 'Draft')
    ;[['FTG-501', 12, 9, 12], ['SLG-402', 6, 8, 11]].forEach(([k, q, a, b]) => it('RQ-027', k, q, { ...need(k, a, b), status: 'Draft' }))
    // --- Ditolak (catatan atasan) dan Dibatalkan
    rq('RQ-028', 'andi.prod', addDays(B, -4), 'Ditolak', 'Stok masih ada di gudang line 2, cek dulu sebelum request')
    it('RQ-028', 'BOR-201', 10, { ...need('BOR-201', 6, 10), status: 'Ditolak' })
    rq('RQ-029', 'lina.mt', addDays(B, -3), 'Ditolak', 'Anggaran bulan ini sudah habis, ajukan lagi bulan depan')
    it('RQ-029', 'VBT-401', 2, { ...need('VBT-401', 7, 0), status: 'Ditolak' })
    rq('RQ-030', 'dika.prod', addDays(B, -6), 'Dibatalkan')
    it('RQ-030', 'GRD-102', 5, { ...need('GRD-102', 6, 9), status: 'Dibatalkan' })

    // --- Pool Admin Dept: disetujui, belum dibuat di ERO (termasuk ditahan)
    const ap = (id, by, d, rows) => {
      rq(id, by, addDays(B, d), 'Disetujui')
      rows.forEach(([k, q, a, b, o]) => it(id, k, q, { ...need(k, a, b), status: 'Approved', appr: apr(addDays(B, d + 1), 15), ...o }))
    }
    ap('RQ-031', 'andi.prod', -3, [['BOR-202', 8, 7, 10], ['BLT-301', 3, 8, 0], ['SLG-401', 30, 10, 14, { tahan: 'Y', alasan: 'Menunggu konfirmasi panjang selang dari produksi' }]])
    ap('RQ-032', 'rudi.prod', -2, [['GRD-102', 10, 7, 9], ['FTG-501', 20, 8, 11]])
    ap('RQ-033', 'maya.mt', -3, [['BRG-206', 4, 8, 0], ['VBT-401', 2, 7, 0], ['CTR-801', 2, 8, 12]])
    ap('RQ-034', 'lina.mt', -2, [['LMP-701', 3, 9, 13], ['FTG-501', 10, 8, 11, { tahan: 'Y', alasan: 'Tunggu ukuran fitting dari teknisi' }]])
    // Dikeluarkan Warehouse dari SRL-2611-006 (semua barang dikeluarkan) -> kembali ke pool dengan alasan
    L.push({ no: 'SRL-2611-006', dept: 'Maintenance', est: addDays(B, 7) })
    rq('RQ-035', 'rina.mt', addDays(B, -5), 'Disetujui')
    ;[['SKR-901', 3, 7, 0], ['BRG-205', 6, 9, 0]].forEach(([k, q, a, b], n) => {
      it('RQ-035', k, q, { ...need(k, a, b), status: 'Approved', appr: apr(addDays(B, -4), 20 + n), alasan: 'Dikeluarkan Warehouse (' + WT + ') dari SRL-2611-006: Jumlah tidak sesuai dengan permintaan' })
    })

    let kn = Math.max(...K.map(k => +k.id.slice(4)))
    const kon = (dept, kode, tahap, srl, ero, o = {}) => {
      const id = 'KON-' + String(++kn).padStart(3, '0')
      K.push({ id, dept, kode, tahap, srl, ero: String(ero), tutup: '0', alasan: '', by: dept == 'Produksi' ? 'dewi.admin' : 'yani.admin', ...o })
      return id
    }
    kon('Maintenance', 'SKR-901', 'Dikeluarkan', 'SRL-2611-006', 0, { alasan: 'Jumlah tidak sesuai dengan permintaan' })
    kon('Maintenance', 'BRG-205', 'Dikeluarkan', 'SRL-2611-006', 0, { alasan: 'Jumlah tidak sesuai dengan permintaan' })

    // --- SRL sudah di ERO. lines: [kode, [[req, jumlah], ...], jumlah datang (null = semua), kelebihan, catatan, tutup, alasan tutup]
    const srl = (no, dept, est, tglReq, reqs, lines, tglDatang, by) => {
      L.push({ no, dept, est })
      Object.entries(reqs).forEach(([id, u]) => rq(id, u, addDays(B, tglReq), 'Disetujui'))
      lines.forEach(([kode, rs, dtg, lebih, cat, tutup, alasan], li) => {
        let tot = 0
        const kid = 'KON-' + String(kn + 1).padStart(3, '0')
        rs.forEach(([rid, q], j) => {
          tot += q
          it(rid, kode, q, { datang: est, pakai: buf(kode) ? '' : addDays(est, 4 + li + j), status: 'Sudah di ERO', appr: apr(addDays(B, tglReq + 1), 10 + li * 3 + j), kon: kid })
        })
        kon(dept, kode, 'Sudah di ERO', no, tot, tutup ? { tutup: String(tutup), alasan } : {})
        const dq = dtg == null ? tot : dtg
        if (dq > 0 || lebih) KD.push({ kon: kid, qty: String(dq), lebih: String(lebih || 0), by, cat: cat || '', tgl: tglDatang })
      })
    }
    // 1) Selesai penuh: barang datang semua dan sudah diserahkan semua
    srl('SRL-2611-007', 'Produksi', addDays(B, -8), -14, { 'RQ-036': 'andi.prod', 'RQ-037': 'siti.prod' }, [
      ['GRD-101', [['RQ-036', 6], ['RQ-037', 4]]],
      ['BOR-201', [['RQ-036', 4], ['RQ-037', 3]]],
      ['KBL-006', [['RQ-037', 5]], null, 2, 'Supplier kirim lebih 2 roll, dicatat terpisah'],
    ], addDays(B, -7), WI)
    // 2) Sebagian datang, ada barang ditutup sisanya
    srl('SRL-2611-008', 'Maintenance', addDays(B, -4), -10, { 'RQ-038': 'maya.mt', 'RQ-039': 'rina.mt' }, [
      ['BRG-205', [['RQ-038', 4], ['RQ-039', 6]], 6],
      ['SEL-601', [['RQ-038', 3], ['RQ-039', 5]]],
      ['CTR-801', [['RQ-038', 2]], 0, 0, '', 2, 'Supplier tidak bisa kirim, item discontinue'],
    ], addDays(B, -3), JI)
    // 3) Terlambat: estimasi sudah lewat, belum ada kedatangan
    srl('SRL-2611-009', 'Produksi', addDays(B, -3), -9, { 'RQ-040': 'dika.prod', 'RQ-041': 'rudi.prod' }, [
      ['LAS-021', [['RQ-040', 10], ['RQ-041', 5]], 0],
      ['OLI-010', [['RQ-040', 4]], 0],
    ], B, WI)
    // 4) Belum waktunya datang (estimasi ke depan)
    srl('SRL-2611-010', 'Maintenance', addDays(B, 5), -3, { 'RQ-042': 'maya.mt' }, [
      ['LKT-101', [['RQ-042', 6]], 0],
      ['PNT-201', [['RQ-042', 3]], 0],
      ['KBL-006', [['RQ-042', 2]], 0],
    ], B, JI)
    // 5) Datang sebagian hari ini, belum diserahkan
    srl('SRL-2611-011', 'Produksi', addDays(B, -1), -6, { 'RQ-043': 'andi.prod', 'RQ-044': 'dika.prod' }, [
      ['SLG-402', [['RQ-043', 8], ['RQ-044', 6]], 8],
      ['LMP-701', [['RQ-043', 2], ['RQ-044', 2]], 4],
      ['PNT-201', [['RQ-044', 5]], 0],
    ], B, JI)

    // Serah terima: hitung jatah dengan aturan aplikasi supaya tidak melebihi jatah
    const sl = makeSel({ U, HP, M, R, I, K, L, KD, SR, RM: [] })
    const to = it => R.find(r => r.id == it.req).by
    const serah = (it, q, d) => q > 0 && SR.push({ item: it.id, qty: String(q), to: to(it), tgl: addDays(B, d) })
    I.filter(i => ['SRL-2611-007'].includes(sl.KN(i.kon)?.srl)).forEach((i, n) => serah(i, sl.siap(i), -6 + (n % 3)))
    I.filter(i => sl.KN(i.kon)?.srl == 'SRL-2611-008').forEach((i, n) => serah(i, n % 2 ? Math.ceil(sl.siap(i) / 2) : 0, -2))
    I.filter(i => sl.KN(i.kon)?.srl == 'SRL-2611-011').forEach((i, n) => serah(i, n == 0 ? Math.floor(sl.siap(i) / 2) : 0, 0))
  }

  const db = { U, HP, M, R, I, K, L, KD, SR, RM: [] }
  // Contoh riwayat pengingat
  const sel = makeSel(db)
  db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).forEach((i, n) => {
    for (let c = 0; c < n % 4; c++)
      db.RM.push({ item: i.id, by: 'wati.wh', at: addDays(TODAY, -((n % 4) - c)) + 'T09:00' })
  })
  return db
}


// ---------- backend/src/server.gs ----------
// =====================================================================================
// NRB server (Google Apps Script) -- Google Spreadsheet sebagai database
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
// File ini digabung otomatis dengan src/lib/*.js dan rules.gs oleh scripts/build-backend.mjs -> backend/dist/Code.gs
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
  // Versi di cache harus sama dengan versi server (sumber kebenaran: Script Properties).
  // Beda = cache basi (mis. gagal ditulis setelah commit) -> jangan dilayani, bangun ulang dari sheet.
  if (String(meta.ver) !== String(prop_('ver') || '0')) return null
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

// Transaksi berstatus PENDING = eksekusi mati di tengah penulisan (timeout, kuota, galat Sheets).
// Pemegang lock berikutnya WAJIB membatalkannya (rollback) SEBELUM membaca data. Tanpa ini, data setengah jadi
// ikut menjadi dasar transaksi orang lain (ID melompat, baris yatim permanen) dan ikut terbit ke semua klien.
// Hanya dipanggil saat memegang lock. PENDING selalu ada di baris-baris terbaru sheet Tx.
function recoverOrphans_() {
  const sh = ss_().getSheetByName(TX_SHEET)
  if (!sh) return 0 // belum di-setup/migrasi: readAll_ yang akan memberi petunjuk
  const last = sh.getLastRow()
  if (last < 2) return 0
  const from = Math.max(2, last - 199)
  const v = sh.getRange(from, 1, last - from + 1, TX_COLS.length).getValues()
  let n = 0
  v.forEach((x, i) => {
    if (String(x[4]) !== 'PENDING') return
    rollbackTx_(String(x[0]))
    putTx_(from + i, [x[0], x[1], x[2], nowStr(), 'ROLLED_BACK', 'dipulihkan otomatis (eksekusi sebelumnya terhenti)', ''])
    n++
  })
  if (n) cacheDrop_()
  return n
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
  ingatAll: a => PERM.datang(a),
}
// Identitas pelaku selalu diambil dari server, bukan dari argumen klien
const BIND = {
  // departemen hanya boleh ditentukan Admin Warehouse
  saveUser: (a, x) => [Object.assign({}, x[0], { me: a, dept: a.role === 'Admin Warehouse' ? x[0].dept : undefined })],
  saveRequest: (a, x) => [{ status: x[0].status, lines: x[0].lines, me: a }],
  simpanSrl: (a, x) => [Object.assign({}, x[0], { me: a })],
  datang: (a, x) => [Object.assign({}, x[0], { by: a.id })],
  datangAll: (a, x) => [x[0], a.id],
  keluarkan: (a, x) => [Object.assign({}, x[0], { by: a.n })],
  ingat: (a, x) => [x[0], a.id],
  ingatAll: (a, x) => [x[0], a.id],
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
    // tanpa snapshot yang sah (cache kosong/basi) jangan balas tanpa data: lanjut ke jalur lock yang membangunnya
    if (c) return withSnap_({ ok: true, verified: true, replay: true, msg: JSON.parse(hit).msg }, c)
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
  recoverOrphans_() // pulihkan transaksi menggantung milik siapa pun sebelum membaca data
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

  // relasi & aturan data (rules.gs): aksi yang menghasilkan data tidak sah ditolak sebelum ada yang ditulis
  const bad = validateChange_(d, ch)
  if (bad.length) {
    const pre = bad.some(e => e.c) ? 'Jumlah tidak cocok dengan data terbaru (mungkin diubah pengguna lain): ' : 'Data tidak valid: '
    return reject_(pre + bad.slice(0, 2).map(e => e.m).join(' | '), before)
  }

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

  // Data SUDAH tersimpan dan terverifikasi (Tx = OK). Galat cache sesudah titik ini tidak boleh membuat klien
  // mengira gagal: cukup kosongkan cache; klien menyinkronkan sendiri dan kirim ulang hanya menjadi replay.
  try {
    CacheService.getScriptCache().put('tx:' + txId, JSON.stringify({ msg: msg }), CACHE_TTL)
    const ver = bumpVer_()
    const json = snapJson_(d, ver)
    cachePut_(ver, json)
    return withSnap_({ ok: true, verified: true, msg: msg }, { ver: ver, json: json })
  } catch (e) {
    try {
      cacheDrop_()
    } catch (e2) {}
    return JSON.stringify({ ok: true, verified: true, msg: msg })
  }
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
        recoverOrphans_() // jangan terbitkan data setengah jadi dari eksekusi yang mati
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
    log.push(migrateNames_())
    SpreadsheetApp.flush()
    cacheDrop_()
    return log.join('\n') + '\nSelesai. Jalankan auditData() untuk memeriksa.'
  } finally {
    lock.releaseLock()
  }
}

// Dulu Konsolidasi.by, Kedatangan.by, SerahTerima.to, dan Pengingat.by berisi NAMA pengguna; sekarang berisi ID.
// Nama yang cocok dengan tepat satu pengguna diganti ID-nya; yang tidak cocok/ganda dilaporkan, tidak diubah.
function migrateNames_() {
  const users = readTable_('U')
  const byId = {}, byName = {}
  users.forEach(u => {
    byId[u.id] = 1
    const k = String(u.n).toLowerCase().trim()
    byName[k] = vHas_(byName, k) ? null : u.id // null = nama ganda
  })
  let changed = 0
  const rep = []
  ;[['K', 'by'], ['KD', 'by'], ['SR', 'to'], ['RM', 'by']].forEach(tc => {
    const def = SCHEMA[tc[0]], sh = ss_().getSheetByName(def.sheet), last = sh.getLastRow()
    if (last < 2) return
    const rg = sh.getRange(2, def.cols.indexOf(tc[1]) + 1, last - 1, 1)
    const vals = rg.getValues()
    let dirty = false
    vals.forEach((row, i) => {
      const v = String(row[0] == null ? '' : row[0]).trim(), key = v.toLowerCase()
      if (!v || byId[v]) return
      if (byName[key]) { row[0] = byName[key]; dirty = true; changed++ }
      else rep.push(def.sheet + ' baris ' + (i + 2) + ': "' + v + '" ' + (byName[key] === null ? 'cocok dengan lebih dari satu pengguna' : 'tidak cocok dengan pengguna mana pun'))
    })
    if (dirty) { rg.setNumberFormat('@'); rg.setValues(vals) }
  })
  return changed + ' sel nama diganti ID pengguna.' + (rep.length ? '\nPerlu dibetulkan manual:\n- ' + rep.join('\n- ') : '')
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

// Memeriksa kesehatan data: kunci asing, nilai status, kesesuaian tahap, jumlah, transaksi menggantung (aturan di rules.gs)
function auditData() {
  const lines = []
  let all
  try {
    all = readAll_()
  } catch (e) {
    return 'GAGAL BACA: ' + e.message
  }
  validateAll_(all).forEach(e => lines.push(e.m))
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


// ---------- backend/src/rules.gs ----------
// =====================================================================================
// NRB -- relasi antartabel dan aturan data
// -------------------------------------------------------------------------------------
// Dipakai di dua tempat:
//  1. locked_ (server.gs): setelah sebuah aksi dijalankan dan SEBELUM menulis, baris yang berubah diperiksa
//     terhadap keadaan sesudah perubahan. Pelanggaran = aksi ditolak, tidak ada yang ditulis.
//  2. auditData(): memeriksa SELURUH database (mis. setelah seseorang mengedit sheet manual).
//
// Semua kolom relasi berisi ID, bukan nama:
//
//   Users ─┬─< Users.boss        (atasan; ber-role Atasan)
//          ├─< Request.by        (pemohon)
//          ├─< Konsolidasi.by    (Admin Dept pembuat SRL)
//          ├─< Kedatangan.by     (Admin Warehouse pencatat)
//          ├─< SerahTerima.to    (penerima = pemohon barang)
//          └─< Pengingat.by      (pengirim pengingat)
//   Master ─┬─< Item.kode
//           └─< Konsolidasi.kode
//   Request ──< Item.req
//   SRL ──────< Konsolidasi.srl
//   Konsolidasi ─┬─< Item.kon         (kosong sebelum barang masuk SRL)
//                └─< Kedatangan.kon
//   Item ─┬─< SerahTerima.item
//         └─< Pengingat.item
//
// Status Item.status dan Konsolidasi.tahap berjalan searah:
//   Draft > Menunggu Approval > Approved > Validasi Warehouse > Sudah di ERO
//   (Ditolak/Dibatalkan keluar dari alur; barang yang dikeluarkan Warehouse kembali ke Approved)
//
// File ini hanya berisi literal dan fungsi (aman terhadap urutan penggabungan).
// =====================================================================================

const ENUM = {
  role: ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse'],
  reqSt: ['Draft', 'Menunggu Approval', 'Disetujui', 'Ditolak', 'Dibatalkan'],
  itemSt: ['Draft', 'Menunggu Approval', 'Approved', 'Validasi Warehouse', 'Sudah di ERO', 'Ditolak', 'Dibatalkan'],
  tahap: ['Validasi Warehouse', 'Sudah di ERO', 'Dikeluarkan'],
}
const IN_KON = ['Validasi Warehouse', 'Sudah di ERO'] // status Item yang wajib terhubung ke Konsolidasi
const DEAD = ['Ditolak', 'Dibatalkan'] // tidak dihitung sebagai jumlah yang harus datang

// Aturan kolom. Format: jenis[?][:argumen]   ("?" = boleh kosong)
//   req teks wajib   text teks bebas   date YYYY-MM-DD   dtm tanggal atau tanggal-jam
//   pos angka > 0   num0 angka >= 0   int0 bilangan bulat   flag 0/1   phone 628xxxxxxxxx
//   enum:<ENUM>   id:<PREFIX> (mis. RQ-001)   fk:<tabel> (harus ada di tabel itu)
const REL = {
  U: { id: 'req', n: 'req', dept: 'req', role: 'enum:role', boss: 'fk?:U', hp: 'phone?' },
  M: { k: 'req', n: 'req', sat: 'req', buf: 'flag', kons: 'flag', lead: 'int0' },
  R: { id: 'id:RQ', by: 'fk:U', tgl: 'date', st: 'enum:reqSt', cat: 'text', at: 'dtm?' },
  I: { id: 'id:ITM', req: 'fk:R', kode: 'fk:M', qty: 'pos', datang: 'date', pakai: 'date?', status: 'enum:itemSt',
       appr: 'dtm?', kon: 'fk?:K', alasan: 'text' },
  K: { id: 'id:KON', dept: 'req', by: 'fk:U', kode: 'fk:M', tahap: 'enum:tahap', srl: 'fk:L', ero: 'num0', tutup: 'num0', alasan: 'text' },
  L: { no: 'req', dept: 'req', est: 'date?' },
  KD: { id: 'id:KD', kon: 'fk:K', qty: 'num0', lebih: 'num0', by: 'fk:U', cat: 'text', tgl: 'date', at: 'dtm?' },
  SR: { id: 'id:SR', item: 'fk:I', qty: 'pos', to: 'fk:U', tgl: 'date', at: 'dtm?' },
  RM: { id: 'id:RM', item: 'fk:I', by: 'fk:U', at: 'dtm' },
}
const PAT = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  dtm: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/,
  phone: /^628\d{8,11}$/,
  num: /^\d+(\.\d+)?$/,
  int: /^\d+$/,
  flag: /^[01]$/,
}
const EPS = 1e-9

// ---------- bantu ----------
function vHas_(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k)
}
function vSum_(a, f) {
  return a.reduce((s, x) => s + (+f(x) || 0), 0)
}
function vPush_(m, k, v) {
  ;(m[k] = m[k] || []).push(v)
}

// Peta bantu: kunci -> baris per tabel, anak per induk, log per induk
function vState_(tables) {
  const st = { by: {}, kids: {}, kd: {}, sr: {}, names: {} }
  TABLES.forEach(t => {
    const m = (st.by[t] = {})
    ;(tables[t] || []).forEach(r => (m[r[SCHEMA[t].key]] = r))
  })
  ;(tables.U || []).forEach(u => (st.names[String(u.n).toLowerCase().trim()] = u.id))
  ;(tables.I || []).forEach(i => i.kon && vPush_(st.kids, i.kon, i))
  ;(tables.KD || []).forEach(x => vPush_(st.kd, x.kon, x))
  ;(tables.SR || []).forEach(x => vPush_(st.sr, x.item, x))
  return st
}

// Periksa satu nilai terhadap aturan kolom; kembalikan pesan galat atau ''
function vCell_(rule, v, st) {
  const m = /^([a-z0-9]+)(\?)?(?::(.+))?$/.exec(rule)
  const kind = m[1], opt = !!m[2], arg = m[3]
  if (v === '') return opt || kind === 'text' ? '' : 'wajib diisi'
  switch (kind) {
    case 'req': case 'text': return ''
    case 'date': return PAT.date.test(v) ? '' : 'harus tanggal YYYY-MM-DD'
    case 'dtm': return PAT.dtm.test(v) ? '' : 'harus tanggal (YYYY-MM-DD) atau tanggal-jam'
    case 'phone': return PAT.phone.test(v) ? '' : 'nomor WA harus berbentuk 628xxxxxxxxx'
    case 'flag': return PAT.flag.test(v) ? '' : 'harus 0 atau 1'
    case 'pos': return PAT.num.test(v) && +v > 0 ? '' : 'harus angka lebih dari 0'
    case 'num0': return PAT.num.test(v) ? '' : 'harus angka 0 atau lebih'
    case 'int0': return PAT.int.test(v) ? '' : 'harus bilangan bulat 0 atau lebih'
    case 'enum': return ENUM[arg].indexOf(v) >= 0 ? '' : "'" + v + "' tidak dikenal (pilihan: " + ENUM[arg].join(', ') + ')'
    case 'id': return new RegExp('^' + arg + '-\\d{3,}$').test(v) ? '' : 'format harus ' + arg + '-001'
    case 'fk':
      if (vHas_(st.by[arg], v)) return ''
      return "'" + v + "' tidak ada di sheet " + SCHEMA[arg].sheet +
        (arg === 'U' && vHas_(st.names, v.toLowerCase().trim()) ? ' (ini NAMA pengguna; kolom harus berisi ID. Jalankan migrate() lalu auditData())' : '')
  }
  return 'aturan tidak dikenal: ' + rule
}

function vLabel_(t, row) {
  return SCHEMA[t].sheet + ' ' + row[SCHEMA[t].key]
}

// Periksa baris-baris: aturan kolom, lalu aturan lintas tabel bila kolomnya sah. rows = [{ t, row }]
// Hasil: [{ m: pesan, c: true bila akibat benturan jumlah dengan pengguna lain }]
function vRows_(st, rows) {
  const errs = []
  rows.forEach(x => {
    const t = x.t, row = x.row, rules = REL[t], before = errs.length
    const add = (msg, c) => errs.push({ m: vLabel_(t, row) + ': ' + msg, c: !!c })
    Object.keys(rules).forEach(col => {
      const msg = vCell_(rules[col], row[col] == null ? '' : String(row[col]), st)
      if (msg) add('kolom ' + col + ' ' + msg)
    })
    if (errs.length === before) vLinks_(t, row, st, add)
  })
  return errs
}

// Aturan lintas tabel untuk satu baris
function vLinks_(t, row, st, add) {
  if (t === 'U' && row.boss) {
    const boss = st.by.U[row.boss]
    if (row.boss === row.id) add('atasan tidak boleh diri sendiri')
    else if (boss && boss.role !== 'Atasan') add("atasan '" + row.boss + "' harus ber-role Atasan")
  }

  if (t === 'I') {
    const inKon = IN_KON.indexOf(row.status) >= 0
    if (inKon && !row.kon) add('status ' + row.status + ' wajib terhubung ke Konsolidasi (kolom kon)')
    if (!inKon && row.kon) add("kolom kon harus kosong untuk status '" + row.status + "'")
    const k = row.kon && st.by.K[row.kon]
    if (k && k.kode !== row.kode) add('kode barang ' + row.kode + ' tidak sama dengan Konsolidasi ' + k.id + ' (' + k.kode + ')')
    if (k && inKon && k.tahap !== row.status) add("status '" + row.status + "' tidak sama dengan tahap SRL '" + k.tahap + "'")
  }

  if (t === 'K') {
    const l = st.by.L[row.srl]
    if (l && l.dept !== row.dept) add('departemen ' + row.dept + ' tidak sama dengan SRL ' + l.no + ' (' + l.dept + ')')
    const kids = st.kids[row.id] || []
    if (row.tahap === 'Dikeluarkan' && kids.length) add("tahap 'Dikeluarkan' tetapi masih ada barang di dalamnya")
    if (row.tahap !== 'Dikeluarkan')
      kids.forEach(i => {
        if (i.status !== row.tahap) add('barang ' + i.id + " berstatus '" + i.status + "' tetapi tahap SRL '" + row.tahap + "'")
      })
    vArrival_(row, st, add)
  }

  if (t === 'KD') {
    const k = st.by.K[row.kon]
    if (!(+row.qty > 0) && !(+row.lebih > 0)) add('isi qty datang atau qty lebih')
    if (k && k.tahap !== 'Sudah di ERO') add('SRL ' + k.srl + " belum divalidasi Warehouse (tahap '" + k.tahap + "')")
    if (k) vArrival_(k, st, add)
  }

  if (t === 'SR') {
    const it = st.by.I[row.item]
    if (!it) return
    if (it.status !== 'Sudah di ERO') add("barang '" + it.id + "' belum berstatus Sudah di ERO")
    const handed = vSum_(st.sr[it.id] || [], s => s.qty)
    if (handed > +it.qty + EPS) add('total diserahkan ' + handed + ' melebihi qty request ' + it.qty, true)
    const k = st.by.K[it.kon]
    if (k) {
      const out = vSum_(st.kids[k.id] || [], i => vSum_(st.sr[i.id] || [], s => s.qty))
      const got = vSum_(st.kd[k.id] || [], d => d.qty)
      if (out > got + EPS) add('total diserahkan ' + out + ' melebihi barang yang sudah datang ' + got, true)
    }
  }
}

// Barang datang + sisa yang ditutup tidak boleh melebihi total yang diminta
function vArrival_(k, st, add) {
  const total = vSum_((st.kids[k.id] || []).filter(i => DEAD.indexOf(i.status) < 0), i => i.qty)
  const got = vSum_(st.kd[k.id] || [], d => d.qty)
  const closed = +k.tutup || 0
  if (got + closed > total + EPS) add('datang ' + got + ' + ditutup ' + closed + ' melebihi total request ' + total, true)
}

// Seluruh database (audit). tables = { U: [...], ... }
function validateAll_(tables) {
  const rows = []
  TABLES.forEach(t => (tables[t] || []).forEach(r => rows.push({ t: t, row: r })))
  return vRows_(vState_(tables), rows)
}

// Hanya baris yang diubah sebuah aksi, diperiksa pada keadaan sesudah perubahan. d = tabel kerja, ch = hasil diff_
function validateChange_(d, ch) {
  const rows = []
  TABLES.forEach(t => {
    ch[t].add.forEach(r => rows.push({ t: t, row: r }))
    ch[t].upd.forEach(u => rows.push({ t: t, row: u.after }))
  })
  return vRows_(vState_(d), rows)
}

