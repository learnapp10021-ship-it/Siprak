// Outbox: transaksi yang sudah dikirim tetapi belum pasti hasilnya disimpan di perangkat.
// Tujuannya satu: pengiriman ulang SELALU memakai ID transaksi yang sama, bahkan setelah halaman
// dimuat ulang atau tombol ditekan lagi, sehingga server dapat mengenali dan tidak menulis dua kali.
const K = 'siprak.outbox.v1'
const MAX_AGE = 24 * 3600e3
const REUSE_MS = 30 * 60e3

const load = () => {
  try {
    const a = JSON.parse(localStorage.getItem(K) || '[]')
    return a.filter(e => Date.now() - e.at < MAX_AGE)
  } catch {
    return []
  }
}
const save = a => {
  try {
    localStorage.setItem(K, JSON.stringify(a))
  } catch {}
}

export const outbox = {
  all: load,
  // entri yang sama persis (aksi + argumen) dan masih baru dipakai ulang, supaya klik ulang = retry
  find: fp => load().find(e => e.fp === fp && Date.now() - e.at < REUSE_MS),
  put: e => save([...load().filter(x => x.tx !== e.tx), e]),
  del: tx => save(load().filter(x => x.tx !== tx)),
}
