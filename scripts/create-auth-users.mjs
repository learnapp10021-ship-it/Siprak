// Membuat akun login (Supabase Auth) untuk semua baris di tabel `users`. Dijalankan DI KOMPUTER ANDA, bukan di browser.
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=sb_secret_... node scripts/create-auth-users.mjs [--reset] [--only=id1,id2]
// - ID pengguna = bagian sebelum @ pada email login: <id>@login.siprak.app (domain bisa diganti: AUTH_DOMAIN).
// - PIN acak 6 digit dibuat per pengguna dan dicetak SEKALI di layar. Bagikan ke pemiliknya lewat jalur aman.
// - Akun yang sudah ada dilewati, kecuali memakai --reset (PIN diganti).
// Secret/Service Role Key HANYA untuk skrip ini. Jangan taruh di .env berawalan VITE_ dan jangan di-commit.
import crypto from 'node:crypto'

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const DOMAIN = process.env.AUTH_DOMAIN || 'login.siprak.app'
const reset = process.argv.includes('--reset')
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
if (!URL_ || !KEY) { console.error('Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }
const call = async (path, opts = {}) => {
  const r = await fetch(URL_ + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  const t = await r.text()
  let j; try { j = JSON.parse(t) } catch { j = t }
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${typeof j === 'string' ? j : JSON.stringify(j)}`)
  return j
}
const pin = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0')

const users = await call('/rest/v1/users?select=id,n,off&order=seq')
const existing = new Map()
for (let page = 1; ; page++) {
  const j = await call(`/auth/v1/admin/users?page=${page}&per_page=200`)
  const list = j.users || []
  list.forEach(u => existing.set(u.email, u))
  if (list.length < 200) break
}
const out = []
for (const u of users) {
  if (only.length && !only.includes(u.id)) continue
  if (u.off === 'Y') continue
  const email = `${String(u.id).toLowerCase()}@${DOMAIN}`
  const have = existing.get(email)
  if (have && !reset) { out.push([u.id, u.n, '(sudah ada, dilewati)']); continue }
  const p = pin()
  if (have) await call(`/auth/v1/admin/users/${have.id}`, { method: 'PUT', body: JSON.stringify({ password: p }) })
  else await call('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: p, email_confirm: true }) })
  out.push([u.id, u.n, p])
}
console.log('\nID pengguna | Nama | PIN\n' + out.map(r => r.join(' | ')).join('\n'))
console.log('\nSimpan daftar ini lalu hapus dari layar/riwayat terminal. PIN tidak bisa dilihat lagi.')
