// Uji relasi database dan validasi server:
//   A. Seed dan alur nyata (request sampai serah terima) menghasilkan database yang bersih dan kolom pengguna berisi ID
//   B. Data rusak (diedit manual di sheet) terdeteksi auditData() dan aksi yang menyentuhnya ditolak dengan pesan jelas
//   C. migrate() mengubah nama -> ID pada data format lama, aman diulang
//   node backend/test/relasi.mjs
import { createBackend } from './mock-gas.mjs'
const { env, ctx, $ } = createBackend(process.env.CODE || undefined)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  GAGAL:', m) } }
const sec = t => console.log('\n# ' + t)
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent())
const get = p => JSON.parse(ctx.doGet({ parameter: p }).getContent())
const sheet = n => env.sheets.get(n)
const col = (n, c) => sheet(n).cells[0].indexOf(c)
const rows = n => {
  const sh = sheet(n), h = sh.cells[0]
  return sh.cells.slice(1).filter(r => r && r[0] !== '' && r[0] !== undefined).map(r => Object.fromEntries(h.map((x, i) => [x, r[i] === undefined ? '' : r[i]])))
}
const live = n => sheet(n).cells.map((r, i) => i).filter(i => i > 0 && sheet(n).cells[i] && sheet(n).cells[i][0] !== '' && sheet(n).cells[i][0] !== undefined)
const keyC = n => col(n, { Users: 'id', Master: 'k', Request: 'id', Item: 'id', Konsolidasi: 'id', SRL: 'no', Kedatangan: 'id', SerahTerima: 'id', Pengingat: 'id' }[n])
const rowIdx = (n, key) => live(n).find(i => String(sheet(n).cells[i][keyC(n)]) === key)
const setCell = (n, key, c, v) => { sheet(n).cells[rowIdx(n, key)][col(n, c)] = v; env.cache.clear() }
const setBy = (n, k, c, v) => { sheet(n).cells[live(n)[k]][col(n, c)] = v; env.cache.clear() }  // k = urutan di rows(n)
let txN = 0
const TX = () => 'TX-R' + String(++txN).padStart(6, '0') + '-' + Math.random().toString(36).slice(2, 8)
const act = (me, name, ...args) => post({ tx: TX(), name, me, args })
const TODAY = $('TODAY')
const addDays = (d, n) => $(`addDays('${d}', ${n})`)

ctx.setup(); ctx.seedDemo(); get({ action: 'sync' })

sec('A. Seed + alur nyata lewat server')
ok(ctx.auditData().startsWith('OK'), 'seed bersih: ' + ctx.auditData())
ok(rows('Konsolidasi').every(k => /^[a-z]+\.[a-z]+$/.test(k.by)), 'Konsolidasi.by berisi ID pengguna')
ok(rows('Kedatangan').every(k => /^[a-z]+\.[a-z]+$/.test(k.by)), 'Kedatangan.by berisi ID pengguna')
ok(rows('SerahTerima').every(k => /^[a-z]+\.[a-z]+$/.test(k.to)), 'SerahTerima.to berisi ID pengguna')

const L = { kode: 'SRG-001', qty: '5', datang: addDays(TODAY, 10), pakai: addDays(TODAY, 14) }
let r = act('andi.prod', 'saveRequest', { status: 'Menunggu Approval', lines: [L, { ...L, kode: 'LAS-021', qty: '3' }] })
ok(r.ok, 'andi membuat request: ' + r.err)
const rq = rows('Request').slice(-1)[0].id
ok((r = act('budi.spv', 'setuju', rq)).ok, 'atasan menyetujui: ' + r.err)
ok((r = act('dewi.admin', 'simpanSrl', { no: 'SRL-2612-001', est: addDays(TODAY, 20) })).ok, 'Admin Dept membuat SRL: ' + r.err)
const kBaru = rows('Konsolidasi').filter(k => k.srl === 'SRL-2612-001')
ok(kBaru.length >= 1 && kBaru.every(k => k.by === 'dewi.admin' && k.tahap === 'Validasi Warehouse'), 'K baru: by = dewi.admin, tahap Validasi Warehouse')
ok((r = act('wati.wh', 'validasiSrl', 'SRL-2612-001')).ok, 'Warehouse memvalidasi: ' + r.err)
ok((r = act('wati.wh', 'datangAll', 'SRL-2612-001')).ok, 'Warehouse mencatat kedatangan: ' + r.err)
ok(rows('Kedatangan').slice(-1)[0].by === 'wati.wh', 'Kedatangan.by = wati.wh (ID dari server)')
const item = rows('Item').find(i => i.req === rq)
ok((r = act('wati.wh', 'serah', item.id, 5)).ok, 'Warehouse menyerahkan: ' + r.err)
ok(rows('SerahTerima').slice(-1)[0].to === 'andi.prod', 'SerahTerima.to = andi.prod (pemohon)')
ok((r = act('wati.wh', 'ingat', item.id)).ok !== false, 'pengingat dicatat')
ok(ctx.auditData().startsWith('OK'), 'audit tetap bersih setelah alur: ' + ctx.auditData())

sec('B. Data rusak: terdeteksi audit, aksi yang menyentuhnya ditolak')
const tolak = (title, me, name, args, re) => {
  const x = act(me, name, ...args)
  ok(!x.ok && re.test(x.err || ''), `${title} -> ${x.err}`)
}
const pulihkan = (n, key, c, v) => setCell(n, key, c, v)

// pilih barang siap serah yang belum diserahkan
const snap = () => get({ action: 'sync' }).snap
const siapItem = snap().I.find(i => i.status === 'Sudah di ERO' && i.id !== item.id && !snap().SR.some(s => s.item === i.id))
const k1 = snap().K.find(k => k.id === siapItem.kon)

// buat satu barang Approved baru (barang Approved dari seed sudah terpakai di SRL tadi)
act('andi.prod', 'saveRequest', { status: 'Menunggu Approval', lines: [{ ...L, qty: '2' }] })
act('budi.spv', 'setuju', rows('Request').slice(-1)[0].id)
const ap = snap().I.filter(i => i.status === 'Approved' && !i.tahan).slice(-1)[0]
pulihkan('Item', ap.id, 'kode', 'XXX-999')
ok(/Item .*kode 'XXX-999' tidak ada di sheet Master/.test(ctx.auditData()), 'audit: Item.kode tidak ada di Master')
tolak('aksi yang mengubah barang rusak ditolak', 'dewi.admin', 'tahan', [ap.id, 'tes'], /kode 'XXX-999'/)
pulihkan('Item', ap.id, 'kode', ap.kode)
ok(ctx.auditData().startsWith('OK'), 'audit bersih setelah dipulihkan')

const namaDewi = snap().U.find(u => u.id === 'dewi.admin').n
pulihkan('Konsolidasi', k1.id, 'by', namaDewi)
ok(/NAMA pengguna.*migrate\(\)/.test(ctx.auditData()), 'audit: kolom berisi nama dikenali dan diberi petunjuk migrate()')
tolak('aksi pada baris berformat lama ditolak', 'dewi.admin', 'tutup', [k1.id, 'tes'], /NAMA pengguna/)
pulihkan('Konsolidasi', k1.id, 'by', 'dewi.admin')

pulihkan('Konsolidasi', k1.id, 'dept', 'Maintenance')
ok(/tidak sama dengan SRL/.test(ctx.auditData()), 'audit: departemen K beda dengan SRL')
pulihkan('Konsolidasi', k1.id, 'dept', 'Produksi')

pulihkan('Konsolidasi', k1.id, 'tahap', 'Validasi Warehouse')
ok(/tetapi tahap SRL 'Validasi Warehouse'/.test(ctx.auditData()), 'audit: status barang tidak sama dengan tahap SRL')
pulihkan('Konsolidasi', k1.id, 'tahap', 'Sudah di ERO')

pulihkan('Item', siapItem.id, 'status', 'Selesai')
ok(/status 'Selesai' tidak dikenal/.test(ctx.auditData()), 'audit: status di luar daftar')
pulihkan('Item', siapItem.id, 'status', 'Sudah di ERO')

// jumlah: serah terima melebihi yang datang
const kd = rows('Kedatangan').find(x => x.kon === k1.id)
const qtyAsli = kd.qty
setCell('Kedatangan', kd.id, 'qty', '0')
ok(/melebihi barang yang sudah datang/.test(ctx.auditData()), 'audit: serah terima melebihi barang yang sudah datang')
setCell('Kedatangan', kd.id, 'qty', qtyAsli)
ok(ctx.auditData().startsWith('OK'), 'audit bersih lagi: ' + ctx.auditData())

sec('C. migrate(): kolom nama format lama -> ID')
const U = snap().U
const nm = id => U.find(u => u.id === id).n
rows('Konsolidasi').forEach((k, i) => setBy('Konsolidasi', i, 'by', nm(k.by)))
rows('Kedatangan').forEach((k, i) => setBy('Kedatangan', i, 'by', nm(k.by)))
rows('SerahTerima').forEach((k, i) => setBy('SerahTerima', i, 'to', nm(k.to)))
rows('Pengingat').forEach((k, i) => setBy('Pengingat', i, 'by', nm(k.by)))
const a1 = ctx.auditData()
ok(/NAMA pengguna/.test(a1), 'audit mendeteksi format lama')
const m1 = ctx.migrate()
const n = +/^.*?(\d+) sel nama diganti/m.exec(m1)?.[1]
ok(n > 50, `migrate mengganti ${n} sel`)
ok(!/Perlu dibetulkan/.test(m1), 'tidak ada nama yang gagal dicocokkan')
ok(ctx.auditData().startsWith('OK'), 'audit bersih setelah migrate: ' + ctx.auditData())
ok(/(^|\n)0 sel nama diganti/.test(ctx.migrate()), 'migrate aman diulang')
// nama tidak dikenal dilaporkan, tidak diubah
setBy('Pengingat', 0, 'by', 'Orang Tak Dikenal')
ok(/tidak cocok dengan pengguna mana pun/.test(ctx.migrate()), 'nama tak dikenal dilaporkan untuk dibetulkan manual')

console.log(`\nHasil relasi: ${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
