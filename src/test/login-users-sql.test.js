// @vitest-environment node
// login_users(): anon hanya melihat id, nama, dept, peran pengguna AKTIF; tabel users tetap tertutup. Diuji di Postgres sungguhan (PGlite).
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const sql = f => fs.readFileSync(path.resolve(__dirname, '../../supabase', f), 'utf8')
let db
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create table public.users (seq bigint generated always as identity, "id" text primary key, "n" text, "dept" text, "role" text, "boss" text, "hp" text, "off" text);
    alter table public.users enable row level security;
    create policy auth_select on public.users for select to authenticated using (true);
    grant select on public.users to anon, authenticated;
    insert into public.users ("id","n","dept","role","boss","hp","off") values
      ('wati.wh','Wati Handayani','Warehouse','Admin Warehouse','','6281200000001',''),
      ('andi.prod','Andi Saputra','Produksi','User','budi.spv','6281200000003',''),
      ('budi.spv','Budi Hartono','Produksi','Atasan','','6281200000002',''),
      ('eko.prod','Eko Nugroho','Produksi','User','budi.spv','6281200000009','Y');`)
  await db.exec(sql('login_users.sql'))
})
const as = async (role, q) => { await db.exec(`set role ${role}`); try { return (await db.query(q)).rows } finally { await db.exec('reset role') } }

describe('login_users()', () => {
  it('anon: tabel users tetap tertutup (RLS), tetapi fungsi memberi daftar', async () => {
    expect(await as('anon', 'select * from public.users')).toEqual([])
    const r = await as('anon', 'select * from public.login_users()')
    expect(r.length).toBe(3)
  })
  it('hanya 4 kolom: tanpa hp, atasan, atau kolom internal', async () => {
    const r = await as('anon', 'select * from public.login_users()')
    expect(Object.keys(r[0]).sort()).toEqual(['dept', 'id', 'n', 'role'])
    expect(JSON.stringify(r)).not.toMatch(/6281200000|budi\.spv.*boss/)
  })
  it('pengguna nonaktif tidak ikut, urutan menurut nama', async () => {
    const r = await as('anon', 'select * from public.login_users()')
    expect(r.map(x => x.id)).toEqual(['andi.prod', 'budi.spv', 'wati.wh'])
    expect(r.some(x => x.id === 'eko.prod')).toBe(false)
  })
  it('berlaku juga untuk authenticated', async () => {
    expect((await as('authenticated', 'select * from public.login_users()')).length).toBe(3)
  })
  it('berkas yang sama sudah termasuk di setup.sql', () => {
    const setup = sql('setup.sql')
    expect(setup).toContain('create or replace function public.login_users()')
    expect(setup).toContain('grant execute on function public.login_users() to anon, authenticated')
    expect(setup).toContain("coalesce(u.\"off\", '') <> 'Y'")
  })
})
