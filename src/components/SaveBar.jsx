import { useApp } from '../store'

// Status penyimpanan yang jujur: "berhasil" hanya muncul (sebagai toast) setelah server membaca ulang
// data dari spreadsheet dan memastikannya tersimpan. Di sini ditampilkan proses dan kegagalannya.
export function SaveBar() {
  const { saving, net, retry, skip } = useApp()
  if (!saving && net.ok) return null
  if (!saving)
    return (
      <div className="savebar warn" role="status">
        Koneksi ke server bermasalah. Data yang tampil mungkin belum terbaru.
      </div>
    )
  if (saving.phase == 'sending')
    return (
      <div className="savebar" role="status" aria-live="polite">
        Menyimpan dan memverifikasi… jangan tutup halaman.
      </div>
    )
  return (
    <div className="savebar bad" role="alert">
      <div>
        <b>Belum tersimpan.</b> {saving.err}
        <br />
        <small>Menekan Coba lagi aman: sistem mengenali transaksi ini dan tidak akan membuat data ganda.</small>
      </div>
      <div className="acts">
        <button className="btn grow" onClick={retry}>Coba lagi</button>
        <button className="btn alt" onClick={skip}>Nanti</button>
      </div>
    </div>
  )
}
