import { describe, it, expect } from 'vitest'
import { createSupaApi, TABLES } from '../lib/supa'
import { buildSeed } from '../data/seed'
import { TODAY, addDays } from '../lib/utils'

// Supabase tiruan di memori: hanya bagian yang dipakai adapter (select/insert/update/delete + eq/is + auth).
function fakeClient(seed, { user = 'andi.prod' } = {}) {
  const tables = {}
  const hooks = { beforeWrite: null, failInsertOn: null }
  let seq = 0
  const rowsOf = k => {
    const { t } = TABLES[k]
    tables[t] = (seed[k] || []).map((r, i) => {
      const o = { seq: ++seq }
      if (r[TABLES[k].key] === undefined) o[TABLES[k].key] = `${k}-seed-${i}` // data contoh lama tanpa id
      for (const [c, v] of Object.entries(r)) o[c] = c === 'off' ? (v ? 'Y' : '') : String(v ?? '')
      if (k === 'U') o.hp = seed.HP[r.id] || ''
      if (['U', 'M', 'R', 'I', 'K'].includes(k)) o._v = '1'
      o.tx = 'SEED'
      return o
    })
  }
  Object.keys(TABLES).forEach(rowsOf)
  tables.tx = []
  const state = { user }
  const builder = (t) => {
    let op = 'select', payload, filters = [], lo = 0, hi = 1e9
    const run = () => {
      const all = (tables[t] = tables[t] || [])
      const match = r => filters.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))
      if (op === 'select') return { data: all.filter(match).slice(lo, hi + 1).map(r => ({ ...r })), error: null }
      if (hooks.beforeWrite) hooks.beforeWrite(t, op, payload)
      if (op === 'insert') {
        if (hooks.failInsertOn && hooks.failInsertOn(t, payload)) return { data: null, error: { message: 'jaringan putus' } }
        const key = Object.values(TABLES).find(x => x.t === t)?.key || 'tx'
        if (all.some(r => r[key] === payload[key])) return { data: null, error: { message: 'duplicate key', code: '23505' } }
        all.push({ seq: ++seq, ...payload })
        return { data: [payload], error: null }
      }
      const hit = all.filter(match)
      if (op === 'update') { hit.forEach(r => Object.assign(r, payload)); return { data: hit.map(r => ({ ...r })), error: null } }
      if (op === 'delete') { tables[t] = all.filter(r => !hit.includes(r)); return { data: hit, error: null } }
    }
    const b = {
      select() { return b },
      order() { return b },
      range(a, z) { lo = a; hi = z; return b },
      insert(p) { op = 'insert'; payload = p; return b },
      update(p) { op = 'update'; payload = p; return b },
      delete() { op = 'delete'; return b },
      eq(c, v) { filters.push([c, v]); return b },
      is(c, v) { filters.push([c, v]); return b },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    return b
  }
  const client = {
    from: builder,
    auth: {
      getSession: async () => ({ data: { session: state.user ? { user: { email: state.user + '@login.siprak.app' } } : null }, error: null }),
      signInWithPassword: async ({ email, password }) => (password === '123456' ? ((state.user = email.split('@')[0]), { error: null }) : { error: { message: 'Invalid login credentials' } }),
      signOut: async () => { state.user = '' },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }
  return { client, tables, hooks, state }
}

const nReq = buildSeed().R.length
const lines = () => [{ kode: 'SRG-001', qty: '5', datang: addDays(TODAY, 10), pakai: addDays(TODAY, 20) }]
const tx = n => 'TX-test-' + String(n).padStart(10, '0')

describe('Supabase adapter', () => {
  it('sync menghasilkan snapshot: HP terpisah dari users, tanpa seq/tx', async () => {
    const f = fakeClient(buildSeed())
    const api = createSupaApi(f.client)
    const r = await api.sync(0)
    expect(r.ok).toBe(true)
    expect(r.snap.U[0].hp).toBeUndefined()
    expect(r.snap.U[0].seq).toBeUndefined()
    expect(r.snap.HP['andi.prod']).toBeTruthy()
    expect(r.snap.R.length).toBe(buildSeed().R.length)
    expect((await api.sync(1)).same).toBe(true)
  })

  it('login: PIN salah ditolak, benar masuk', async () => {
    const f = fakeClient(buildSeed(), { user: '' })
    const api = createSupaApi(f.client)
    expect((await api.signIn('andi.prod', '000000')).err).toMatch(/salah/i)
    expect(await api.session()).toBe(null)
    expect((await api.signIn('Andi.Prod', '123456')).ok).toBe(true)
    expect((await api.session()).id).toBe('andi.prod')
  })

  it('tulis: request baru tersimpan, tx OK, kirim ulang tx sama = replay tanpa baris ganda', async () => {
    const f = fakeClient(buildSeed())
    const api = createSupaApi(f.client)
    const body = { tx: tx(1), name: 'saveRequest', args: [{ status: 'Menunggu Approval', lines: lines() }] }
    const r = await api.write(body)
    expect(r.ok, r.err).toBe(true)
    expect(f.tables.request.length).toBe(nReq + 1)
    const neu = f.tables.request.at(-1)
    expect(neu.by).toBe('andi.prod') // pelaku dari sesi, bukan dari klien
    expect(f.tables.tx.find(x => x.tx === tx(1)).status).toBe('OK')
    const r2 = await api.write(body)
    expect(r2.ok && r2.replay).toBe(true)
    expect(f.tables.request.length).toBe(nReq + 1)
    expect(f.tables.item.length).toBe(seedItemCount + 1)
  })

  it('hak akses: pelaku tidak berwenang ditolak, data tidak berubah', async () => {
    const f = fakeClient(buildSeed(), { user: 'andi.prod' })
    const api = createSupaApi(f.client)
    const r = await api.write({ tx: tx(2), name: 'setuju', args: ['RQ-008'] }) // andi bukan atasan
    expect(r.rejected).toBe(true)
    expect(f.tables.request.find(x => x.id === 'RQ-008').st).toBe('Menunggu Approval')
    expect(f.tables.tx.length).toBe(0)
  })

  it('sesi habis ditolak', async () => {
    const f = fakeClient(buildSeed(), { user: '' })
    const r = await createSupaApi(f.client).write({ tx: tx(3), name: 'saveRequest', args: [{ status: 'Draft', lines: lines() }] })
    expect(r.rejected).toBe(true)
  })

  it('konflik: baris diubah orang lain di tengah jalan -> baca ulang & aksi diulang', async () => {
    const f = fakeClient(buildSeed(), { user: 'budi.spv' })
    const api = createSupaApi(f.client)
    let n = 0
    f.hooks.beforeWrite = (t, op) => {
      if (t === 'request' && op === 'update' && n++ === 0) f.tables.request.find(x => x.id === 'RQ-008').cat = 'diubah orang lain'
    }
    const r = await api.write({ tx: tx(4), name: 'setuju', args: ['RQ-008'] })
    expect(r.ok, r.err).toBe(true)
    const row = f.tables.request.find(x => x.id === 'RQ-008')
    expect(row.st).toBe('Disetujui')
    expect(row.cat).toBe('diubah orang lain') // perubahan orang lain tidak tertimpa
    expect(+row._v).toBeGreaterThan(1)
  })

  it('putus di tengah rencana: kirim ulang tx sama melanjutkan, tidak dobel', async () => {
    const f = fakeClient(buildSeed())
    const api = createSupaApi(f.client)
    let fail = true
    f.hooks.failInsertOn = (t) => fail && t === 'item'
    const body = { tx: tx(5), name: 'saveRequest', args: [{ status: 'Menunggu Approval', lines: lines() }] }
    const r1 = await api.write(body)
    expect(r1.retry).toBe(true)
    fail = false
    const r2 = await api.write(body)
    expect(r2.ok, r2.err).toBe(true)
    expect(f.tables.request.filter(x => x.tx === tx(5)).length).toBe(1)
    expect(f.tables.item.filter(x => x.tx === tx(5)).length).toBe(1)
    expect(f.tables.tx.find(x => x.tx === tx(5)).status).toBe('OK')
  })
})
const seedItemCount = buildSeed().I.length
