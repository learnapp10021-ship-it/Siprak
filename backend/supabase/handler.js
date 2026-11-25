// =====================================================================================
// NRB -- Edge Function Supabase (Deno). Pengganti server Google Apps Script, protokol HTTP SAMA PERSIS
// (GET ?action=sync&since=&key= dan POST text/plain {key,tx,name,args,me}) sehingga klien tidak berubah.
//
// Bagian hak akses (PERM/BIND), skema, diff_, dan rules.gs diambil dari backend/src/*.gs oleh
// scripts/build-supabase.mjs, jadi aturan bisnis hanya ada di satu tempat.
//
// Beda dengan Apps Script: tidak ada lock manual. Penulisan memakai concurrency optimistik di database:
//  1. server membaca seluruh data + versinya (nrb_load), menjalankan aksi di memori,
//  2. nrb_apply mengunci baris meta, memastikan versi belum berubah, lalu menulis semua tabel + log tx
//     dalam SATU transaksi Postgres (semua atau tidak sama sekali, jadi tanpa journal/rollback manual),
//  3. jika versi sudah berubah (pengguna lain menulis lebih dulu) server menghitung ulang atas data terbaru.
// Tx yang sama tidak pernah tertulis dua kali (kunci utama tabel tx); kirim ulang hanya menjawab "replay".
// =====================================================================================
const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const MAX_BODY = 600000
const MAX_TRIES = 5
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const tblName = t => SCHEMA[t].sheet.toLowerCase()

function out_(s, status = 200) {
  return new Response(typeof s === 'string' ? s : JSON.stringify(s), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
function reject_(msg, snap) {
  return withSnap_({ ok: false, rejected: true, err: msg }, snap)
}
function retry_(msg, extra) {
  return JSON.stringify(Object.assign({ ok: false, retry: true, err: msg }, extra || {}))
}
function withSnap_(head, snap) {
  const h = JSON.stringify(head)
  return h.slice(0, -1) + ',"snap":' + snap + '}'
}
function authOk_(key) {
  const k = Deno.env.get('API_KEY')
  return !k || key === k
}

// ---------- membaca ----------
async function loadAll_() {
  const { data, error } = await sb.rpc('nrb_load')
  if (error) throw new Error('baca database: ' + error.message)
  const all = {}
  TABLES.forEach(t => {
    all[t] = (data.tables[tblName(t)] || []).map(r => {
      const o = {}
      SCHEMA[t].cols.forEach(c => (o[c] = c === 'off' ? r.off === 'Y' : r[c] == null ? '' : String(r[c])))
      return o
    })
  })
  return { all, ver: +data.ver }
}
async function snapNow_() {
  const { all, ver } = await loadAll_()
  return snapJson_(all, ver)
}
async function sync_(since) {
  const { data: ver, error } = await sb.rpc('nrb_ver')
  if (error) throw new Error('baca versi: ' + error.message)
  if (since && String(since) === String(ver)) return JSON.stringify({ ok: true, same: true, ver: +ver })
  return withSnap_({ ok: true }, await snapNow_())
}

// ---------- menulis ----------
const rowObj_ = (t, row) => {
  const v = ser_(row, SCHEMA[t])
  const o = {}
  SCHEMA[t].cols.forEach((c, i) => (o[c] = v[i]))
  return o
}

async function attempt_(txId, name, args, actorId, t0) {
  // Urutan penting: baca data DULU, baru cek log tx. Jika tx ini sudah sukses (termasuk yang baru saja selesai oleh
  // kiriman kembar yang berjalan bersamaan), jawab replay TANPA menjalankan aksi (aksi akan menolaknya sebagai duplikat).
  // Jika tx baru tertulis setelah pembacaan ini, nrb_apply yang menjawab replay (di dalam kunci).
  const { all: before, ver } = await loadAll_()
  const prior = await sb.from('tx').select('status,msg').eq('tx', txId).maybeSingle()
  if (prior.error) throw new Error('baca log tx: ' + prior.error.message)
  if (prior.data && prior.data.status === 'OK')
    return withSnap_({ ok: true, verified: true, replay: true, msg: prior.data.msg }, await snapNow_())

  const snapBefore = () => snapJson_(before, ver)
  const actor = before.U.find(u => u.id === actorId)
  if (!actor || actor.off) return reject_('Akun tidak ditemukan atau nonaktif.', snapBefore())

  const d = {}
  TABLES.forEach(t => (d[t] = before[t].map(r => Object.assign({}, r))))
  d.HP = {}
  d.U.forEach(u => {
    if (u.hp) d.HP[u.id] = u.hp
  })
  const sel = makeSel(d)

  let res
  try {
    const pe = PERM[name](actor, args, d, sel)
    if (pe) return reject_(pe, snapBefore())
    const bound = (BIND[name] || ((a, x) => x))(actor, args)
    res = actions[name](sel, d, ...bound)
  } catch (e) {
    return reject_('Permintaan tidak valid.', snapBefore())
  }
  if (res && res.err) return reject_(res.err, snapBefore())

  d.U.forEach(u => (u.hp = d.HP[u.id] || ''))
  delete d.HP
  const ch = diff_(before, d, txId)

  const bad = validateChange_(d, ch)
  if (bad.length) {
    const pre = bad.some(e => e.c) ? 'Jumlah tidak cocok dengan data terbaru (mungkin diubah pengguna lain): ' : 'Data tidak valid: '
    return reject_(pre + bad.slice(0, 2).map(e => e.m).join(' | '), snapBefore())
  }

  const msg = (res && res.ok) || ''
  const nChanged = TABLES.reduce((s, t) => s + ch[t].add.length + ch[t].upd.length, 0)
  if (!nChanged) return withSnap_({ ok: true, verified: true, noop: true, msg }, snapBefore())

  const changes = {}
  TABLES.forEach(t => {
    changes[tblName(t)] = {
      add: ch[t].add.map(r => rowObj_(t, r)),
      upd: ch[t].upd.map(u => rowObj_(t, u.after)),
    }
  })
  const { data, error } = await sb.rpc('nrb_apply', {
    p_tx: txId, p_action: name, p_actor: actorId, p_expected: ver, p_changes: changes, p_msg: msg, p_ms: String(Date.now() - t0),
  })
  if (error) throw new Error('simpan database: ' + error.message)
  if (data.status === 'conflict') return 'CONFLICT'
  if (data.status === 'replay') return withSnap_({ ok: true, verified: true, replay: true, msg: data.msg }, await snapNow_())
  if (data.status !== 'ok') throw new Error('respons database tidak dikenal')
  // Sudah tersimpan atomik. Snapshot dibaca ulang dari database supaya klien melihat keadaan sebenarnya.
  return withSnap_({ ok: true, verified: true, msg }, await snapNow_())
}

// Antrean tulis per isolate: permintaan tulis yang tiba bersamaan dikerjakan satu per satu. Tanpa ini, N penulis serentak
// membaca versi yang sama dan hanya satu yang menang per putaran (badai percobaan ulang). Konflik tersisa hanya antar-isolate.
let writeChain_ = Promise.resolve()
let writePending_ = 0
const MAX_PENDING = 200
function serial_(fn) {
  if (writePending_ >= MAX_PENDING) return Promise.resolve(retry_('Server sedang sibuk. Coba lagi sebentar lagi.', { busy: true }))
  writePending_++
  const run = writeChain_.then(fn, fn)
  writeChain_ = run.then(() => {}, () => {})
  return run.finally(() => writePending_--)
}

async function write_(req) {
  const t0 = Date.now()
  const txId = String(req.tx || '')
  if (!/^TX-[A-Za-z0-9_-]{8,80}$/.test(txId)) return JSON.stringify({ ok: false, rejected: true, err: 'ID transaksi tidak valid.' })
  const name = String(req.name || '')
  if (!Object.prototype.hasOwnProperty.call(actions, name) || !PERM[name])
    return JSON.stringify({ ok: false, rejected: true, err: 'Aksi tidak dikenal.' })
  const args = Array.isArray(req.args) ? req.args : []
  const actorId = String(req.me || '')
  return serial_(async () => {
    for (let i = 0; i < MAX_TRIES; i++) {
      refreshToday() // isolate Edge Function hidup lintas hari; "hari ini" harus dihitung ulang
      const r = await attempt_(txId, name, args, actorId, t0)
      if (r !== 'CONFLICT') return r
      await new Promise(ok => setTimeout(ok, 30 + Math.random() * 120 * (i + 1)))
    }
    return retry_('Server sedang melayani banyak pengguna. Coba lagi sebentar lagi.', { busy: true })
  })
}

// ---------- pintu masuk ----------
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    if (req.method === 'POST') {
      const raw = await req.text()
      if (raw.length > MAX_BODY) return out_({ ok: false, rejected: true, err: 'Permintaan terlalu besar.' })
      const body = JSON.parse(raw)
      if (!authOk_(body.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
      return out_(await write_(body))
    }
    const p = Object.fromEntries(new URL(req.url).searchParams)
    if (!authOk_(p.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
    if (p.action === 'ping') return out_({ ok: true, time: nowStr() })
    return out_(await sync_(p.since))
  } catch (err) {
    return out_(retry_('Terjadi kesalahan di server: ' + (err && err.message ? err.message : err)))
  }
})
