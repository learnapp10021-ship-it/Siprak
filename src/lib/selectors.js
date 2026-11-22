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
    if (s == 'Sudah di ERO') {
      const b = berhak(it)
      const a = diambil(it)
      if (a >= +it.qty) return [4, 't-ok', 'Sudah diambil semua']
      if (b - a > 0) return [4, 't-ok', `Siap diambil ${b - a} dari ${it.qty} ${sat}`]
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
