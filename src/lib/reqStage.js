// Tahap sebuah barang bagi pemohon, dan ringkasan tahap per request. Satu sumber untuk layar "Request saya".
// Hanya untuk barang yang belum tuntas (barang tuntas ada di Histori).

export const CATS = {
  siap: { l: 'Siap diambil', t: 't-ok' },
  approval: { l: 'Menunggu persetujuan', t: 't-warn' },
  proses: { l: 'Diproses', t: 't-info' },
  tahan: { l: 'Ditahan', t: 't-warn' },
  draft: { l: 'Draft', t: 't-gray' },
}
export const CAT_ORDER = ['siap', 'approval', 'proses', 'tahan', 'draft']

// Satu barang -> satu tahap
export function itemCat(i, sel) {
  if (i.status == 'Draft') return 'draft'
  if (i.status == 'Menunggu Approval') return 'approval'
  if (i.status == 'Approved' && i.tahan) return 'tahan'
  if (i.status == 'Sudah di ERO' && sel.siap(i) > 0) return 'siap'
  return 'proses' // disetujui, divalidasi, di ERO menunggu barang datang, atau sudah diambil sebagian dan menunggu sisanya
}

// Barang yang belum tuntas milik request
export const openItems = (r, sel) => sel.itemsOf(r.id).filter(i => sel.live(i) && !sel.itemDone(i))

// Ringkasan request: jumlah barang per tahap
export function reqSummary(r, sel) {
  const items = openItems(r, sel)
  const c = { siap: 0, approval: 0, proses: 0, tahan: 0, draft: 0 }
  items.forEach(i => { c[itemCat(i, sel)]++ })
  return { r, items, c, n: items.length }
}

// Label tunggal untuk kepala kartu: yang paling perlu perhatian pemohon. null bila tidak ada yang berjalan.
export function reqStage(sum) {
  const { c } = sum
  if (c.siap) return { l: c.siap + ' siap diambil', t: 't-ok' }
  if (c.draft) return { l: 'Draft', t: 't-gray' }
  if (c.approval) return { l: 'Menunggu persetujuan', t: 't-warn' }
  if (c.tahan) return { l: c.tahan + ' ditahan', t: 't-warn' }
  if (c.proses) return { l: 'Diproses', t: 't-info' }
  return null
}

// Urutan daftar: yang punya barang siap diambil di atas, lalu terbaru (urutan awal dipertahankan, sort stabil)
export const bySiapFirst = (a, b) => (b.c.siap > 0) - (a.c.siap > 0)
