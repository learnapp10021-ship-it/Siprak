// Verifikasi otomatis SIPRAK: `npm run verify`
//  1. Data contoh konsisten (relasi) menurut audit server (Code.gs) DAN pemeriksa independen di sini.
//  2. Setiap aksi aplikasi (actions.js) menghasilkan operasi yang DITERIMA validator server, dan keadaan
//     akhir di server identik dengan keadaan di klien.
//  3. Pelanggaran relasi/aturan DITOLAK server, dan klien menolak aksi yang tak sah.
import fs from 'node:fs'
import vm from 'node:vm'
import nodeCrypto from 'node:crypto'
import { produce } from 'immer'
import { buildSeed } from '../src/data/seed.js'
import { makeSel } from '../src/lib/selectors.js'
import { actions } from '../src/lib/actions.js'
import { diffDb } from '../src/lib/diff.js'
import { addDays, today } from '../src/lib/utils.js'

/* ------------------------------------------------------------- harness */
let pass = 0, fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) pass++
  else { fail++; console.log('  GAGAL:', name, extra) }
}
const section = s => console.log('\n# ' + s)

/* --------------------------------------------- muat Code.gs asli ke VM */
const gs = vm.createContext({ console, Logger: { log() {} } })
vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), gs)

const TABLES = ['U', 'M', 'R', 'I', 'K', 'L', 'KD', 'SR', 'RM']
const strRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === true ? 'Y' : v == null ? '' : String(v)]))
// Bentuk klien -> bentuk tabel server (seperti isi sheet)
const toServer = db => ({
  U: db.U.map(u => strRow({ ...u, hp: db.HP[u.id] || '', off: u.off ? 'Y' : '' })),
  ...Object.fromEntries(['M', 'R', 'I', 'K', 'L', 'KD', 'SR', 'RM'].map(t => [t, db[t].map(strRow)])),
})
const cols = t => gs.SCHEMA[t].cols
// Samakan bentuk: hanya kolom skema, urutan kolom tetap
const canon = (t, r) => Object.fromEntries(cols(t).map(c => [c, r[c] == null ? '' : String(r[c])]))
const canonDb = tb => JSON.stringify(Object.fromEntries(TABLES.map(t => [t, tb[t].map(r => canon(t, r))])))

const jsonClone = o => JSON.parse(JSON.stringify(o))

// Jalankan satu aksi seperti store.act: kembalikan { err } atau { db, ops, res }
function run(db, name, ...args) {
  let res
  const next = produce(db, d => {
    res = actions[name](makeSel(d), d, ...args)
  })
  if (res?.err) return { err: res.err }
  return { db: next, ops: diffDb(db, next), res }
}

// Kirim operasi ke validator server. Kembalikan { post } atau { err, conflict }.
function serverApply(prevDb, ops, preOverride, uid) {
  const pre = preOverride || toServer(prevDb)
  try {
    const plan = gs.planOps_(jsonClone(pre), jsonClone(ops))
    gs.validateChanges_(plan.post, plan.changes, uid)
    return { post: plan.post }
  } catch (e) {
    return { err: e.message, conflict: !!e.conflict }
  }
}

// Aksi sukses di klien => harus diterima server dan hasilnya identik, dan seluruh DB tetap konsisten
function good(db, label, name, ...args) {
  const r = run(db, name, ...args)
  if (r.err) { ok(false, label, '(klien menolak: ' + r.err + ')'); return db }
  const s = serverApply(db, r.ops)
  if (s.err) { ok(false, label, '(server menolak: ' + s.err + ')'); return r.db }
  ok(canonDb(s.post) === canonDb(toServer(r.db)), label + ' [klien == server]')
  const audit = gs.auditAll_(jsonClone(s.post))
  ok(audit.length === 0, label + ' [audit penuh]', audit.join(' | '))
  return r.db
}
// Aksi yang harus ditolak klien
function badClient(db, label, name, ...args) {
  const r = run(db, name, ...args)
  ok(!!r.err, label + ' [ditolak klien]', r.err ? '' : '(malah diterima)')
}
// Operasi mentah yang harus ditolak server
function badServer(db, label, ops, { conflict, pre } = {}) {
  const s = serverApply(db, ops, pre)
  ok(!!s.err, label + ' [ditolak server]', s.err ? '' : '(malah diterima)')
  if (s.err && conflict !== undefined) ok(s.conflict === conflict, label + ' [jenis galat konflik=' + conflict + ']', s.err)
}

/* ------------------------------------------------------- 1. data contoh */
section('1. Data contoh')
const seed = buildSeed()
{
  const errs = gs.auditAll_(jsonClone(toServer(seed)))
  ok(errs.length === 0, 'audit server atas seed.js', errs.join(' | '))
  const gsText = fs.readFileSync('apps-script/Seed.gs', 'utf8')
  const m = gsText.match(/var SEED_DB = (\{.*\});/s)
  const gsDb = JSON.parse(m[1])
  const errs2 = gs.auditAll_(jsonClone(toServer(gsDb)))
  ok(errs2.length === 0, 'audit server atas Seed.gs', errs2.join(' | '))
  // Seed.gs dibuat dari seed.js: tanggal relatif hari ini (pengingat) boleh beda, struktur harus sama
  const strip = db => JSON.stringify({ ...db, RM: db.RM.map(r => r.item + r.by) })
  ok(strip(gsDb) === strip(seed), 'Seed.gs sinkron dengan seed.js (jalankan `npm run gen:seed` bila gagal)')
}

/* ------------------------------------------------------ 2. alur lengkap */
section('2. Alur lengkap: request -> persetujuan -> SRL -> kedatangan -> serah terima')
const T = today()
const kb = (kode, qty, lead, pakai = '') => ({ kode, qty: String(qty), datang: addDays(T, lead), pakai })
let db = seed

// ID baru dari nomor terbesar
db = good(db, 'andi membuat draft', 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 3, 2, addDays(T, 9))], me: db.U.find(u => u.id === 'andi.prod') })
const idDraft = db.R[db.R.length - 1].id
ok(idDraft === 'RQ-018', 'ID request berikutnya RQ-018', idDraft)
ok(db.I[db.I.length - 1].id === 'ITM-044', 'ID item berikutnya ITM-044')
db = good(db, 'andi mengajukan draft', 'ajukan', idDraft, 'andi.prod')
db = good(db, 'siti langsung mengajukan 2 barang', 'saveRequest', {
  status: 'Menunggu Approval', lines: [kb('LAS-021', 2, 3, addDays(T, 10)), kb('SRG-002', 5, 3)], me: db.U.find(u => u.id === 'siti.prod'),
})
const idSiti = db.R[db.R.length - 1].id
db = good(db, 'budi menyetujui request andi', 'setuju', idDraft, 'budi.spv')
db = good(db, 'budi menolak request siti (dengan catatan)', 'tolak', idSiti, 'Belum dibutuhkan', 'budi.spv')
ok(db.I.filter(i => i.req === idSiti).every(i => i.status === 'Ditolak'), 'barang request ditolak ikut Ditolak')

// Setuju-semua
db = good(db, 'rudi mengajukan', 'saveRequest', { status: 'Menunggu Approval', lines: [kb('KBL-005', 4, 2, addDays(T, 8))], me: db.U.find(u => u.id === 'rudi.prod') })
db = good(db, 'budi setujui semua', 'setujuAll', 'budi.spv')

// Menahan & melepas, lalu SRL
const poolItem = db.I.find(i => i.status === 'Approved' && !i.kon && i.kode === 'KBL-005' && !i.tahan)
db = good(db, 'dewi menahan barang', 'tahan', poolItem.id, 'Tunggu spesifikasi', 'dewi.admin')
db = good(db, 'dewi melepas tahan', 'lepas', poolItem.id, 'dewi.admin')
const dewi = db.U.find(u => u.id === 'dewi.admin')
db = good(db, 'dewi menyimpan SRL', 'simpanSrl', { no: 'SRL-2611-099', est: addDays(T, 5), me: dewi })
const kNew = db.K.filter(k => k.srl === 'SRL-2611-099')
ok(kNew.length >= 1 && kNew.every(k => k.by === 'dewi.admin'), 'konsolidasi baru menyimpan ID pembuat', JSON.stringify(kNew.map(k => k.by)))
const kKbl = kNew.find(k => k.kode === 'KBL-005')
ok(+kKbl.ero === db.I.filter(i => i.kon === kKbl.id).reduce((a, i) => a + +i.qty, 0) && +kKbl.ero === 10, 'ERO KBL-005 = jumlah barang di dalamnya (3 + 3 + 4)', kKbl && kKbl.ero)

// Kedatangan
db = good(db, 'wati catat datang sebagian', 'datang', { id: kKbl.id, q: 3, l: 0, cat: '', by: 'wati.wh' })
db = good(db, 'wati catat sisa + kelebihan bercatatan', 'datang', { id: kKbl.id, q: 4, l: 1, cat: 'Supplier kirim lebih', by: 'wati.wh' })
ok(db.KD.at(-1).by === 'wati.wh', 'kedatangan menyimpan ID pencatat')
const kOther = kNew.find(k => k.id !== kKbl.id)
if (kOther) db = good(db, 'joko catat semua kedatangan SRL', 'datangAll', 'SRL-2611-099', 'joko.wh')

// Serah terima: jatah dibagi menurut urutan kebutuhan
const itemsK = db.I.filter(i => i.kon === kKbl.id)
const sel = makeSel(db)
const first = itemsK.slice().sort(sel.ord)[0]
db = good(db, 'wati menyerahkan barang', 'serah', first.id, sel.siap(first), 'wati.wh')
ok(db.SR.at(-1).to === sel.RQ(first.req).by, 'serah terima menyimpan ID penerima')
db = good(db, 'wati mengingatkan barang siap', 'ingat', itemsK.find(i => makeSel(db).siap(i) > 0)?.id || first.id, 'wati.wh')

// Tutup sisa: pada konsolidasi yang belum datang penuh (KON-013 seed, sisa 5)
db = good(db, 'yani/dewi menutup sisa', 'tutup', 'KON-013', 'Supplier tidak sanggup', 'dewi.admin')
ok(makeSel(db).sisa(db.K.find(k => k.id === 'KON-013')) === 0, 'sisa menjadi 0 setelah ditutup')

/* ------------------------------------------------------- pengguna */
section('3. Pengguna')
db = good(db, 'admin menambah pengguna baru', 'saveUser', { mode: 'new', email: 'baru@x.com', n: 'Baru', rawWa: '081200000001', role: 'User', boss: 'budi.spv', me: dewi })
db = good(db, 'admin mengubah nama pengguna', 'saveUser', { mode: 'edit', id: 'baru@x.com', n: 'Baru Sekali', rawWa: '081200000001', role: 'User', boss: 'budi.spv', active: true, me: dewi })
db = good(db, 'admin menonaktifkan pengguna', 'saveUser', { mode: 'edit', id: 'baru@x.com', n: 'Baru Sekali', rawWa: '081200000001', role: 'User', boss: 'budi.spv', active: false, me: dewi })
badClient(db, 'nonaktif tidak bisa membuat request', 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 1, 2, addDays(T, 9))], me: db.U.find(u => u.id === 'baru@x.com') })
// Ganti nama TIDAK memutus riwayat karena log menyimpan ID
const before = makeSel(db)
db = good(db, 'ganti nama Wati', 'saveUser', { mode: 'edit', id: 'wati.wh', n: 'Wati H. Baru', rawWa: '6281234560011', role: 'Admin Warehouse', boss: '', active: true, me: db.U.find(u => u.id === 'wati.wh'), self: true })
const after = makeSel(db)
ok(after.nm('wati.wh') === 'Wati H. Baru' && db.KD.some(d => d.by === 'wati.wh'), 'riwayat tetap tertaut ke Wati setelah ganti nama')

/* ----------------------------------------------- 4. klien menolak aksi tak sah */
section('4. Klien menolak aksi tak sah')
const s0 = seed
const andi = s0.U.find(u => u.id === 'andi.prod')
badClient(s0, 'ajukan request yang bukan Draft', 'ajukan', 'RQ-001', 'andi.prod')
badClient(s0, 'setuju request yang sudah Disetujui', 'setuju', 'RQ-001', 'budi.spv')
badClient(s0, 'setuju request yang sudah Dibatalkan (tidak boleh hidup lagi)', 'setuju', 'RQ-011', 'budi.spv')
badClient(s0, 'setuju oleh bukan atasan langsung', 'setuju', 'RQ-008', 'tono.spv')
badClient(s0, 'tolak tanpa catatan', 'tolak', 'RQ-008', '', 'budi.spv')
badClient(s0, 'batal request orang lain', 'batal', 'RQ-009', 'siti.prod')
badClient(s0, 'batal request yang sudah Disetujui', 'batal', 'RQ-001', 'andi.prod')
badClient(s0, 'datang negatif', 'datang', { id: 'KON-011', q: -3, l: 0, cat: '', by: 'wati.wh' })
badClient(s0, 'datang qty negatif walau ada kelebihan positif', 'datang', { id: 'KON-011', q: -3, l: 5, cat: 'x', by: 'wati.wh' })
badClient(s0, 'datang melebihi sisa', 'datang', { id: 'KON-011', q: 999, l: 0, cat: '', by: 'wati.wh' })
badClient(s0, 'kelebihan tanpa catatan', 'datang', { id: 'KON-011', q: 1, l: 2, cat: '', by: 'wati.wh' })
badClient(s0, 'datang oleh bukan Admin Warehouse', 'datang', { id: 'KON-011', q: 1, l: 0, cat: '', by: 'dewi.admin' })
badClient(s0, 'tutup sisa yang sudah 0', 'tutup', 'KON-003', 'alasan', 'yani.admin')
badClient(s0, 'tutup konsolidasi departemen lain', 'tutup', 'KON-013', 'alasan', 'yani.admin')
badClient(s0, 'serah melebihi jatah', 'serah', 'ITM-015', 999, 'wati.wh')
badClient(s0, 'serah barang yang belum di ERO', 'serah', 'ITM-006', 1, 'wati.wh')
badClient(s0, 'tahan barang yang sudah di ERO', 'tahan', 'ITM-001', 'x', 'dewi.admin')
badClient(s0, 'tahan barang dept lain', 'tahan', 'ITM-006', 'x', 'yani.admin')
badClient(s0, 'ingat barang yang belum siap', 'ingat', 'ITM-017', 'wati.wh') // sudah diambil semua
badClient(s0, 'SRL dengan nomor ganda', 'simpanSrl', { no: 'srl-2611-001', est: '', me: s0.U.find(u => u.id === 'dewi.admin') })
badClient(s0, 'SRL oleh bukan Admin Dept', 'simpanSrl', { no: 'SRL-X', est: '', me: s0.U.find(u => u.id === 'wati.wh') })
badClient(s0, 'request: tgl datang kurang dari lead time', 'saveRequest', { status: 'Draft', lines: [kb('APD-007', 1, 1)], me: andi })
badClient(s0, 'request: qty nol', 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 0, 2, addDays(T, 9))], me: andi })
badClient(s0, 'request: non-buffer tanpa tgl pakai', 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 1, 2)], me: andi })
badClient(s0, 'request tanpa barang', 'saveRequest', { status: 'Draft', lines: [], me: andi })
badClient(s0, 'pengguna: atasan diri sendiri', 'saveUser', { mode: 'edit', id: 'budi.spv', n: 'Budi', rawWa: '081200000002', role: 'Atasan', boss: 'budi.spv', active: true, me: s0.U.find(u => u.id === 'dewi.admin') })
badClient(s0, 'pengguna: rantai atasan berputar', 'saveUser', { mode: 'edit', id: 'hendra.mgr', n: 'Hendra', rawWa: '081200000001', role: 'Atasan', boss: 'budi.spv', active: true, me: s0.U.find(u => u.id === 'dewi.admin') })
badClient(s0, 'pengguna: menonaktifkan atasan yang masih punya bawahan', 'saveUser', { mode: 'edit', id: 'budi.spv', n: 'Budi Hartono', rawWa: '081200000002', role: 'Atasan', boss: 'hendra.mgr', active: false, me: s0.U.find(u => u.id === 'dewi.admin') })
badClient(s0, 'pengguna: User tanpa atasan', 'saveUser', { mode: 'new', email: 'x@y.com', n: 'X', rawWa: '081200000009', role: 'User', boss: '', me: s0.U.find(u => u.id === 'dewi.admin') })
badClient(s0, 'pengguna: Admin Dept memberi role Spv Warehouse', 'saveUser', { mode: 'new', email: 'x@y.com', n: 'X', rawWa: '081200000009', role: 'Spv Warehouse', boss: '', me: s0.U.find(u => u.id === 'dewi.admin') })

// Draft tanpa atasan tidak boleh diajukan (nyangkut)
{
  let d = seed
  d = produce(d, x => { x.U.push({ id: 'nb@x.com', n: 'NoBoss', dept: 'Produksi', role: 'User', boss: '' }); x.HP['nb@x.com'] = '6281200000077' })
  const u = d.U.find(x => x.id === 'nb@x.com')
  badClient(d, 'ajukan langsung tanpa atasan', 'saveRequest', { status: 'Menunggu Approval', lines: [kb('KBL-005', 1, 2, addDays(T, 9))], me: u })
  const r = run(d, 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 1, 2, addDays(T, 9))], me: u })
  ok(!r.err, 'draft tanpa atasan boleh disimpan')
  badClient(r.db, 'mengajukan draft tanpa atasan', 'ajukan', r.db.R.at(-1).id, 'nb@x.com')
}
// ID dari nomor terbesar, bukan jumlah baris
{
  const d = produce(seed, x => { x.R = x.R.filter(r => r.id !== 'RQ-005'); x.I = x.I.filter(i => i.req !== 'RQ-005') })
  const r = run(d, 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 1, 2, addDays(T, 9))], me: andi })
  ok(r.db.R.at(-1).id === 'RQ-018', 'ID tidak bertabrakan walau ada nomor yang hilang', r.db.R.at(-1).id)
}
// SRL pertama pada tabel kosong
{
  const d = produce(seed, x => { x.K = []; x.I.forEach(i => { if (i.status === 'Sudah di ERO') { i.status = 'Approved'; i.kon = '' } }); x.KD = []; x.SR = []; x.L = []; x.RM = [] })
  const r = run(d, 'simpanSrl', { no: 'SRL-1', est: '', me: d.U.find(u => u.id === 'dewi.admin') })
  ok(!r.err && r.db.K[0].id === 'KON-001', 'SRL pertama pada tabel konsolidasi kosong', r.err)
}
// Tanggal tidak beku: today() mengikuti jam sistem
{
  const RealDate = Date
  globalThis.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super('2030-01-02T10:00:00'); } }
  ok(today() === '2030-01-02', 'today() mengikuti tanggal saat dipanggil', today())
  globalThis.Date = RealDate
}

/* ------------------------------------------------ 5. server menolak data rusak */
section('5. Server menolak pelanggaran relasi & aturan')
const S = seed
const row = (t, id, key = 'id') => ({ ...S[t].find(r => r[key] === id) })
const R1 = (t, r) => ({ t, op: 'add', row: r })
const SET = (t, r) => ({ t, op: 'set', row: r })

badServer(S, 'Item dengan request tidak ada', [R1('I', { ...row('I', 'ITM-010'), id: 'ITM-901', req: 'RQ-777' })])
badServer(S, 'Item dengan barang tidak ada', [R1('R', { id: 'RQ-018', by: 'andi.prod', tgl: T, st: 'Draft', cat: '' }), R1('I', { ...row('I', 'ITM-011'), id: 'ITM-044', req: 'RQ-018', kode: 'XXX-999', status: 'Draft' })])
badServer(S, 'Request dengan pembuat tidak ada', [R1('R', { id: 'RQ-018', by: 'hantu', tgl: T, st: 'Draft', cat: '' }), R1('I', { ...row('I', 'ITM-011'), id: 'ITM-044', req: 'RQ-018', status: 'Draft' })])
badServer(S, 'Request tanpa barang', [R1('R', { id: 'RQ-018', by: 'andi.prod', tgl: T, st: 'Draft', cat: '' })])
badServer(S, 'ID request ganda -> konflik', [R1('R', { ...row('R', 'RQ-009') })], { conflict: true })
badServer(S, 'set baris yang tidak ada -> konflik', [SET('R', { id: 'RQ-999', by: 'andi.prod', tgl: T, st: 'Draft', cat: '' })], { conflict: true })
badServer(S, 'Kedatangan ke konsolidasi tidak ada', [R1('KD', { kon: 'KON-999', qty: '1', lebih: '0', by: 'wati.wh', cat: '', tgl: T })])
badServer(S, 'Kedatangan melebihi sisa', [R1('KD', { kon: 'KON-011', qty: '99', lebih: '0', by: 'wati.wh', cat: '', tgl: T })], { conflict: true })
badServer(S, 'Kedatangan negatif', [R1('KD', { kon: 'KON-011', qty: '-1', lebih: '0', by: 'wati.wh', cat: '', tgl: T })])
badServer(S, 'Kedatangan oleh nama (bukan id)', [R1('KD', { kon: 'KON-011', qty: '1', lebih: '0', by: 'Wati Handayani', cat: '', tgl: T })])
badServer(S, 'Kedatangan oleh bukan Admin Warehouse', [R1('KD', { kon: 'KON-011', qty: '1', lebih: '0', by: 'dewi.admin', cat: '', tgl: T })])
badServer(S, 'Serah terima melebihi jatah', [R1('SR', { item: 'ITM-015', qty: '99', to: 'siti.prod', tgl: T })], { conflict: true })
badServer(S, 'Serah terima barang belum di ERO', [R1('SR', { item: 'ITM-006', qty: '1', to: 'rudi.prod', tgl: T })])
badServer(S, 'Serah terima ke orang yang bukan peminta', [R1('SR', { item: 'ITM-015', qty: '1', to: 'andi.prod', tgl: T })])
badServer(S, 'Serah terima barang tidak ada', [R1('SR', { item: 'ITM-999', qty: '1', to: 'andi.prod', tgl: T })])
badServer(S, 'Pengingat untuk barang tidak ada', [R1('RM', { item: 'ITM-999', by: 'wati.wh', at: T + 'T09:00' })])
badServer(S, 'Pengingat oleh nama', [R1('RM', { item: 'ITM-015', by: 'Wati Handayani', at: T + 'T09:00' })])
badServer(S, 'Konsolidasi ke SRL tidak ada', [SET('I', { ...row('I', 'ITM-006'), status: 'Sudah di ERO', kon: 'KON-900' }), R1('K', { id: 'KON-900', dept: 'Produksi', by: 'dewi.admin', kode: 'LAS-021', tahap: 'Sudah di ERO', srl: 'SRL-NONE', ero: '5', tutup: '0', alasan: '' })])
badServer(S, 'ERO tidak sama dengan total barang', [R1('L', { no: 'SRL-9', dept: 'Produksi', est: '' }), SET('I', { ...row('I', 'ITM-006'), status: 'Sudah di ERO', kon: 'KON-900' }), R1('K', { id: 'KON-900', dept: 'Produksi', by: 'dewi.admin', kode: 'LAS-021', tahap: 'Sudah di ERO', srl: 'SRL-9', ero: '50', tutup: '0', alasan: '' })])
badServer(S, 'Konsolidasi beda departemen dengan SRL', [R1('L', { no: 'SRL-9', dept: 'Maintenance', est: '' }), SET('I', { ...row('I', 'ITM-006'), status: 'Sudah di ERO', kon: 'KON-900' }), R1('K', { id: 'KON-900', dept: 'Produksi', by: 'dewi.admin', kode: 'LAS-021', tahap: 'Sudah di ERO', srl: 'SRL-9', ero: '5', tutup: '0', alasan: '' })])
badServer(S, 'Tutup melebihi sisa', [SET('K', { ...row('K', 'KON-013'), tutup: '99', alasan: 'x' })], { conflict: true })
badServer(S, 'Tutup tanpa alasan', [SET('K', { ...row('K', 'KON-013'), tutup: '5', alasan: '' })])
badServer(S, 'Tutup dikurangi', [SET('K', { ...row('K', 'KON-003'), tutup: '0' })])
badServer(S, 'Mengubah kode konsolidasi', [SET('K', { ...row('K', 'KON-013'), kode: 'KBL-005' })])
// Transisi status yang tidak sah (mis. layar basi): konflik
badServer(S, 'Setujui request yang sudah Dibatalkan', [SET('R', { ...row('R', 'RQ-011'), st: 'Disetujui' }), SET('I', { ...row('I', 'ITM-013'), status: 'Approved', appr: T + 'T08:00' })], { conflict: true })
badServer(S, 'Batalkan request yang sudah Disetujui', [SET('R', { ...row('R', 'RQ-001'), st: 'Dibatalkan' })], { conflict: true })
badServer(S, 'Ajukan request yang sudah Disetujui', [SET('R', { ...row('R', 'RQ-001'), st: 'Menunggu Approval' })], { conflict: true })
badServer(S, 'Barang Approved mundur ke Draft', [SET('I', { ...row('I', 'ITM-006'), status: 'Draft' })], { conflict: true })
badServer(S, 'Request Disetujui tapi barang masih menunggu', [SET('R', { ...row('R', 'RQ-008'), st: 'Disetujui' })])
badServer(S, 'Ubah qty barang', [SET('I', { ...row('I', 'ITM-006'), qty: '500' })])
badServer(S, 'Ubah pembuat request', [SET('R', { ...row('R', 'RQ-009'), by: 'siti.prod' })])
badServer(S, 'Tolak tanpa catatan', [SET('R', { ...row('R', 'RQ-008'), st: 'Ditolak' }), SET('I', { ...row('I', 'ITM-010'), status: 'Ditolak' })])
badServer(S, 'Tahan tanpa alasan', [SET('I', { ...row('I', 'ITM-006'), tahan: 'Y', alasan: '' })])
badServer(S, 'Ajukan oleh pembuat tanpa atasan', [R1('R', { id: 'RQ-018', by: 'hendra.mgr', tgl: T, st: 'Menunggu Approval', cat: '' }), R1('I', { ...row('I', 'ITM-010'), id: 'ITM-044', req: 'RQ-018', status: 'Menunggu Approval' })])
badServer(S, 'Barang non-buffer baru tanpa tgl pakai', [R1('R', { id: 'RQ-018', by: 'andi.prod', tgl: T, st: 'Draft', cat: '' }), R1('I', { ...row('I', 'ITM-011'), id: 'ITM-044', req: 'RQ-018', kode: 'KBL-005', status: 'Draft', pakai: '', datang: addDays(T, 5) })])
badServer(S, 'Tgl datang kurang dari lead time', [R1('R', { id: 'RQ-018', by: 'andi.prod', tgl: T, st: 'Draft', cat: '' }), R1('I', { ...row('I', 'ITM-011'), id: 'ITM-044', req: 'RQ-018', kode: 'APD-007', status: 'Draft', pakai: '', datang: addDays(T, 1) })])
badServer(S, 'Role pengguna tidak valid', [R1('U', { id: 'z@x.com', n: 'Z', dept: 'Produksi', role: 'Dewa', boss: 'budi.spv', hp: '6281200000001', off: '' })])
badServer(S, 'Atasan pengguna tidak ada', [R1('U', { id: 'z@x.com', n: 'Z', dept: 'Produksi', role: 'User', boss: 'hantu', hp: '6281200000001', off: '' })])
badServer(S, 'Atasan bukan berperan Atasan', [R1('U', { id: 'z@x.com', n: 'Z', dept: 'Produksi', role: 'User', boss: 'andi.prod', hp: '6281200000001', off: '' })])
badServer(S, 'Nomor WA tidak valid', [R1('U', { id: 'z@x.com', n: 'Z', dept: 'Produksi', role: 'User', boss: 'budi.spv', hp: '12345', off: '' })])
badServer(S, 'Rantai atasan berputar', [SET('U', { ...row('U', 'hendra.mgr'), boss: 'budi.spv', hp: '6281234560001', off: '' })])
badServer(S, 'Nonaktifkan atasan yang masih punya bawahan', [SET('U', { ...row('U', 'budi.spv'), hp: '6281234560002', off: 'Y' })])
badServer(S, 'SRL ganda -> konflik', [R1('L', { ...row('L', 'SRL-2611-001', 'no') })], { conflict: true })


// Pembagian jatah saat kebutuhan seri (pakai & waktu approve sama) harus sama di klien, server, dan urutan data apa pun
{
  // KON-013: ITM-026 (4) dan ITM-027 (5) seri; datang 4 => jatah hanya untuk id yang lebih kecil
  const rev = produce(seed, d => { d.I.reverse() })
  for (const [nama, base] of [['urutan asli', seed], ['urutan dibalik', rev]]) {
    const sl = makeSel(base)
    ok(sl.berhak(base.I.find(i => i.id === 'ITM-026')) === 4 && sl.berhak(base.I.find(i => i.id === 'ITM-027')) === 0,
      'jatah seri dibagi menurut id (' + nama + ')')
    const a = run(base, 'serah', 'ITM-026', 4, 'wati.wh')
    ok(!a.err && !serverApply(base, a.ops).err, 'serah 4 ke ITM-026 diterima klien & server (' + nama + ')', a.err || serverApply(base, a.ops).err)
    const b = run(base, 'serah', 'ITM-027', 1, 'wati.wh')
    ok(!!b.err, 'serah ke ITM-027 (jatah 0) ditolak klien (' + nama + ')')
    badServer(base, 'serah ITM-027 (jatah 0) ditolak server (' + nama + ')', [R1('SR', { item: 'ITM-027', qty: '1', to: 'andi.prod', tgl: T })], { conflict: true })
  }
}

// Stale: dua klien. A membatalkan, B (layar basi) menyetujui.
{
  const afterA = run(seed, 'batal', 'RQ-008', 'siti.prod').db           // kondisi server setelah A
  const staleB = run(seed, 'setuju', 'RQ-008', 'budi.spv')              // B masih melihat Menunggu Approval
  const s = serverApply(null, staleB.ops, toServer(afterA))
  ok(!!s.err && s.conflict, 'dua klien: setuju atas request yang baru dibatalkan ditolak sebagai konflik', s.err)
}
// Dua klien membuat RQ nomor sama
{
  const a = run(seed, 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 1, 2, addDays(T, 9))], me: andi })
  const b = run(seed, 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 2, 2, addDays(T, 9))], me: seed.U.find(u => u.id === 'siti.prod') })
  const s = serverApply(null, b.ops, toServer(a.db))
  ok(!!s.err && s.conflict, 'dua klien membuat nomor request sama: yang kedua ditolak sebagai konflik', s.err)
}

// Kompatibel dengan sheet lama (log berisi nama): menutup sisa tetap jalan sebelum migrasi dijalankan
{
  const legacy = jsonClone(toServer(seed))
  legacy.K.forEach(k => (k.by = seed.U.find(u => u.id === k.by).n))
  const r = run(seed, 'tutup', 'KON-013', 'Supplier tidak sanggup', 'dewi.admin')
  const oldRow = legacy.K.find(k => k.id === 'KON-013')
  const op = { t: 'K', op: 'set', row: { ...r.ops[0].row, by: oldRow.by } } // klien lama memegang baris dengan by=nama
  const s = serverApply(null, [op], legacy)
  ok(!s.err, 'sheet lama (by=nama): tutup sisa tetap diterima sebelum migrasi', s.err)
}

/* -------------------------------------------------- 6. audit mendeteksi data rusak */
section('6. Audit mendeteksi data yang dirusak manual')
{
  const mutateAndAudit = (label, fn, expectMatch) => {
    const tb = jsonClone(toServer(seed)); fn(tb)
    const errs = gs.auditAll_(tb)
    ok(errs.some(e => e.includes(expectMatch)), label, JSON.stringify(errs.slice(0, 3)))
  }
  mutateAndAudit('item yatim (request dihapus)', tb => { tb.R = tb.R.filter(r => r.id !== 'RQ-006') }, 'request "RQ-006" tidak ada')
  mutateAndAudit('kode barang salah', tb => { tb.I.find(i => i.id === 'ITM-006').kode = 'ZZZ' }, 'tidak ada di Master')
  mutateAndAudit('qty ERO tidak sama', tb => { tb.K.find(k => k.id === 'KON-013').ero = '99' }, 'tidak sama dengan total')
  mutateAndAudit('diambil melebihi jatah', tb => { tb.SR.push({ item: 'ITM-015', qty: '50', to: 'siti.prod', tgl: T }) }, 'melebihi jatah')
  mutateAndAudit('log berisi nama (data lama)', tb => { tb.KD[0].by = 'Wati Handayani' }, 'bukan id pengguna')
  mutateAndAudit('kunci ganda', tb => { tb.U.push({ ...tb.U[0] }) }, 'ganda')
}

/* -------------------------------------------------- 7. migrasi data lama */
section('7. Migrasi nama -> ID (migrasiRelasi)')
{
  // Simulasikan sheet berisi data format lama, jalankan migrasiRelasi() dengan SpreadsheetApp tiruan
  const legacy = jsonClone(toServer(seed))
  const nm = id => seed.U.find(u => u.id === id).n
  legacy.K.forEach(k => (k.by = nm(k.by)))
  legacy.KD.forEach(d => (d.by = nm(d.by)))
  legacy.RM.forEach(r => (r.by = nm(r.by)))
  legacy.SR.forEach(s => (s.to = nm(s.to)))
  ok(gs.auditAll_(jsonClone(legacy)).length > 0, 'data format lama terdeteksi audit')

  const sheets = {}
  TABLES.forEach(t => {
    sheets[t] = { header: cols(t), rows: legacy[t].map(r => cols(t).map(c => r[c])) }
  })
  const mkSheet = t => ({
    getLastRow: () => sheets[t].rows.length + 1,
    getMaxRows: () => 5000,
    getMaxColumns: () => 20,
    insertRowsAfter() {},
    getRange: (r, c, n, w) => ({
      getValues: () => sheets[t].rows.slice(r - 2, r - 2 + n).map(x => x.slice(0, w)),
      clearContent: () => { sheets[t].rows = [] },
      setNumberFormat() { return this },
      setValues: vals => { sheets[t].rows = vals },
    }),
  })
  const byName = Object.fromEntries(TABLES.map(t => [gs.SCHEMA[t].sheet, t]))
  const props = {}
  Object.assign(gs, {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperties: o => Object.assign(props, o) }) },
    SpreadsheetApp: { flush() {}, getActiveSpreadsheet: () => ({ getSheetByName: n => mkSheet(byName[n]) }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    Utilities: { formatDate: () => '' },
  })
  const msg = gs.migrasiRelasi()
  ok(/Diperbarui/.test(msg), 'migrasiRelasi memperbarui data', msg)
  const migrated = Object.fromEntries(TABLES.map(t => [t, sheets[t].rows.map(r => Object.fromEntries(cols(t).map((c, i) => [c, r[i]])))]))
  const errs = gs.auditAll_(jsonClone(migrated))
  ok(errs.length === 0, 'audit bersih setelah migrasi', errs.slice(0, 3).join(' | '))
  ok(canonDb(migrated) === canonDb(toServer(seed)), 'hasil migrasi identik dengan data berbasis ID')
  ok(/Tidak ada yang perlu/.test(gs.migrasiRelasi()), 'migrasi aman dijalankan berulang')
}


/* -------------------------------------------------- 8. login & sesi */
section('8. Login, sesi, dan identitas pelaku')
{
  // Spreadsheet, cache, dan layanan Apps Script tiruan (kripto asli dari Node)
  const sheets = {}
  const tb0 = jsonClone(toServer(seed))
  TABLES.forEach(t => { sheets[t] = { rows: tb0[t].map(r => cols(t).map(c => r[c] ?? '')) } })
  const mkSheet = t => ({
    getLastRow: () => sheets[t].rows.length + 1, getMaxRows: () => 5000, getMaxColumns: () => 20, insertRowsAfter() {},
    getRange: (r, c, n, w) => ({
      getValues: () => sheets[t].rows.slice(r - 2, r - 2 + n).map(x => x.slice(0, w)),
      clearContent: () => { sheets[t].rows = [] }, setNumberFormat() { return this },
      setValues: vals => { sheets[t].rows = vals },
    }),
  })
  const byName = Object.fromEntries(TABLES.map(t => [gs.SCHEMA[t].sheet, t]))
  const props = {}, cache = new Map()
  const signed = buf => [...buf].map(b => (b > 127 ? b - 256 : b))
  Object.assign(gs, {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v }, setProperties: o => Object.assign(props, o) }) },
    SpreadsheetApp: { flush() {}, getActiveSpreadsheet: () => ({ getSheetByName: n => mkSheet(byName[n]) }) },
    CacheService: { getScriptCache: () => ({
      get: k => cache.get(k) ?? null, put: (k, v) => { cache.set(k, v) }, remove: k => { cache.delete(k) },
      getAll: ks => Object.fromEntries(ks.filter(k => cache.has(k)).map(k => [k, cache.get(k)])),
      putAll: o => Object.entries(o).forEach(([k, v]) => cache.set(k, v)),
    }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: x => ({ x, setMimeType() { return this } }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, str) => signed(nodeCrypto.createHash('sha256').update(str).digest()),
      computeHmacSha256Signature: (v, key) => signed(nodeCrypto.createHmac('sha256', key).update(v).digest()),
      getUuid: () => nodeCrypto.randomUUID(),
      base64EncodeWebSafe: str => Buffer.from(str).toString('base64url'),
      base64DecodeWebSafe: str => signed(Buffer.from(str, 'base64url')),
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes.map(b => (b < 0 ? b + 256 : b))).toString() }),
      formatDate: () => '',
    },
    Logger: { log() {} },
  })
  const call = (fn, params, body, token) => JSON.parse(gs.run_(fn, params || {}, body || null, token).x)
  const throws = fn => { try { fn(); return '' } catch (e) { return e.message } }

  ok(/13 pengguna/.test(gs.aturPasswordSemua('rahasia1')), 'password awal diberikan ke semua pengguna')
  ok(gs.aturPasswordSemua('lain1234').startsWith('0 pengguna'), 'password awal tidak menimpa yang sudah ada')
  const stored = sheets.U.rows.find(r => r[0] === 'andi.prod')[cols('U').indexOf('pw')]
  ok(/^h1\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(stored) && !stored.includes('rahasia1'), 'password disimpan sebagai hash bergaram, bukan teks', stored)
  const pws = sheets.U.rows.map(r => r[cols('U').indexOf('pw')])
  ok(new Set(pws).size === pws.length, 'garam berbeda per pengguna (hash tidak sama walau password sama)')

  ok(/salah/.test(throws(() => gs.login_('andi.prod', 'keliru'))), 'password salah ditolak')
  ok(/salah/.test(throws(() => gs.login_('tidak.ada', 'rahasia1'))), 'username tak dikenal ditolak dengan pesan yang sama')
  ok(/Isi username/.test(throws(() => gs.login_('andi.prod', ''))), 'password kosong ditolak')
  const lg = gs.login_('  Andi.Prod ', 'rahasia1')
  ok(lg.ok && lg.uid === 'andi.prod' && lg.token.includes('.'), 'login benar (huruf besar/spasi diabaikan)')
  ok(gs.checkToken_(lg.token) === 'andi.prod', 'token sah dikenali')

  // Penguncian setelah 5 gagal
  for (let i = 0; i < 5; i++) throws(() => gs.login_('siti.prod', 'salah' + i))
  ok(/Terlalu banyak/.test(throws(() => gs.login_('siti.prod', 'rahasia1'))), 'akun terkunci sementara setelah 5 kali gagal (walau password benar)')
  ok(gs.login_('rudi.prod', 'rahasia1').ok, 'penguncian hanya berlaku untuk akun yang gagal')

  // Token
  const [pl, sig] = lg.token.split('.')
  ok(gs.checkToken_(pl + '.' + '0'.repeat(64)) === null, 'tanda tangan palsu ditolak')
  const forged = Buffer.from('budi.spv|' + (Date.now() + 1e9)).toString('base64url') + '.' + sig
  ok(gs.checkToken_(forged) === null, 'token yang isinya diganti (pindah ke akun lain) ditolak')
  const oldPl = 'andi.prod|' + (Date.now() - 1000)
  ok(gs.checkToken_(Buffer.from(oldPl).toString('base64url') + '.' + gs.sign_(oldPl)) === null, 'token kedaluwarsa ditolak')
  ok(gs.checkToken_('') === null && gs.checkToken_(undefined) === null && gs.checkToken_('sampah') === null, 'token kosong/rusak ditolak')

  // Akses data
  ok(call('all').auth === true, 'data tidak bisa diambil tanpa login')
  ok(call('all', {}, null, 'x.y').auth === true, 'data tidak bisa diambil dengan token palsu')
  ok(call('mutate', {}, { ops: [] }).auth === true, 'tulis tidak bisa tanpa login')
  ok(call('ver').ok === true, 'nomor versi tetap terbuka (tanpa data)')
  const all = call('all', {}, null, lg.token)
  ok(all.ok && all.db.U.length === 13, 'data bisa diambil dengan token sah')
  ok(!JSON.stringify(all).includes('h1$') && all.db.U.every(u => !('pw' in u)), 'hash password TIDAK ikut terkirim ke aplikasi')
  const lg2 = call('login', {}, { u: 'andi.prod', p: 'rahasia1' })
  ok(lg2.ok && lg2.token, 'login lewat endpoint berhasil')
  ok(call('login', {}, { u: 'andi.prod', p: 'x' }).ok === false, 'login salah lewat endpoint gagal tanpa token')

  // Pengguna dinonaktifkan: token lamanya langsung tidak berlaku
  const offIdx = cols('U').indexOf('off')
  sheets.U.rows.find(r => r[0] === 'andi.prod')[offIdx] = 'Y'; gs.bump_(['U'])
  ok(gs.checkToken_(lg.token) === null, 'token pengguna yang dinonaktifkan langsung tidak berlaku')
  ok(/salah/.test(throws(() => gs.login_('andi.prod', 'rahasia1'))), 'pengguna nonaktif tidak bisa login')
  sheets.U.rows.find(r => r[0] === 'andi.prod')[offIdx] = ''; gs.bump_(['U'])

  // Ganti password
  ok(/lama salah/.test(throws(() => gs.chpw_('andi.prod', 'keliru', 'baru1234'))), 'ganti password: password lama salah ditolak')
  ok(/minimal/.test(throws(() => gs.chpw_('andi.prod', 'rahasia1', '123'))), 'ganti password: terlalu pendek ditolak')
  ok(call('chpw', {}, { o: 'rahasia1', n: 'baru1234' }, lg.token).ok, 'ganti password lewat endpoint berhasil')
  ok(/salah/.test(throws(() => gs.login_('andi.prod', 'rahasia1'))), 'password lama tidak berlaku lagi')
  ok(gs.login_('andi.prod', 'baru1234').ok, 'password baru berlaku')
  ok(call('chpw', {}, { o: 'x', n: 'baru5678' }).auth === true, 'ganti password butuh login')
  gs.resetSesi()
  ok(gs.checkToken_(lg.token) === null, 'resetSesi membatalkan semua sesi')

  // Hash tidak bisa dibaca/ditimpa lewat operasi tulis dari klien
  const pre = jsonClone(toServer(seed)); pre.U.forEach(u => (u.pw = 'h1$abc$' + u.id))
  const upd = { t: 'U', op: 'set', row: { ...pre.U[0], n: 'Nama Baru', pw: 'DIBAJAK' } }
  const plan = gs.planOps_(jsonClone(pre), [upd])
  ok(plan.post.U[0].n === 'Nama Baru' && plan.post.U[0].pw === 'h1$abc$' + pre.U[0].id, 'mengubah pengguna dari klien tidak menyentuh/menimpa hash password')
  const plan2 = gs.planOps_(jsonClone(pre), [{ t: 'U', op: 'add', row: { id: 'z@x.com', n: 'Z', dept: 'Produksi', role: 'User', boss: 'budi.spv', hp: '6281200000001', off: '', pw: 'DIBAJAK' } }])
  ok(plan2.post.U.at(-1).pw === '', 'pengguna baru dari klien tidak bisa menyelundupkan hash password')

  // Identitas pelaku ditegakkan di server
  const ids = (db, name, ...args) => run(db, name, ...args).ops
  const mk = (uid, label, ops, want) => {
    const r = serverApply(seed, ops, null, uid)
    ok(want ? !r.err : !!r.err, label + (want ? ' [diterima]' : ' [ditolak]'), r.err)
  }
  const opsNew = ids(seed, 'saveRequest', { status: 'Draft', lines: [kb('KBL-005', 1, 2, addDays(T, 9))], me: andi })
  mk('andi.prod', 'request atas nama sendiri', opsNew, true)
  mk('siti.prod', 'request atas nama orang lain', opsNew, false)
  const opsSetuju = ids(seed, 'setuju', 'RQ-008', 'budi.spv')
  mk('budi.spv', 'setuju oleh atasan langsung', opsSetuju, true)
  mk('tono.spv', 'setuju oleh atasan lain', opsSetuju, false)
  mk('andi.prod', 'setuju oleh rekan sekerja', opsSetuju, false)
  const opsBatal = ids(seed, 'batal', 'RQ-008', 'siti.prod')
  mk('siti.prod', 'batal oleh pembuat', opsBatal, true)
  mk('budi.spv', 'batal oleh atasan (bukan pembuat)', opsBatal, false)
  const opsDtg = ids(seed, 'datang', { id: 'KON-011', q: 1, l: 0, cat: '', by: 'wati.wh' })
  mk('wati.wh', 'kedatangan atas nama sendiri', opsDtg, true)
  mk('joko.wh', 'kedatangan atas nama rekan', opsDtg, false)
  const opsIng = ids(seed, 'ingat', 'ITM-015', 'wati.wh')
  mk('wati.wh', 'pengingat atas nama sendiri', opsIng, true)
  mk('joko.wh', 'pengingat atas nama rekan', opsIng, false)
}

console.log(`\n${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
