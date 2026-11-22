import { useState } from 'react'
import logo from '../assets/logo-dbc.png'

const ORDER = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']

// Masuk: pilih pengguna + password. Untuk uji coba password belum diperiksa, boleh dikosongkan.
export function Login({ users, onPick }) {
  const [uid, setUid] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  const roles = [...new Set([...ORDER, ...users.map(u => u.role)])]
    .map(r => [r, users.filter(u => u.role == r).sort((a, b) => a.n.localeCompare(b.n))])
    .filter(([, a]) => a.length)

  const submit = e => {
    e.preventDefault()
    if (!uid) {
      setErr('Pilih pengguna terlebih dahulu.')
      return
    }
    onPick(uid)
  }

  return (
    <div className="login">
      <h1 className="login-t">NRB</h1>
      <p className="login-sub">Nota Request Barang</p>
      <form className="login-card" onSubmit={submit} noValidate>
        {err ? <div className="login-err" role="alert">{err}</div> : null}
        <select
          className="login-in" value={uid} aria-label="Pengguna" aria-invalid={err ? 'true' : undefined}
          onChange={e => { setUid(e.target.value); setErr('') }}
        >
          <option value="">Pilih pengguna</option>
          {roles.map(([r, a]) => (
            <optgroup key={r} label={r}>
              {a.map(u => <option key={u.id} value={u.id} disabled={!!u.off}>{u.n} ({u.dept}){u.off ? ', nonaktif' : ''}</option>)}
            </optgroup>
          ))}
        </select>
        <input
          className="login-in" type="password" placeholder="Password" aria-label="Password"
          value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password"
        />
        <button type="submit" className="login-btn">Login</button>
        <img className="login-logo" src={logo} alt="DBC, Inspired to Exceed" />
        <p className="login-note">Mode uji coba: password belum diperiksa, boleh dikosongkan.</p>
      </form>
    </div>
  )
}
