import { D, sum } from './utils'

// Semua turunan data (jatah, sisa, status) dihitung dari snapshot db.
// Dipakai di render (db biasa) maupun di dalam aksi (draft immer).
export function makeSel(db) {
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
    for (const x of I.filter(i => i.kon == k.id && live(i)).sort(ord)) {
      const g = Math.min(r, +x.qty)
      if (x.id == it.id) return g
      r -= g
    }
    return 0
  }
  const diambil = it => sum(SR.filter(s => s.item == it.id), s => s.qty)
  const siap = it => berhak(it) - diambil(it)
  const deptOf = it => user(RQ(it.req)?.by)?.dept
  const lastArrival = kon => KD.filter(d => d.kon == kon).map(d => d.tgl).sort().pop()
  const firstArrival = kon => KD.filter(d => d.kon == kon).map(d => d.tgl).sort()[0]

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
    const arr = I.filter(i => i.kon == k.id && live(i)).sort(ord)
    const idx = arr.findIndex(i => i.id == it.id)
    if (idx < 0) return null
    return { pos: idx + 1, n: arr.length, ahead: sum(arr.slice(0, idx), i => i.qty) }
  }

  const poolAll = d => I.filter(i => i.status == 'Approved' && !i.kon && RQ(i.req) && deptOf(i) == d)
  const poolOf = d => poolAll(d).filter(i => !i.tahan)

  // Request "closed" (tidak ada lagi yang perlu dipantau): Ditolak/Dibatalkan, atau Disetujui yang semua barangnya
  // sudah diambil penuh, atau sisanya ditutup dan tidak ada lagi yang siap diambil.
  // its (opsional) = barang request itu, agar pemanggil yang memeriksa ribuan request tidak memindai ulang seluruh barang.
  const reqClosed = (r, its) => {
    if (r.st == 'Ditolak' || r.st == 'Dibatalkan') return true
    if (r.st != 'Disetujui') return false
    const l = (its || I.filter(i => i.req == r.id)).filter(live)
    return (
      l.length > 0 &&
      l.every(i => {
        if (i.status != 'Sudah di ERO') return false
        if (diambil(i) >= +i.qty) return true
        const k = KN(i.kon)
        return !!k && +k.tutup > 0 && sisa(k) == 0 && siap(i) <= 0
      })
    )
  }

  return {
    user, nm, mi, KN, RQ, SRLof, live, total, datang, sisa, ord, berhak, diambil, siap,
    deptOf, lastArrival, firstArrival, st, progress, antrian, poolAll, poolOf, reqClosed,
    reminders: itemId => RM.filter(x => x.item == itemId),
  }
}
