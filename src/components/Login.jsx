import { useEffect, useRef, useState } from 'react'
import logo from '../assets/logo-dbc.png'
import { REMOTE } from '../lib/api'

const ORDER = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']

// Masuk: pilih pengguna + password. Untuk uji coba password belum diperiksa, boleh dikosongkan.
export function Login({ users = [], onPick, signIn, loadUsers }) {
  const [uid, setUid] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const sel = useRef(null)
  const [busy, setBusy] = useState(false)
  // Mode Supabase: daftar pengguna dimuat dari fungsi database login_users (null = memuat, [] = tidak tersedia -> kotak ketik ID)
  const [opts, setOpts] = useState(null)
  useEffect(() => {
    if (!signIn || !loadUsers) return undefined
    let off = false
    loadUsers().then(r => { if (!off) setOpts(r && r.ok ? r.users : []) }).catch(() => { if (!off) setOpts([]) })
    return () => { off = true }
  }, [signIn, loadUsers])
  const loading = !!signIn && !!loadUsers && opts === null
  const selectMode = !signIn || (!!loadUsers && (opts === null || opts.length > 0))
  const list = signIn ? opts || [] : users

  const roles = [...new Set([...ORDER, ...list.map(u => u.role)])]
    .map(r => [r, list.filter(u => u.role == r).sort((a, b) => a.n.localeCompare(b.n))])
    .filter(([, a]) => a.length)

  const submit = async e => {
    e.preventDefault()
    if (signIn) {
      if (busy) return
      if (!uid.trim() || !pw) {
        setErr(selectMode ? 'Pilih pengguna dan isi PIN.' : 'Isi ID pengguna dan PIN.')
        if (selectMode && !uid) sel.current?.focus()
        return
      }
      setBusy(true)
      const r = await signIn(uid, pw).catch(() => ({ ok: false, err: 'Tidak bisa terhubung ke server. Coba lagi.' }))
      if (!r.ok) { setErr(r.err); setPw(''); setBusy(false) }
      return
    }
    if (!uid) {
      setErr('Pilih pengguna terlebih dahulu.')
      sel.current?.focus()
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
        {selectMode ? (
          <select
            ref={sel} className="login-in" value={uid} aria-label="Pengguna" aria-invalid={err ? 'true' : undefined} disabled={loading} autoFocus={!!signIn}
            onChange={e => { setUid(e.target.value); setErr('') }}
          >
            <option value="">{loading ? 'Memuat daftar pengguna…' : 'Pilih pengguna'}</option>
            {roles.map(([r, a]) => (
              <optgroup key={r} label={r}>
                {a.map(u => <option key={u.id} value={u.id} disabled={!!u.off}>{u.n} ({u.dept}){u.off ? ', nonaktif' : ''}</option>)}
              </optgroup>
            ))}
          </select>
        ) : (
          <input
            className="login-in" placeholder="ID pengguna" aria-label="ID pengguna" autoComplete="username" autoCapitalize="none" autoCorrect="off"
            value={uid} onChange={e => { setUid(e.target.value); setErr('') }} autoFocus
          />
        )}
        <input
          className="login-in" type="password" placeholder={signIn ? 'PIN' : 'Password'} aria-label={signIn ? 'PIN' : 'Password'}
          value={pw} onChange={e => { setPw(e.target.value); setErr('') }} autoComplete="current-password"
          inputMode={signIn ? 'numeric' : undefined}
        />
        <button type="submit" className="login-btn" disabled={busy}>{busy ? 'Memeriksa…' : 'Login'}</button>
        {!REMOTE && !signIn && <p className="login-demo" role="note">Mode demo: data contoh dan tidak tersimpan ke Google Sheets.</p>}
        <img className="login-logo" src={logo} width="334" height="167" decoding="async" alt="DBC, Inspired to Exceed" />
        {!signIn && <p className="login-note">Mode uji coba: password belum diperiksa, boleh dikosongkan.</p>}
      </form>
    </div>
  )
}
