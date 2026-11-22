import { useState } from 'react'
import { LOGIN_TITLE } from '../config'

// Layar login: judul, kartu putih berisi username + password + tombol Login, logo DBC di bawahnya.
export function LoginView({ onLogin, notice, demo }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr('')
    const m = await onLogin(u, p)
    if (m) {
      setErr(m)
      setP('')
      setBusy(false)
    } // bila berhasil, layar ini langsung diganti aplikasi
  }

  const msg = err || notice
  return (
    <div className="lg">
      <h1 className="lg-t">{LOGIN_TITLE}</h1>
      <form className="lg-card" onSubmit={submit}>
        {msg ? <div className="lg-err" role="alert">{msg}</div> : null}
        <input
          className="lg-in" name="username" placeholder="Username" value={u} onChange={e => setU(e.target.value)}
          autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
          aria-label="Username"
        />
        <input
          className="lg-in" name="password" type="password" placeholder="Password" value={p} onChange={e => setP(e.target.value)}
          autoComplete="current-password" aria-label="Password"
        />
        <button className="lg-btn" type="submit" disabled={busy}>{busy ? 'Masuk…' : 'Login'}</button>
        <img className="lg-logo" src="./logo-dbc.png" alt="DBC, Inspired to Exceed" />
        {demo ? <p className="lg-demo">Mode demo: isi username pengguna (mis. andi.prod), password bebas.</p> : null}
      </form>
    </div>
  )
}
