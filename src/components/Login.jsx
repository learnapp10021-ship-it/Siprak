import { useMemo, useState } from 'react'

const ORDER = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']
const initials = n => n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

// Masuk sementara tanpa kata sandi: cukup pilih salah satu pengguna yang sudah terdaftar.
export function Login({ users, onPick }) {
  const [q, setQ] = useState('')
  const key = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const l = users.filter(u => !key || (u.n + ' ' + u.dept + ' ' + u.role + ' ' + u.id).toLowerCase().includes(key))
    const roles = [...new Set([...ORDER, ...l.map(u => u.role)])]
    return roles
      .map(r => [r, l.filter(u => u.role == r).sort((a, b) => a.n.localeCompare(b.n))])
      .filter(([, a]) => a.length)
  }, [users, key])

  return (
    <div className="login">
      <div className="login-hd">
        <div className="login-logo" aria-hidden="true">S</div>
        <h1>SIPRAK</h1>
        <p>Request barang</p>
      </div>
      <div className="login-body">
        <h2>Masuk</h2>
        <p className="mut">Pilih nama Anda. Sementara belum memakai kata sandi.</p>
        {users.length > 6 ? (
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nama, departemen, atau peran" aria-label="Cari pengguna" />
        ) : null}
        {groups.map(([role, a]) => (
          <section key={role} aria-label={role}>
            <div className="login-role">{role}</div>
            {a.map(u => (
              <button key={u.id} className="login-u" disabled={!!u.off} onClick={() => onPick(u.id)}>
                <span className="login-av" aria-hidden="true">{initials(u.n)}</span>
                <span className="login-t"><b>{u.n}</b><small>{u.dept}{u.off ? ', nonaktif' : ''}</small></span>
                <span className="login-go" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        ))}
        {key && !groups.length ? <p className="mut">Tidak ada pengguna yang cocok dengan "{q.trim()}".</p> : null}
      </div>
    </div>
  )
}
