import { useMemo } from 'react'
import { useApp } from '../store'

// Terbaru dulu; tanggal sama diurutkan menurut nomor (pembanding konsisten, hasil stabil)
const newest = (a, b) => (a.tgl == b.tgl ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.tgl < b.tgl ? 1 : -1)

// Request milik pengguna aktif, dipisah menurut `sel.reqEnd`:
//   aktif   = masih berjalan (belum 100%)
//   histori = sudah selesai, ditolak, atau dibatalkan; tiap entri { r, end, ym }
// Dihitung sekali per perubahan data, tidak per render. Layar aktif hanya menggambar sebagian kecil dari `aktif`,
// jadi jumlah histori yang membengkak tidak membebani daftar kerja harian.
export function useOwnRequests() {
  const { db, sel, ui } = useApp()
  return useMemo(() => {
    const aktif = []
    const histori = []
    for (const r of db.R) {
      if (r.by != ui.me) continue
      const end = sel.reqEnd(r)
      if (end) histori.push({ r, end, ym: String(r.tgl || '').slice(0, 7) })
      else aktif.push(r)
    }
    aktif.sort(newest)
    histori.sort((a, b) => newest(a.r, b.r))
    return { aktif, histori }
  }, [db, sel, ui.me])
}
