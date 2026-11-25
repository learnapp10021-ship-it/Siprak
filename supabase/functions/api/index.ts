// @ts-nocheck
// ============================================================================
// FILE HASIL BUILD -- JANGAN DIEDIT LANGSUNG.
// Sumber: src/lib/utils.js, selectors.js, actions.js, backend/src/server.gs (bagian murni), backend/src/rules.gs,
//         backend/supabase/handler.js. Bangun ulang: npm run build:supabase
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

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
// Edge Function berjalan di UTC; aturan tanggal aplikasi (tgl datang minimal, terlambat) memakai zona APP_TZ (WIB).
const APP_TZ = (typeof Deno !== 'undefined' && Deno.env.get('APP_TZ')) || 'Asia/Jakarta'
const WIB_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const wibParts_ = () => Object.fromEntries(WIB_FMT.formatToParts(new Date()).map(p => [p.type, p.value]))
const todayStr = () => {
  const p = wibParts_()
  return `${p.year}-${p.month}-${p.day}`
}
const nowStr = () => {
  const p = wibParts_()
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
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
const FLAG_ON = /^(1|y|ya|yes|true|buffer|konsinyasi)$/i
const FLAG_OFF = /^(0|n|no|tidak|false|-|non buffer|non konsinyasi)?$/i
const flag = v => (FLAG_ON.test(String(v ?? '').trim()) ? '1' : '0')
// Nilai selain Ya/Tidak/1/0 (mis. "2", "x", salah ketik) ditolak, jangan diam-diam dianggap 0
const flagOk = v => { const t = String(v ?? '').trim(); return FLAG_ON.test(t) || FLAG_OFF.test(t) }
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
  else if (!flagOk(r.buf)) err = 'Buffer harus 1/0 atau Ya/Tidak (nilai "' + String(r.buf).trim() + '" tidak dikenal)'
  else if (!flagOk(r.kons)) err = 'Konsinyasi harus 1/0 atau Ya/Tidak (nilai "' + String(r.kons).trim() + '" tidak dikenal)'
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
    // Baris yang sudah ditandai bermasalah oleh klien dibuang, sisanya dibersihkan ulang di server (server otoritatif)
    const ok = rows.filter(r => r && !r.err).map(cleanMaster).filter(r => !r.err)
    const skip = rows.length - ok.length
    if (!ok.length) return { err: 'Tidak ada baris yang valid.' }
    let baru = 0
    let ubah = 0
    ok.forEach(r => {
      const { err, ...row } = r
      const ex = d.M.find(m => m.k == row.k)
      if (ex) { Object.assign(ex, row); ubah++ } else { d.M.push(row); baru++ }
    })
    return { ok: `${baru} item baru, ${ubah} item diperbarui.` + (skip ? ` ${skip} baris tidak valid dilewati.` : '') }
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


// ---------- backend/src/server.gs (bagian murni: skema, hak akses, diff) ----------
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

function ser_(row, def) {
  return def.cols.map(c => (c === 'off' ? (row.off ? 'Y' : '') : row[c] == null ? '' : String(row[c])))
}

function same_(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

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


// ---------- backend/supabase/handler.js ----------
// =====================================================================================
// NRB -- Edge Function Supabase (Deno). Pengganti server Google Apps Script, protokol HTTP SAMA PERSIS
// (GET ?action=sync&since=&key= dan POST text/plain {key,tx,name,args,me}) sehingga klien tidak berubah.
//
// Bagian hak akses (PERM/BIND), skema, diff_, dan rules.gs diambil dari backend/src/*.gs oleh
// scripts/build-supabase.mjs, jadi aturan bisnis hanya ada di satu tempat.
//
// Beda dengan Apps Script: tidak ada lock manual. Penulisan memakai concurrency optimistik di database:
//  1. server membaca seluruh data + versinya (nrb_load), menjalankan aksi di memori,
//  2. nrb_apply mengunci baris meta, memastikan versi belum berubah, lalu menulis semua tabel + log tx
//     dalam SATU transaksi Postgres (semua atau tidak sama sekali, jadi tanpa journal/rollback manual),
//  3. jika versi sudah berubah (pengguna lain menulis lebih dulu) server menghitung ulang atas data terbaru.
// Tx yang sama tidak pernah tertulis dua kali (kunci utama tabel tx); kirim ulang hanya menjawab "replay".
// =====================================================================================
const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const MAX_BODY = 600000
const MAX_TRIES = 5
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const tblName = t => SCHEMA[t].sheet.toLowerCase()

function out_(s, status = 200) {
  return new Response(typeof s === 'string' ? s : JSON.stringify(s), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
function reject_(msg, snap) {
  return withSnap_({ ok: false, rejected: true, err: msg }, snap)
}
function retry_(msg, extra) {
  return JSON.stringify(Object.assign({ ok: false, retry: true, err: msg }, extra || {}))
}
function withSnap_(head, snap) {
  const h = JSON.stringify(head)
  return h.slice(0, -1) + ',"snap":' + snap + '}'
}
function authOk_(key) {
  const k = Deno.env.get('API_KEY')
  return !k || key === k
}

// ---------- membaca ----------
async function loadAll_() {
  const { data, error } = await sb.rpc('nrb_load')
  if (error) throw new Error('baca database: ' + error.message)
  const all = {}
  TABLES.forEach(t => {
    all[t] = (data.tables[tblName(t)] || []).map(r => {
      const o = {}
      SCHEMA[t].cols.forEach(c => (o[c] = c === 'off' ? r.off === 'Y' : r[c] == null ? '' : String(r[c])))
      return o
    })
  })
  return { all, ver: +data.ver }
}
async function snapNow_() {
  const { all, ver } = await loadAll_()
  return snapJson_(all, ver)
}
async function sync_(since) {
  const { data: ver, error } = await sb.rpc('nrb_ver')
  if (error) throw new Error('baca versi: ' + error.message)
  if (since && String(since) === String(ver)) return JSON.stringify({ ok: true, same: true, ver: +ver })
  return withSnap_({ ok: true }, await snapNow_())
}

// ---------- menulis ----------
const rowObj_ = (t, row) => {
  const v = ser_(row, SCHEMA[t])
  const o = {}
  SCHEMA[t].cols.forEach((c, i) => (o[c] = v[i]))
  return o
}

async function attempt_(txId, name, args, actorId, t0) {
  // Urutan penting: baca data DULU, baru cek log tx. Jika tx ini sudah sukses (termasuk yang baru saja selesai oleh
  // kiriman kembar yang berjalan bersamaan), jawab replay TANPA menjalankan aksi (aksi akan menolaknya sebagai duplikat).
  // Jika tx baru tertulis setelah pembacaan ini, nrb_apply yang menjawab replay (di dalam kunci).
  const { all: before, ver } = await loadAll_()
  const prior = await sb.from('tx').select('status,msg').eq('tx', txId).maybeSingle()
  if (prior.error) throw new Error('baca log tx: ' + prior.error.message)
  if (prior.data && prior.data.status === 'OK')
    return withSnap_({ ok: true, verified: true, replay: true, msg: prior.data.msg }, await snapNow_())

  const snapBefore = () => snapJson_(before, ver)
  const actor = before.U.find(u => u.id === actorId)
  if (!actor || actor.off) return reject_('Akun tidak ditemukan atau nonaktif.', snapBefore())

  const d = {}
  TABLES.forEach(t => (d[t] = before[t].map(r => Object.assign({}, r))))
  d.HP = {}
  d.U.forEach(u => {
    if (u.hp) d.HP[u.id] = u.hp
  })
  const sel = makeSel(d)

  let res
  try {
    const pe = PERM[name](actor, args, d, sel)
    if (pe) return reject_(pe, snapBefore())
    const bound = (BIND[name] || ((a, x) => x))(actor, args)
    res = actions[name](sel, d, ...bound)
  } catch (e) {
    return reject_('Permintaan tidak valid.', snapBefore())
  }
  if (res && res.err) return reject_(res.err, snapBefore())

  d.U.forEach(u => (u.hp = d.HP[u.id] || ''))
  delete d.HP
  const ch = diff_(before, d, txId)

  const bad = validateChange_(d, ch)
  if (bad.length) {
    const pre = bad.some(e => e.c) ? 'Jumlah tidak cocok dengan data terbaru (mungkin diubah pengguna lain): ' : 'Data tidak valid: '
    return reject_(pre + bad.slice(0, 2).map(e => e.m).join(' | '), snapBefore())
  }

  const msg = (res && res.ok) || ''
  const nChanged = TABLES.reduce((s, t) => s + ch[t].add.length + ch[t].upd.length, 0)
  if (!nChanged) return withSnap_({ ok: true, verified: true, noop: true, msg }, snapBefore())

  const changes = {}
  TABLES.forEach(t => {
    changes[tblName(t)] = {
      add: ch[t].add.map(r => rowObj_(t, r)),
      upd: ch[t].upd.map(u => rowObj_(t, u.after)),
    }
  })
  const { data, error } = await sb.rpc('nrb_apply', {
    p_tx: txId, p_action: name, p_actor: actorId, p_expected: ver, p_changes: changes, p_msg: msg, p_ms: String(Date.now() - t0),
  })
  if (error) throw new Error('simpan database: ' + error.message)
  if (data.status === 'conflict') return 'CONFLICT'
  if (data.status === 'replay') return withSnap_({ ok: true, verified: true, replay: true, msg: data.msg }, await snapNow_())
  if (data.status !== 'ok') throw new Error('respons database tidak dikenal')
  // Sudah tersimpan atomik. Snapshot dibaca ulang dari database supaya klien melihat keadaan sebenarnya.
  return withSnap_({ ok: true, verified: true, msg }, await snapNow_())
}

// Antrean tulis per isolate: permintaan tulis yang tiba bersamaan dikerjakan satu per satu. Tanpa ini, N penulis serentak
// membaca versi yang sama dan hanya satu yang menang per putaran (badai percobaan ulang). Konflik tersisa hanya antar-isolate.
let writeChain_ = Promise.resolve()
let writePending_ = 0
const MAX_PENDING = 200
function serial_(fn) {
  if (writePending_ >= MAX_PENDING) return Promise.resolve(retry_('Server sedang sibuk. Coba lagi sebentar lagi.', { busy: true }))
  writePending_++
  const run = writeChain_.then(fn, fn)
  writeChain_ = run.then(() => {}, () => {})
  return run.finally(() => writePending_--)
}

async function write_(req) {
  const t0 = Date.now()
  const txId = String(req.tx || '')
  if (!/^TX-[A-Za-z0-9_-]{8,80}$/.test(txId)) return JSON.stringify({ ok: false, rejected: true, err: 'ID transaksi tidak valid.' })
  const name = String(req.name || '')
  if (!Object.prototype.hasOwnProperty.call(actions, name) || !PERM[name])
    return JSON.stringify({ ok: false, rejected: true, err: 'Aksi tidak dikenal.' })
  const args = Array.isArray(req.args) ? req.args : []
  const actorId = String(req.me || '')
  return serial_(async () => {
    for (let i = 0; i < MAX_TRIES; i++) {
      refreshToday() // isolate Edge Function hidup lintas hari; "hari ini" harus dihitung ulang
      const r = await attempt_(txId, name, args, actorId, t0)
      if (r !== 'CONFLICT') return r
      await new Promise(ok => setTimeout(ok, 30 + Math.random() * 120 * (i + 1)))
    }
    return retry_('Server sedang melayani banyak pengguna. Coba lagi sebentar lagi.', { busy: true })
  })
}

// ---------- pintu masuk ----------
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    if (req.method === 'POST') {
      const raw = await req.text()
      if (raw.length > MAX_BODY) return out_({ ok: false, rejected: true, err: 'Permintaan terlalu besar.' })
      const body = JSON.parse(raw)
      if (!authOk_(body.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
      return out_(await write_(body))
    }
    const p = Object.fromEntries(new URL(req.url).searchParams)
    if (!authOk_(p.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
    if (p.action === 'ping') return out_({ ok: true, time: nowStr() })
    return out_(await sync_(p.since))
  } catch (err) {
    return out_(retry_('Terjadi kesalahan di server: ' + (err && err.message ? err.message : err)))
  }
})

