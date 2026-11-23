import { Component } from 'react'

// Menangkap galat saat render supaya pengguna tidak melihat layar putih kosong.
// Penyebab umum: data di spreadsheet diedit manual dan ada yang tidak konsisten.
export class ErrorBoundary extends Component {
  state = { err: null }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err, info) {
    console.error('SIPRAK: galat tampilan', err, info?.componentStack)
  }

  reload = () => window.location.reload()

  // Hapus sesi masuk di perangkat ini (bukan data transaksi), lalu muat ulang
  relogin = () => {
    try { localStorage.removeItem('siprak.me') } catch { /* abaikan */ }
    window.location.reload()
  }

  render() {
    if (!this.state.err) return this.props.children
    return (
      <div id="app" className="mob" style={{ padding: 24 }}>
        <div className="hd"><h2>Terjadi kesalahan</h2></div>
        <div className="empty" role="alert">
          Tampilan tidak bisa dimuat. Coba muat ulang. Jika terus terjadi, minta admin memeriksa data di spreadsheet
          (mis. kode barang atau nomor SRL yang salah ketik).
        </div>
        <div className="acts">
          <button className="btn grow" onClick={this.reload}>Muat ulang</button>
          <button className="btn grow" onClick={this.relogin}>Keluar lalu muat ulang</button>
        </div>
      </div>
    )
  }
}
