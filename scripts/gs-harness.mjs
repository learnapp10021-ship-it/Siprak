// Uji backend Apps Script tanpa Google: semua file .gs dijalankan di VM dengan SpreadsheetApp/Cache/Lock palsu,
// lalu alur nyata aplikasi (actions + diffDb) dikirim ke mutate_ dan hasilnya dibandingkan dengan db klien.
//   npm run test:gs
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { produce } from 'immer'

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log('  GAGAL:', m) } else console.log('  ok   ', m) }

/* ------------------------------------------------------------ Google API palsu */
function newEnv(order) {
  const sheets = {}
  const mkSheet = name => {
    const d = [[]]
    const sh = {
      name, d, frozen: 0,
      getMaxColumns: () => Math.max(26, ...d.map(r => r.length)),
      insertColumnsAfter() {},
      getMaxRows: () => Math.max(1000, d.length),
      insertRowsAfter() {},
      getLastRow: () => { let l = 0; d.forEach((r, i) => { if (r.some(v => v !== '' && v != null)) l = i + 1 }); return l },
      setFrozenRows() {},
      getRange(r, c, nr = 1, nc = 1) {
        const rg = {
          setNumberFormat: () => rg, setFontWeight: () => rg, setBackground: () => rg,
          setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (d[r - 1 + i] = d[r - 1 + i] || [])[c - 1 + j] = x })); return rg },
          getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(d[r - 1 + i]?.[c - 1 + j] ?? ''); o.push(row) } return o },
          clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (d[r - 1 + i]) d[r - 1 + i][c - 1 + j] = '' ; return rg },
        }
        return rg
      },
    }
    return sh
  }
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = mkSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet() {},
  }
  const props = {}, cache = {}
  const ctx = vm.createContext({
    console, Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperties: o => Object.assign(props, o) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, getAll: ks => Object.fromEntries(ks.map(k => [k, cache[k]]).filter(([, v]) => v != null)), putAll: o => Object.assign(cache, o) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this } }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
  })
  const files = fs.readdirSync('apps-script').filter(f => f.endsWith('.gs')).sort()
  if (order == 'reverse') files.reverse()
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join('apps-script', f), 'utf8'), ctx, { filename: f }))
  const call = (fn, params = {}, body = null) => JSON.parse(ctx.run_(fn, params, body).text)
  return { ctx, call, sheets, run: code => vm.runInContext(code, ctx) }
}

/* ------------------------------------------------------------ 1. Pemuatan & seed */
console.log('1. File .gs dimuat tanpa bergantung urutan, seed lolos validasi')
for (const order of ['abjad', 'reverse']) {
  const e = newEnv(order)
  e.run('setup()')
  e.run('seedDemo()')
  ok(e.run('audit()').startsWith('Database bersih'), `urutan ${order}: audit setelah seedDemo bersih`)
}

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { buildSeed } = await vite.ssrLoadModule('/src/data/seed.js')
const { actions } = await vite.ssrLoadModule('/src/lib/actions.js')
const { makeSel } = await vite.ssrLoadModule('/src/lib/selectors.js')
const { diffDb } = await vite.ssrLoadModule('/src/lib/diff.js')
const { TODAY, addDays } = await vite.ssrLoadModule('/src/lib/utils.js')

const env = newEnv()
env.run('setup()'); env.run('seedDemo()')
ok(JSON.stringify(env.run('SEED_DB')) == JSON.stringify(buildSeed()), 'Seed.gs sama dengan src/data/seed.js (jalankan npm run gen:seed bila gagal)')

/* ------------------------------------------------------------ 2. Alur nyata aplikasi -> server */
console.log('2. Alur nyata aplikasi (actions + diffDb) diterima server')
let db = buildSeed()
const user = id => db.U.find(u => u.id == id)
const step = (title, name, ...args) => {
  let res
  const next = produce(db, d => { res = actions[name](makeSel(d), d, ...args) })
  if (res?.err) { ok(false, `${title}: aksi ditolak klien: ${res.err}`); return null }
  const ops = diffDb(db, next)
  const r = env.call('mutate', {}, { fn: 'mutate', ops })
  ok(r.ok, `${title} (${ops.length} op)${r.ok ? '' : ' -> ' + r.err}`)
  if (r.ok) db = next
  return res
}
const d4 = addDays(TODAY, 4), d9 = addDays(TODAY, 9)
const L = (kode, qty) => ({ kode, qty, datang: d4, pakai: d9 })
step('andi ajukan request 2 baris', 'saveRequest', { status: 'Menunggu Approval', lines: [L('SRG-001', '5'), L('LAS-021', '3')], me: user('andi.prod') })
const rq = db.R[db.R.length - 1].id
step('atasan setujui', 'setuju', rq)
step('admin dept buat SRL', 'simpanSrl', { no: 'SRL-2612-010', est: addDays(TODAY, 20), me: user('dewi.admin') })
const baru = db.I.filter(i => i.status == 'Validasi Warehouse').map(i => i.id)
ok(baru.length >= 2, `${baru.length} barang menunggu validasi`)
step('warehouse keluarkan 1 baris', 'keluarkan', { ids: [baru[0]], alasan: 'salah artikel', by: 'Wati Handayani' })
step('warehouse validasi SRL', 'validasiSrl', 'SRL-2612-010')
const kon = db.K[db.K.length - 1].id
step('datang sebagian', 'datang', { id: db.K.find(k => k.srl == 'SRL-2612-010' && k.tahap == 'Sudah di ERO').id, q: 2, l: 1, cat: 'lebih 1', by: 'wati.wh' })
step('datang semua (SRL-2611-003)', 'datangAll', 'SRL-2611-003', 'joko.wh')
const siap = db.I.filter(i => i.status == 'Sudah di ERO' && makeSel(db).siap(i) > 0)
step('serah 1 barang', 'serah', siap[0].id, makeSel(db).siap(siap[0]))
step('serahkan semua per penerima', 'serahAll', siap.slice(1, 4).map(i => i.id))
step('ingatkan', 'ingat', siap[0].id, 'wati.wh')
const kd = db.K.find(k => k.tahap == 'Sudah di ERO' && makeSel(db).sisa(k) > 0)
if (kd) step('tutup sisa', 'tutup', kd.id, 'stok cukup')
step('master: tambah item', 'saveMaster', { mode: 'new', f: { k: 'orx-001', n: 'Item ORI', sat: 'Pcs', buf: '1', kons: '0', lead: '5' } })
step('master: ubah item', 'saveMaster', { mode: 'edit', f: { k: 'ORX-001', n: 'Item ORI 2', sat: 'Box', buf: '0', kons: '1', lead: '2' } })
step('master: impor', 'importMaster', [{ k: 'ORX-002', n: 'Impor A', sat: 'Pcs', buf: '0', kons: '0', lead: '3', err: '' }, { k: 'ORX-001', n: 'Impor B', sat: 'Pcs', buf: '1', kons: '1', lead: '7', err: '' }])

const snap = env.call('all')
const proj = (t, rows) => rows.map(r => env.ctx.SCHEMA[t].cols.map(c => String(r[c] ?? '')).join('|'))
let same = true
for (const t of ['M', 'R', 'I', 'K', 'L', 'KD', 'SR', 'RM']) {
  const a = proj(t, db[t]).join('\n'), b = proj(t, snap.db[t]).join('\n')
  if (a !== b) { same = false; console.log('  beda di tabel', t) }
}
ok(same, 'isi sheet = db klien untuk semua tabel setelah seluruh alur')
ok(env.run('audit()').startsWith('Database bersih'), 'audit() bersih setelah seluruh alur')

/* ------------------------------------------------------------ 3. Pelanggaran harus ditolak */
console.log('3. Pelanggaran relasi/aturan ditolak, data tidak berubah')
const before = JSON.stringify(env.call('all').db)
const bad = (title, ops, conflict) => {
  const r = env.call('mutate', {}, { fn: 'mutate', ops })
  ok(!r.ok && (conflict === undefined || !!r.conflict == conflict), `${title} -> ${r.err}`)
}
const base = db
const it = base.I.find(i => i.status == 'Sudah di ERO')
const k0 = base.K.find(k => k.id == it.kon)
bad('Item.kode tidak ada di Master', [{ t: 'I', op: 'set', row: { ...it, kode: 'XXX-999' } }])
bad('Item.req tidak ada di Request', [{ t: 'I', op: 'set', row: { ...it, req: 'RQ-999' } }])
bad('status di luar daftar', [{ t: 'I', op: 'set', row: { ...it, status: 'Selesai' } }])
bad('Sudah di ERO tanpa kon', [{ t: 'I', op: 'set', row: { ...it, kon: '' } }])
bad('kode beda dengan Konsolidasi', [{ t: 'I', op: 'set', row: { ...it, kode: base.M.find(m => m.k != it.kode).k } }])
bad('Konsolidasi.by berisi nama, bukan id', [{ t: 'K', op: 'set', row: { ...k0, by: 'Dewi Lestari' } }])
bad('Konsolidasi.srl tidak ada', [{ t: 'K', op: 'set', row: { ...k0, srl: 'SRL-0000' } }])
bad('departemen K beda dengan SRL', [{ t: 'K', op: 'set', row: { ...k0, dept: 'Maintenance' } }])
bad('tahap K beda dengan status barang', [{ t: 'K', op: 'set', row: { ...k0, tahap: 'Validasi Warehouse' } }])
bad('kedatangan melebihi total', [{ t: 'KD', op: 'add', row: { kon: k0.id, qty: '99999', lebih: '0', by: 'wati.wh', cat: '', tgl: TODAY } }], true)
bad('serah terima melebihi yang datang', [{ t: 'SR', op: 'add', row: { item: it.id, qty: '99999', to: 'andi.prod', tgl: TODAY } }], true)
bad('penerima bukan pengguna', [{ t: 'SR', op: 'add', row: { item: it.id, qty: '1', to: 'Andi Saputra', tgl: TODAY } }])
bad('request tanpa pemohon valid', [{ t: 'R', op: 'add', row: { id: 'RQ-998', by: 'hantu', tgl: TODAY, st: 'Draft', cat: '' } }])
bad('format ID salah', [{ t: 'R', op: 'add', row: { id: 'REQ-1', by: 'andi.prod', tgl: TODAY, st: 'Draft', cat: '' } }])
bad('tanggal salah format', [{ t: 'R', op: 'add', row: { id: 'RQ-998', by: 'andi.prod', tgl: '12/11/2026', st: 'Draft', cat: '' } }])
bad('qty nol', [{ t: 'I', op: 'set', row: { ...it, qty: '0' } }])
bad('master: lead bukan angka', [{ t: 'M', op: 'add', row: { k: 'BAD-1', n: 'x', sat: 'Pcs', buf: '0', kons: '0', lead: 'abc' } }])
bad('master: kode ganda', [{ t: 'M', op: 'add', row: { ...base.M[0] } }], true)
bad('atasan bukan role Atasan', [{ t: 'U', op: 'set', row: { id: 'andi.prod', n: 'Andi Saputra', dept: 'Produksi', role: 'User', boss: 'siti.prod', hp: '', off: '' } }])
bad('batch: satu salah membatalkan semua', [
  { t: 'M', op: 'add', row: { k: 'OK-1', n: 'Valid', sat: 'Pcs', buf: '0', kons: '0', lead: '1' } },
  { t: 'M', op: 'add', row: { k: 'BAD-2', n: '', sat: 'Pcs', buf: '0', kons: '0', lead: '1' } },
])
ok(JSON.stringify(env.call('all').db) === before, 'tidak ada data yang berubah setelah semua penolakan')

/* ------------------------------------------------------------ 4. Migrasi dari format lama (nama -> id) */
console.log('4. migrate(): kolom pengguna berisi nama diubah menjadi id')
const old = newEnv()
old.run('setup()')
const legacy = JSON.parse(JSON.stringify(buildSeed()))
const nm = id => legacy.U.find(u => u.id == id).n
legacy.K.forEach(k => (k.by = nm(k.by)))
legacy.KD.forEach(x => (x.by = nm(x.by)))
legacy.SR.forEach(x => (x.to = nm(x.to)))
legacy.RM.forEach(x => (x.by = nm(x.by)))
// tulis langsung ke sheet (writeAll_ akan menolak data lama)
old.ctx.__legacy = legacy
old.run(`(function(){ var raw = fromClient_(__legacy), ss = ss_(); TABLES.forEach(function(t){ var S=SCHEMA[t], sh=sheet_(ss,t), rows=raw[t]||[]; if(rows.length) sh.getRange(2,1,rows.length,S.cols.length).setValues(rows.map(function(r){return S.cols.map(function(c){return cell_(r[c])})})) }); bump_(TABLES) })()`)
ok(old.run('audit()').includes('pelanggaran'), 'audit mendeteksi data format lama')
const mig = old.run('migrate()')
console.log('  ', mig.split('\n')[0])
const au = old.run('audit()'); if (!au.startsWith('Database bersih')) console.log(au.split('\n').slice(0, 8).join('\n'))
ok(au.startsWith('Database bersih'), 'audit bersih setelah migrate()')
ok(old.run('migrate()').startsWith('0 sel'), 'migrate() aman diulang')

await vite.close()
console.log(fail ? `\n${fail} pemeriksaan GAGAL` : '\nSemua pemeriksaan lolos')
process.exit(fail ? 1 : 0)
