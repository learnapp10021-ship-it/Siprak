// Menjalankan Edge Function ASLI (supabase/functions/api/index.ts) di atas Postgres SUNGGUHAN (PGlite = Postgres dalam WASM)
// dengan migrasi dan seed ASLI. Dipakai oleh backend/test/supabase.mjs dan scripts/mock-supabase.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = f => fs.readFileSync(path.join(root, f), 'utf8')

export async function createSupabaseBackend({ seed = true, env = {} } = {}) {
  const db = new PGlite()
  // Meniru Supabase: peran bawaan + hak default (anon/authenticated/service_role diberi akses ke tabel baru).
  // Migrasi harus mencabut hak anon/authenticated; uji RLS memeriksanya.
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`)
  await db.exec(rd('supabase/migrations/0001_nrb.sql'))
  if (seed) await db.exec(rd('supabase/seed-demo.sql'))

  const stats = { apply: 0, conflict: 0, replay: 0, ok: 0 }
  const wrap = async f => {
    try {
      return { data: await f(), error: null }
    } catch (e) {
      return { data: null, error: { message: String(e.message || e) } }
    }
  }
  const sb = {
    rpc: (fn, a = {}) =>
      wrap(async () => {
        if (fn === 'nrb_ver') return (await db.query('select public.nrb_ver() as r')).rows[0].r
        if (fn === 'nrb_load') return (await db.query('select public.nrb_load() as r')).rows[0].r
        if (fn === 'nrb_apply') {
          stats.apply++
          const r = (await db.query('select public.nrb_apply($1,$2,$3,$4,$5::jsonb,$6,$7) as r', [a.p_tx, a.p_action, a.p_actor, a.p_expected, JSON.stringify(a.p_changes), a.p_msg, a.p_ms])).rows[0].r
          stats[r.status] = (stats[r.status] || 0) + 1
          return r
        }
        throw new Error('rpc tidak dikenal: ' + fn)
      }),
    from: t => {
      if (t !== 'tx') throw new Error('tabel tak terduga: ' + t)
      return { select: () => ({ eq: (c, v) => ({ maybeSingle: () => wrap(async () => (await db.query('select status, msg from public.tx where tx = $1', [v])).rows[0] || null) }) }) }
    },
  }

  const src = rd('supabase/functions/api/index.ts').replace(/^import .*createClient.*$/m, '') + '\n;globalThis.__NRB = { SCHEMA, TABLES }'
  // Setiap isolate = salinan fungsi dengan antrean tulis sendiri, berbagi database yang sama (seperti Supabase sungguhan).
  const isolate = () => {
    let h
    new Function('createClient', 'Deno', src)(() => sb, { env: { get: k => env[k] }, serve: f => (h = f) })
    return h
  }
  const handler = isolate()
  return { handler, isolate, db, sb, stats, env, nrb: globalThis.__NRB }
}
