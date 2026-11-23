import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { AKSI } from '../lib/notes'

const jam = t => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

// Status penyimpanan yang jujur dan informatif. "Berhasil" hanya muncul (sebagai toast) setelah server
// membaca ulang data dari spreadsheet dan memastikannya tersimpan; di sini ditampilkan proses, antrean,
// kegagalan, dan keadaan offline.
export function SaveBar() {
  const { saving, net, retry, skip, refresh } = useApp()
  const [lama, setLama] = useState(false)
  const tx = saving?.phase == 'sending' ? saving.tx : null
  useEffect(() => {
    setLama(false)
    if (!tx) return
    const t = setTimeout(() => setLama(true), 6000)
    return () => clearTimeout(t)
  }, [tx])

  if (!saving && net.ok) return null

  if (!saving)
    return (
      <div className="savebar warn" role="status">
        <div>
          <b>Tidak terhubung ke server.</b> Menampilkan data per {jam(net.at)}. Mencoba lagi otomatis.
        </div>
        <div className="acts"><button className="btn alt" onClick={refresh}>Coba sekarang</button></div>
      </div>
    )

  const apa = AKSI[saving.name] || 'data'
  if (saving.phase == 'sending')
    return (
      <div className="savebar" role="status" aria-live="polite">
        <span className="spin" aria-hidden="true" />
        <div>
          <b>Menyimpan {apa}…</b>
          <small>
            {saving.note || (lama ? 'Masih menyimpan. Google Sheets kadang butuh beberapa detik. Jangan tutup halaman.' : 'Menulis ke spreadsheet, lalu memeriksa ulang.')}
          </small>
        </div>
      </div>
    )

  return (
    <div className="savebar bad" role="alert">
      <div>
        <b>Belum tersimpan: {apa}.</b> {saving.err}
        <small>
          {saving.unknown ? 'Data mungkin sudah masuk. ' : ''}Menekan Coba lagi aman: sistem mengenali transaksi ini dan tidak akan membuat data ganda.
        </small>
      </div>
      <div className="acts">
        <button className="btn grow" onClick={retry}>Coba lagi</button>
        <button className="btn alt" onClick={skip}>Nanti</button>
      </div>
    </div>
  )
}
