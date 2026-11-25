// Membangkitkan supabase/seed-demo.sql (pengguna + master contoh, TANPA request) dari src/data/seed.js.
//   node scripts/gen-seed-supabase.mjs
// Untuk data sungguhan JANGAN jalankan seed ini; isi tabel users (minimal satu Admin Warehouse) lalu impor master dari aplikasi.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const strip = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')
const { buildSeed } = new Function(strip('src/lib/utils.js') + strip('src/lib/selectors.js') + strip('src/data/seed.js') + '\nreturn { buildSeed }')()
const s = buildSeed()
const lit = v => "'" + String(v ?? '').replace(/'/g, "''") + "'"
const U = s.U.map(u => `  (${[u.id, u.n, u.dept, u.role, u.boss || '', s.HP[u.id] || '', u.off ? 'Y' : '', '1', 'SEED'].map(lit).join(', ')})`)
const M = s.M.map(m => `  (${[m.k, m.n, m.sat, m.buf, m.kons, m.lead, '1', 'SEED'].map(lit).join(', ')})`)
const sql = `-- Data contoh: pengguna + master item (tanpa request). Dibangkitkan oleh scripts/gen-seed-supabase.mjs.
-- Jalankan di SQL Editor Supabase SETELAH migrasi, hanya untuk uji coba.
insert into public.users ("id", "n", "dept", "role", "boss", "hp", "off", "_v", "tx") values
${U.join(',\n')}
on conflict ("id") do nothing;

insert into public.master ("k", "n", "sat", "buf", "kons", "lead", "_v", "tx") values
${M.join(',\n')}
on conflict ("k") do nothing;
`
fs.mkdirSync(path.join(root, 'supabase'), { recursive: true })
fs.writeFileSync(path.join(root, 'supabase/seed-demo.sql'), sql)
console.log('Tulis supabase/seed-demo.sql:', s.U.length, 'pengguna,', s.M.length, 'master')
