// Skema tabel = skema sheet. Kolom sistem (_cr,_ts,_op,_by) ditambahkan di kanan setiap tabel:
//   _cr dibuat kapan, _ts diubah kapan, _op ID transaksi terakhir, _by pelaku terakhir.
export const SYS = ['_cr', '_ts', '_op', '_by']

export const TABLES = {
  U: { sheet: 'Users', key: 'id', cols: ['id', 'n', 'dept', 'role', 'boss', 'wa', 'off'], bool: ['off'] },
  M: { sheet: 'Master', key: 'k', cols: ['k', 'n', 'sat', 'buf', 'kons', 'lead'] },
  R: { sheet: 'Requests', key: 'id', cols: ['id', 'by', 'tgl', 'st', 'cat'] },
  I: { sheet: 'Items', key: 'id', cols: ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan'] },
  K: { sheet: 'Konsolidasi', key: 'id', cols: ['id', 'dept', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan', 'by'] },
  L: { sheet: 'SRL', key: 'no', cols: ['no', 'dept', 'est'] },
  KD: { sheet: 'Kedatangan', key: 'id', cols: ['id', 'kon', 'qty', 'lebih', 'by', 'cat', 'tgl'] },
  SR: { sheet: 'SerahTerima', key: 'id', cols: ['id', 'item', 'qty', 'to', 'tgl'] },
  RM: { sheet: 'Pengingat', key: 'id', cols: ['id', 'item', 'by', 'at'] },
}

const str = v => (v == null ? '' : String(v))

// objek -> array sel (selalu string, supaya sheet tidak mengubah tipe)
export function toRow(t, o) {
  const T = TABLES[t]
  return [
    ...T.cols.map(c => (T.bool && T.bool.includes(c) ? (o[c] ? '1' : '') : str(o[c]))),
    ...SYS.map(c => str(o[c])),
  ]
}
// array sel -> objek
export function fromRow(t, a) {
  const T = TABLES[t]
  const o = {}
  T.cols.forEach((c, i) => {
    o[c] = T.bool && T.bool.includes(c) ? str(a[i]) === '1' : str(a[i])
  })
  SYS.forEach((c, i) => {
    o[c] = str(a[T.cols.length + i])
  })
  return o
}
export const width = t => TABLES[t].cols.length + SYS.length
export const emptyState = () => Object.fromEntries(Object.keys(TABLES).map(k => [k, []]))
// tanda tangan isi tabel (urut kolom) untuk membandingkan snapshot vs sheet
export const tableSig = (t, rows) => JSON.stringify(rows.map(r => toRow(t, r)))
