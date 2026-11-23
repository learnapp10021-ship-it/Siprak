import { D, sum } from './utils'

// Semua turunan data (jatah, sisa, status) dihitung dari snapshot db.
// Dipakai di render (db biasa) maupun di dalam aksi (draft immer).
// cache: true HANYA untuk render (db beku/immutable): pencarian jadi Map sehingga ratusan SRL tetap mulus.
// Aksi dan server memakai makeSel(db) biasa karena db berubah di tengah aksi (cache akan basi).
export function makeSel(db, { cache = false } = {}) {
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
  const diambil = cache ? it => sum(srByItem(it.id), s => s.qty) : it => sum(SR.filter(s => s.item == it.id), s => s.qty)
  const siap = it => berhak(it) - diambil(it)
  const deptOf = it => user(RQ(it.req)?.by)?.dept
  const kdOf = kon => (cache ? kdByKon(kon) : KD.filter(d => d.kon == kon))
  const lastArrival = kon => kdOf(kon).map(d => d.tgl).sort().pop()
  const firstArrival = kon => kdOf(kon).map(d => d.tgl).sort()[0]

  // [tahap 0-4, kelas warna, label]
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
      if (a >= +it.qty) return [4, 't-ok', 'Sudah diambil semua']
      if (b - a > 0) return [4, 't-ok', `Siap diambil ${b - a} dari ${it.qty} ${sat}`]
      // Tidak ada lagi yang akan datang (sisa ditutup): jangan menunggu selamanya
      const kk = KN(it.kon)
      if (kk && sisa(kk) == 0 && +kk.tutup > 0)
        return [4, 't-warn', `Sisa ditutup${kk.alasan ? ': ' + kk.alasan : ''}. Diambil ${a} dari ${it.qty} ${sat}`]
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

  // Persen proses 0-100 untuk cincin progres: tahap alur, lalu (setelah masuk ERO) porsi barang yang sudah datang
  const progress = it => {
    const s = it.status
    if (s == 'Draft') return 0
    if (s == 'Menunggu Approval') return 15
    if (s == 'Approved') return 35
    if (s == 'Validasi Warehouse' || s == 'Masuk Konsolidasi') return 50
    if (s == 'Sudah di ERO') {
      const q = +it.qty || 1
      return Math.round(65 + 35 * Math.min(1, Math.max(berhak(it), diambil(it)) / q))
    }
    return 0
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
    deptOf, lastArrival, firstArrival, st, progress, antrian, poolAll, poolOf,
    reminders: itemId => RM.filter(x => x.item == itemId),
  }
}
