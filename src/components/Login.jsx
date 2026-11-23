import { useState } from 'react'

const ORDER = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']

// Masuk: pilih pengguna + kata sandi. Untuk uji coba kata sandi belum diperiksa, boleh dikosongkan.
export function Login({ users, onPick, onLogin, requirePin, notice }) {
  const [uid, setUid] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const roles = [...new Set([...ORDER, ...users.map(u => u.role)])]
    .map(r => [r, users.filter(u => u.role == r).sort((a, b) => a.n.localeCompare(b.n))])
    .filter(([, a]) => a.length)

  const submit = async e => {
    e.preventDefault()
    if (busy) return // cegah kirim berulang saat menunggu server
    if (!uid) {
      setErr('Pilih pengguna terlebih dahulu.')
      return
    }
    if (requirePin) {
      if (!pw) {
        setErr('Isi PIN Anda.')
        return
      }
      setBusy(true)
      const m = await onLogin(uid, pw)
      setBusy(false)
      if (m) {
        setErr(m)
        setPw('')
      }
      return
    }
    onPick(uid)
  }

  return (
    <div className="login">
      <div className="login-hd">
        <h1>SIPRAK</h1>
        <p>Request barang</p>
      </div>
      <form className="login-body" onSubmit={submit} noValidate>
        <h2>Masuk</h2>
        <label className="login-f">Pengguna
          <select value={uid} onChange={e => { setUid(e.target.value); setErr('') }} aria-invalid={err ? 'true' : undefined}>
            <option value="">Pilih pengguna</option>
            {roles.map(([r, a]) => (
              <optgroup key={r} label={r}>
                {a.map(u => <option key={u.id} value={u.id} disabled={!!u.off}>{u.n} ({u.dept}){u.off ? ', nonaktif' : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {notice && !err ? <div className="login-err" role="status">{notice}</div> : null}
        <label className="login-f">{requirePin ? 'PIN' : 'Kata sandi'}
          <span className="login-pw">
            <input type={show ? 'text' : 'password'} value={pw} onChange={e => { setPw(e.target.value); setErr('') }} autoComplete="current-password"
              inputMode={requirePin ? 'numeric' : undefined} maxLength={requirePin ? 12 : undefined} placeholder={requirePin ? 'PIN' : 'Kata sandi'} />
            <button type="button" className="login-eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Sembunyikan' : 'Tampilkan'}>{show ? 'Sembunyikan' : 'Lihat'}</button>
          </span>
        </label>
        {err ? <div className="login-err" role="alert">{err}</div> : null}
        <button type="submit" className="btn login-btn" disabled={busy}>{busy ? 'Memeriksa...' : 'Masuk'}</button>
        {requirePin ? <p className="login-note">Lupa PIN? Hubungi admin departemen Anda.</p> : <p className="login-note">Mode uji coba: kata sandi belum diperiksa, boleh dikosongkan.</p>}
      </form>
    </div>
  )
}
