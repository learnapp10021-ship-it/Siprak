// Backend Supabase untuk NRB: login Supabase Auth + baca/tulis tabel lewat supabase-js.
// Antarmuka sama dengan api.js (sync / write / newTx) supaya store.jsx tidak perlu tahu backend mana yang dipakai.
//
// Aturan bisnis TIDAK diduplikasi: aksi (actions.js) dan hak akses (perm.js) adalah modul yang sama dengan server Apps Script.
// Jaminan data (tanpa server perantara, jadi dijaga di sini):
//   - Setiap perubahan baris dijaga "nilai lama harus masih sama" (optimistic lock). Jika orang lain mengubah baris
//     yang sama lebih dulu, tulisan batal, data dibaca ulang, aksi dijalankan lagi (maks. 4 kali).
//   - Rencana tulis (write-ahead) disimpan di tabel tx berstatus PENDING sebelum menyentuh data. Kirim ulang dengan tx
//     yang sama melanjutkan rencana yang sama (idempoten), tidak menjalankan aksi dua kali.
//   - Jika tulisan gagal di tengah jalan karena konflik, perubahan yang sudah masuk dikembalikan.
// Batas: tanpa transaksi database, kegagalan jaringan di tengah rencana bisa meninggalkan tx PENDING sampai klien
// yang sama mengirim ulang. Untuk jaminan penuh, pindahkan penerapan rencana ke fungsi Postgres (RPC).
import { produce } from 'immer'
import { makeSel } from './selectors'
import { actions } from './actions'
import { PERM, BIND } from './perm'

export const TABLES = {
  U: { t: 'users', key: 'id' },
  M: { t: 'master', key: 'k' },
  R: { t: 'request', key: 'id' },
  I: { t: 'item', key: 'id' },
  K: { t: 'konsolidasi', key: 'id' },
  L: { t: 'srl', key: 'no' },
  KD: { t: 'kedatangan', key: 'id' },
  SR: { t: 'serahterima', key: 'id' },
  RM: { t: 'pengingat', key: 'id' },
}
const KEYS = Object.keys(TABLES)
// Kolom yang diasumsikan ada bila tabel masih kosong (sama dengan sheet lama).
const DEFAULT_COLS = {
  U: ['id', 'n', 'dept', 'role', 'boss', 'hp', 'off', '_v', 'tx'],
  M: ['k', 'n', 'sat', 'buf', 'kons', 'lead', '_v', 'tx'],
  R: ['id', 'by', 'tgl', 'st', 'cat', 'at', '_v', 'tx'],
  I: ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan', '_v', 'tx'],
  K: ['id', 'dept', 'by', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan', '_v', 'tx'],
  L: ['no', 'dept', 'est', 'tx'],
  KD: ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl', 'id', 'at', 'tx'],
  SR: ['item', 'qty', 'to', 'tgl', 'id', 'at', 'tx'],
  RM: ['item', 'by', 'at', 'id', 'tx'],
}
const TX_TABLE = 'tx'
const PAGE = 1000
const MAX_ATTEMPTS = 4
export const AUTH_DOMAIN = 'login.siprak.app'

export const emailOf = (id, domain = AUTH_DOMAIN) => `${String(id).trim().toLowerCase()}@${domain}`
export const idOf = email => String(email || '').split('@')[0]

const nowStr = () => {
  const d = new Date(Date.now() + 7 * 3600e3) // WIB
  return d.toISOString().slice(0, 16).replace('T', ' ')
}
const txOk = id => /^TX-[A-Za-z0-9_-]{8,80}$/.test(id)

export const newTx = () => {
  const rnd = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/-/g, '')
  return 'TX-' + Date.now().toString(36) + '-' + rnd.slice(0, 16)
}

const text = (k, v) => (k === 'off' ? (v ? 'Y' : '') : v == null ? '' : String(v))
const fromDb = (k, v) => (k === 'off' ? v === 'Y' || String(v).toUpperCase() === 'TRUE' : v == null ? '' : String(v))

function errOf(error, ctx) {
  const e = new Error(`${ctx}: ${error.message || error}`)
  e.code = error.code
  return e
}

export function createSupaApi(client, { domain = AUTH_DOMAIN } = {}) {
  // ---------- sesi ----------
  async function session() {
    const { data, error } = await client.auth.getSession()
    if (error) throw errOf(error, 'sesi')
    const u = data?.session?.user
    return u ? { id: idOf(u.email) } : null
  }
  async function signIn(id, pin) {
    const uid = String(id || '').trim().toLowerCase()
    if (!uid || !pin) return { ok: false, err: 'Isi ID pengguna dan PIN.' }
    const { error } = await client.auth.signInWithPassword({ email: emailOf(uid, domain), password: String(pin) })
    if (error) {
      const m = /invalid login|credentials/i.test(error.message) ? 'ID atau PIN salah.' : /rate|too many/i.test(error.message) ? 'Terlalu banyak percobaan. Tunggu beberapa menit.' : 'Tidak bisa masuk: ' + error.message
      return { ok: false, err: m }
    }
    return { ok: true, id: uid }
  }
  async function signOut() {
    await client.auth.signOut()
  }
  // Daftar pengguna untuk DIPILIH di layar login (fungsi database login_users: hanya id, nama, dept, peran; tanpa hp/atasan).
  // Gagal/tidak ada fungsinya => { ok: false } dan layar login memakai kotak ketik ID.
  async function loginUsers() {
    try {
      const { data, error } = await client.rpc('login_users')
      if (error || !Array.isArray(data)) return { ok: false }
      return { ok: true, users: data.map(u => ({ id: String(u.id), n: String(u.n ?? ''), dept: String(u.dept ?? ''), role: String(u.role ?? '') })) }
    } catch {
      return { ok: false }
    }
  }
  function onAuth(cb) {
    const { data } = client.auth.onAuthStateChange((_e, s) => cb(s?.user ? { id: idOf(s.user.email) } : null))
    return () => data?.subscription?.unsubscribe?.()
  }

  // ---------- baca ----------
  async function fetchTable(k) {
    const { t } = TABLES[k]
    const rows = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client.from(t).select('*').order('seq', { ascending: true }).range(from, from + PAGE - 1)
      if (error) throw errOf(error, t)
      rows.push(...(data || []))
      if (!data || data.length < PAGE) break
    }
    return rows
  }

  // Mengembalikan { snap (bentuk sama dengan snapshot Apps Script, tanpa ver), raw, cols }.
  async function readAll() {
    const parts = await Promise.all(KEYS.map(fetchTable))
    const snap = { HP: {} }
    const raw = {}
    const cols = {}
    KEYS.forEach((k, i) => {
      const rows = parts[i]
      cols[k] = rows.length ? Object.keys(rows[0]).filter(c => c !== 'seq') : DEFAULT_COLS[k]
      raw[k] = new Map()
      snap[k] = rows.map(r => {
        const { seq, ...r0 } = r
        raw[k].set(String(r0[TABLES[k].key]), r0)
        const x = {}
        for (const c of cols[k]) {
          if (c === 'tx' || (k === 'U' && c === 'hp')) continue
          x[c] = fromDb(c, r0[c])
        }
        if (k === 'U' && r0.hp) snap.HP[r0.id] = String(r0.hp)
        return x
      })
    })
    return { snap, raw, cols }
  }

  let lastHash = ''
  const hash = s => {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
    return (h >>> 0).toString(36) + ':' + s.length
  }
  // Sama seperti api.sync: { ok, snap } atau { ok, same }.
  async function sync(since) {
    try {
      const { snap } = await readAll()
      const h = hash(JSON.stringify(snap))
      if (since && h === lastHash) return { ok: true, same: true }
      lastHash = h
      return { ok: true, snap: { ver: Date.now(), ...snap } }
    } catch (e) {
      return { ok: false, err: e.message }
    }
  }

  // ---------- diff ----------
  // Bandingkan snapshot lama & baru -> rencana { ins:[{k,row}], upd:[{k,key,before,after}], del:[{k,key,before}] }
  function plan(before, after, raw, cols, txId, hpBefore, hpAfter) {
    const ops = { ins: [], upd: [], del: [] }
    KEYS.forEach(k => {
      const key = TABLES[k].key
      const cs = cols[k]
      const hasV = cs.includes('_v')
      const hasTx = cs.includes('tx')
      const prev = new Map(before[k].map(r => [String(r[key]), r]))
      const seen = new Set()
      for (const r of after[k]) {
        const id = String(r[key])
        seen.add(id)
        const old = prev.get(id)
        const hp = k === 'U' ? hpAfter[id] || '' : null
        if (!old) {
          const row = {}
          for (const c of cs) {
            if (c === 'tx') row.tx = txId
            else if (c === '_v') row._v = '1'
            else if (c === 'hp') row.hp = hp || ''
            else row[c] = text(c, r[c])
          }
          ops.ins.push({ k, key: id, row })
          continue
        }
        const patch = {}
        for (const c of cs) {
          if (c === 'tx' || c === '_v') continue
          if (c === 'hp') {
            if ((hpBefore[id] || '') !== hp) patch.hp = hp
            continue
          }
          if (text(c, r[c]) !== text(c, old[c])) patch[c] = text(c, r[c])
        }
        if (Object.keys(patch).length) {
          const rawOld = raw[k].get(id)
          if (hasV) patch._v = String((+rawOld._v || 0) + 1)
          if (hasTx) patch.tx = txId
          ops.upd.push({ k, key: id, guard: rawOld, patch })
        }
      }
      for (const [id] of prev) if (!seen.has(id)) ops.del.push({ k, key: id, guard: raw[k].get(id) })
    })
    return ops
  }

  // ---------- tulis ----------
  const guarded = (q, row) => {
    for (const [c, v] of Object.entries(row)) q = v === null ? q.is(c, null) : q.eq(c, v)
    return q
  }
  const eqKey = (q, k, id) => q.eq(TABLES[k].key, id)

  async function applyIns(op) {
    const { t } = TABLES[op.k]
    // idempoten: baris yang sama dengan ID ini sudah ada (percobaan sebelumnya) dianggap berhasil bila isinya sama
    const { error } = await client.from(t).insert(op.row)
    if (!error) return 'done'
    const { data } = await eqKey(client.from(t).select('*'), op.k, op.key)
    const cur = data && data[0]
    if (cur && Object.entries(op.row).every(([c, v]) => text(c, cur[c]) === text(c, v))) return 'already'
    if (cur) return 'conflict'
    throw errOf(error, t)
  }
  async function applyUpd(op) {
    const { t } = TABLES[op.k]
    const { data, error } = await guarded(eqKey(client.from(t).update(op.patch), op.k, op.key), op.guard).select()
    if (error) throw errOf(error, t)
    if (data && data.length) return 'done'
    const { data: cur, error: e2 } = await eqKey(client.from(t).select('*'), op.k, op.key)
    if (e2) throw errOf(e2, t)
    const row = cur && cur[0]
    if (row && Object.entries(op.patch).every(([c, v]) => text(c, row[c]) === text(c, v))) return 'already'
    return 'conflict'
  }
  async function applyDel(op) {
    const { t } = TABLES[op.k]
    const { data, error } = await guarded(eqKey(client.from(t).delete(), op.k, op.key), op.guard).select()
    if (error) throw errOf(error, t)
    if (data && data.length) return 'done'
    const { data: cur } = await eqKey(client.from(t).select('*'), op.k, op.key)
    return cur && cur.length ? 'conflict' : 'already'
  }

  // Kembalikan op yang sudah 'done' (urutan terbalik). Hanya yang kita tulis sendiri (done), bukan 'already'.
  async function revert(done) {
    for (const { type, op } of [...done].reverse()) {
      const { t } = TABLES[op.k]
      try {
        if (type === 'ins') await eqKey(client.from(t).delete(), op.k, op.key)
        else if (type === 'upd') {
          const back = {}
          for (const c of Object.keys(op.patch)) back[c] = op.guard[c] === undefined ? null : op.guard[c]
          await guarded(eqKey(client.from(t).update(back), op.k, op.key), { ...op.patch })
        } else await client.from(t).insert(op.guard)
      } catch { /* upaya terbaik; tx ditandai ROLLED_BACK */ }
    }
  }

  async function getTx(id) {
    const { data, error } = await client.from(TX_TABLE).select('*').eq('tx', id)
    if (error) throw errOf(error, TX_TABLE)
    return (data && data[0]) || null
  }
  const putTx = async (row) => {
    const { error } = await client.from(TX_TABLE).insert(row)
    if (error) throw errOf(error, TX_TABLE)
  }
  const setTx = async (id, patch) => {
    const { error } = await client.from(TX_TABLE).update(patch).eq('tx', id)
    if (error) throw errOf(error, TX_TABLE)
  }

  // Jalankan rencana. Mengembalikan 'ok' | 'conflict'.
  async function execute(ops, txId, done = []) {
    const list = [
      ...ops.ins.map(op => ({ type: 'ins', op })),
      ...ops.upd.map(op => ({ type: 'upd', op })),
      ...ops.del.map(op => ({ type: 'del', op })),
    ]
    for (const it of list) {
      const r = await (it.type === 'ins' ? applyIns : it.type === 'upd' ? applyUpd : applyDel)(it.op)
      if (r === 'conflict') {
        await revert(done)
        return 'conflict'
      }
      if (r === 'done') done.push(it)
    }
    return 'ok'
  }

  const withSnap = async r => {
    try {
      const { snap } = await readAll()
      return { ...r, snap: { ver: Date.now(), ...snap } }
    } catch { return r }
  }
  const retry = (err, extra) => ({ ok: false, retry: true, err, ...extra })

  async function write({ tx, name, args }) {
    if (!txOk(tx)) return { ok: false, rejected: true, err: 'ID transaksi tidak valid.' }
    if (!Object.prototype.hasOwnProperty.call(actions, name) || !PERM[name]) return { ok: false, rejected: true, err: 'Aksi tidak dikenal.' }
    try {
      const s = await session()
      if (!s) return { ok: false, rejected: true, err: 'Sesi berakhir. Silakan masuk lagi.' }

      let prior = await getTx(tx)
      if (prior && prior.status === 'OK') return withSnap({ ok: true, verified: true, replay: true, msg: prior.msg && prior.msg[0] !== '{' ? prior.msg : '' })
      if (prior && prior.status === 'PENDING') {
        // Percobaan sebelumnya terputus: lanjutkan rencana yang SAMA (tidak menjalankan aksi lagi)
        let saved
        try { saved = JSON.parse(prior.msg) } catch { saved = null }
        if (saved && saved.ops) {
          const r = await execute(saved.ops, tx)
          if (r === 'ok') {
            await setTx(tx, { status: 'OK', msg: saved.msg || '' })
            return withSnap({ ok: true, verified: true, msg: saved.msg || '' })
          }
          await setTx(tx, { status: 'ROLLED_BACK', msg: 'konflik saat dilanjutkan' })
          prior = null
        }
      }

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { snap, raw, cols } = await readAll()
        const actor = snap.U.find(u => u.id === s.id)
        if (!actor || actor.off) return { ok: false, rejected: true, err: 'Akun tidak ditemukan atau nonaktif.', snap: { ver: Date.now(), ...snap } }

        const hpBefore = snap.HP
        let res
        let err = ''
        const base = { ...snap }
        let next
        try {
          next = produce(base, d => {
            const sel = makeSel(d)
            err = PERM[name](actor, args, d, sel)
            if (err) return
            const bound = (BIND[name] || ((a, x) => x))(actor, args)
            res = actions[name](sel, d, ...bound)
          })
        } catch {
          err = 'Permintaan tidak valid.'
        }
        if (err || res?.err) {
          const rej = { ok: false, rejected: true, err: err || res.err, snap: { ver: Date.now(), ...snap } }
          return rej
        }
        const ops = plan(snap, next, raw, cols, tx, hpBefore, next.HP || {})
        const msg = res?.ok || ''
        const total = ops.ins.length + ops.upd.length + ops.del.length

        await putTx({ tx, action: name, actor: s.id, at: nowStr(), status: 'PENDING', msg: JSON.stringify({ ops, msg }), ms: '' })
          .catch(async e => {
            // tx sudah ada: dikirim paralel dari tab lain; biarkan klien mencoba lagi
            const again = await getTx(tx)
            if (again) throw Object.assign(new Error('Transaksi sedang diproses.'), { busyTx: true })
            throw e
          })
        const r = total ? await execute(ops, tx) : 'ok'
        if (r === 'conflict') {
          await setTx(tx, { status: 'ROLLED_BACK', msg: 'konflik, diulang' })
          // tx baru untuk percobaan berikutnya tidak diperlukan: hapus baris agar ID yang sama bisa dipakai lagi
          await client.from(TX_TABLE).delete().eq('tx', tx)
          continue
        }
        await setTx(tx, { status: 'OK', msg })
        return withSnap({ ok: true, verified: true, msg })
      }
      return retry('Data sedang sering berubah oleh pengguna lain. Coba lagi.', { busy: false })
    } catch (e) {
      return retry(e.busyTx ? e.message : 'Tidak bisa menyimpan: ' + (e.message || e), { unknown: true })
    }
  }

  return { sync, write, newTx, session, signIn, signOut, loginUsers, onAuth, _readAll: readAll }
}
