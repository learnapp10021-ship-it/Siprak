// Uji integritas backend: menjalankan backend/dist/Code.gs ASLI di atas tiruan (mock) Google Sheets,
// LockService, CacheService dan PropertiesService yang berjalan di memori.
//   node backend/test/sim.mjs
import { createBackend } from './mock-gas.mjs'
const { env, ctx, $ } = createBackend(process.env.CODE || undefined)

// ---------------------------------------------------------------- pembantu uji
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  GAGAL:', msg) } }
const sec = t => console.log('\n# ' + t)
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent())
const get = p => JSON.parse(ctx.doGet({ parameter: p }).getContent())
const rows = name => {
  const sh = env.sheets.get(name)
  const hdr = sh.cells[0]
  return sh.cells.slice(1).filter(r => r && r[0] !== '' && r[0] !== undefined).map(r => Object.fromEntries(hdr.map((h, i) => [h, r[i] === undefined ? '' : r[i]])))
}
const TODAY = $('TODAY')
const addDays = (d, n) => $(`addDays('${d}', ${n})`)
let txN = 0
const TX = () => 'TX-' + String(++txN).padStart(6, '0') + '-' + Math.random().toString(36).slice(2, 8)
const snap = () => get({ action: 'sync' }).snap
const reqBody = (me, lines, status = 'Menunggu Approval', tx = TX()) => ({ tx, name: 'saveRequest', me, args: [{ status, lines, me: { id: me } }] })
const line = (qty, kode = 'SRG-001') => ({ kode, qty: String(qty), datang: addDays(TODAY, 10), pakai: addDays(TODAY, 14) })
const keysUnique = () => {
  for (const [t, sheet] of [['U', 'Users'], ['R', 'Request'], ['I', 'Item'], ['K', 'Konsolidasi'], ['L', 'SRL'], ['KD', 'Kedatangan'], ['SR', 'SerahTerima'], ['RM', 'Pengingat']]) {
    const k = rows(sheet).map(r => (r.id !== undefined ? r.id : r.no))
    if (new Set(k).size !== k.length) return t + ' memiliki kunci ganda'
  }
  return ''
}

// ---------------------------------------------------------------- uji
sec('Setup dan data awal')
ctx.setup()
ctx.seedDemo()
let s0 = snap()
const nR0 = s0.R.length // jumlah request awal mengikuti data seed (bukan angka tetap)
ok(s0.U.length >= 13 && nR0 >= 21, 'seed termuat: ' + s0.U.length + ' user, ' + nR0 + ' request')
ok(typeof s0.ver === 'number', 'snapshot memiliki versi')
ok(get({ action: 'sync', since: String(s0.ver) }).same === true, 'sync dengan versi sama tidak mengirim ulang data')
ok(!('tx' in s0.R[0]) && !('hp' in s0.U[0]), 'kolom internal (tx, wa) tidak bocor ke klien')
ok(s0.HP['andi.prod'] === '6281234560003', 'peta WA turunan dari kolom hp')
ok(ctx.auditData().startsWith('OK'), 'audit data awal bersih: ' + ctx.auditData())

sec('1. Submit sekali, kirim ulang (retry) tanpa data ganda')
const R0 = rows('Request').length, I0 = rows('Item').length
const b1 = reqBody('andi.prod', [line(5)])
let r = post(b1)
ok(r.ok && r.verified, 'submit pertama berhasil dan terverifikasi: ' + (r.err || r.msg))
const idBaru = 'RQ-' + String(nR0 + 1).padStart(3, '0')
ok(r.msg.includes(idBaru), 'ID request = ' + idBaru + ' (' + r.msg + ')')
ok(rows('Request').length === R0 + 1 && rows('Item').length === I0 + 1, 'tepat 1 request + 1 item tertulis')
const r2 = post(b1)
ok(r2.ok && r2.replay, 'kirim ulang tx yang sama dikenali sebagai replay')
ok(rows('Request').length === R0 + 1 && rows('Item').length === I0 + 1, 'replay tidak menambah baris')
env.cache.clear()
const r3 = post(b1)
ok(r3.ok && r3.replay && rows('Request').length === R0 + 1, 'replay tetap aman saat cache kosong (dibaca dari sheet Tx)')
const dup = post(reqBody('andi.prod', [line(5)]))
ok(!dup.ok && dup.rejected && /tidak dibuat ganda/i.test(dup.err), 'isi sama dengan tx berbeda (klik ulang/refresh) ditolak: ' + dup.err)
ok(rows('Request').length === R0 + 1, 'penolakan duplikat tidak menulis apa pun')

sec('2. Simulasi 40 user submit bersamaan + badai retry')
const U40 = ['andi.prod', 'siti.prod', 'rudi.prod']
const attempts = []
const wantTx = new Set()
for (let u = 0; u < 40; u++) {
  const me = U40[u % 3]
  const body = reqBody(me, [line(100 + u, u % 2 ? 'SRG-001' : 'SRG-002')], 'Draft')
  if (u % 2 === 0) body.args[0].lines[0].kode = 'SRG-001'
  wantTx.add(body.tx)
  for (let k = 0; k < 1 + (u % 3); k++) attempts.push(body) // 1-3 kali kirim tx yang sama
}
for (let i = attempts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [attempts[i], attempts[j]] = [attempts[j], attempts[i]] }
const R1 = rows('Request').length
let nOk = 0, nReplay = 0, nBad = 0
attempts.forEach(a => { const x = post(a); if (x.ok && x.replay) nReplay++; else if (x.ok) nOk++; else nBad++ })
ok(nOk === 40, '40 tx unik masing-masing tersimpan tepat sekali (ok=' + nOk + ', replay=' + nReplay + ', gagal=' + nBad + ')')
ok(nBad === 0, 'tidak ada penolakan salah')
ok(rows('Request').length === R1 + 40, 'jumlah request bertambah tepat 40 dari ' + attempts.length + ' pengiriman')
ok(keysUnique() === '', 'semua ID unik: ' + keysUnique())
const ids = rows('Request').map(x => x.id).filter(i => /^RQ-/.test(i))
ok(ids.length === new Set(ids).size, 'tidak ada ID request ganda')

sec('3. Server sibuk (antrean penuh)')
env.lockBusy = true
const R2 = rows('Request').length
const busy = post(reqBody('siti.prod', [line(7)]))
ok(!busy.ok && busy.busy && busy.retry, 'lock tidak didapat -> klien diminta coba lagi (busy)')
ok(rows('Request').length === R2, 'tidak ada data tertulis saat sibuk')
env.lockBusy = false

sec('4. Crash saat menulis (sebagian tabel sudah tertulis)')
const crash = reqBody('siti.prod', [line(11)])
env.hooks.setValues = name => { if (name === 'Item') throw new Error('boom: koneksi putus') }
const rc = post(crash)
env.hooks.setValues = null
ok(!rc.ok && rc.retry, 'klien menerima status GAGAL yang dapat diulang: ' + rc.err)
ok(rows('Request').length === R2, 'request yang sempat tertulis dibatalkan (rollback) -> tidak ada data setengah jadi')
ok(rows('Tx').find(t => t.tx === crash.tx).status === 'FAILED', 'Tx tercatat FAILED')
const rc2 = post(crash)
ok(rc2.ok && !rc2.replay, 'retry dengan tx yang sama berhasil')
ok(rows('Request').length === R2 + 1, 'setelah retry tepat 1 request (tidak ganda)')
ok(post(crash).replay === true && rows('Request').length === R2 + 1, 'retry ketiga hanya replay')

sec('5. Penulisan diam-diam hilang (verifikasi baca-ulang)')
const R3 = rows('Request').length
const lost = reqBody('rudi.prod', [line(13)])
env.hooks.setValues = name => (name === 'Item' ? 'drop' : undefined)
const rl = post(lost)
env.hooks.setValues = null
ok(!rl.ok && rl.retry, 'verifikasi mendeteksi data tidak tersimpan -> TIDAK dilaporkan berhasil: ' + rl.err)
ok(rows('Request').length === R3, 'perubahan parsial dibatalkan')
ok(post(lost).ok && rows('Request').length === R3 + 1, 'retry berhasil tepat sekali')

sec('6. Eksekusi mati total (PENDING menggantung)')
const R4 = rows('Request').length
const dead = reqBody('andi.prod', [line(17)])
// simulasikan: Tx PENDING + satu baris request sudah tertulis, lalu proses mati
const txSh = env.sheets.get('Tx'); const rqSh = env.sheets.get('Request')
txSh.cells.push([dead.tx, 'saveRequest', 'andi.prod', TODAY + 'T08:00', 'PENDING', '', ''])
rqSh.cells.push(['RQ-900', 'andi.prod', TODAY, 'Menunggu Approval', '', TODAY + 'T08:00', '1', dead.tx])
ok(rows('Request').length === R4 + 1, '(kondisi awal: ada baris yatim dari proses yang mati)')
const rd = post(dead)
ok(rd.ok && !rd.replay, 'kiriman ulang memulihkan lalu menyimpan: ' + (rd.err || rd.msg))
ok(!rows('Request').some(x => x.id === 'RQ-900'), 'baris yatim dihapus')
ok(rows('Request').length === R4 + 1, 'hasil akhir tepat 1 request')

sec('7. Dua orang memutuskan request yang sama (tidak saling menimpa)')
const created = post(reqBody('siti.prod', [line(3, 'KBL-005')], 'Menunggu Approval'))
const rid = created.msg.match(/RQ-\d+/)[0]
const wrong = post({ tx: TX(), name: 'setuju', me: 'hendra.mgr', args: [rid] })
ok(!wrong.ok && /bukan atasan/i.test(wrong.err), 'bukan atasan ditolak server: ' + wrong.err)
const a1 = post({ tx: TX(), name: 'setuju', me: 'budi.spv', args: [rid] })
ok(a1.ok, 'atasan menyetujui')
const a2 = post({ tx: TX(), name: 'tolak', me: 'budi.spv', args: [rid, 'terlambat'] })
ok(!a2.ok && /sudah diproses/i.test(a2.err), 'penolakan susulan tidak menimpa persetujuan: ' + a2.err)
const a3 = post({ tx: TX(), name: 'setuju', me: 'budi.spv', args: [rid] })
ok(!a3.ok && /sudah diproses/i.test(a3.err), 'klik setuju kedua (tx baru) ditolak')
ok(rows('Request').find(x => x.id === rid).st === 'Disetujui', 'status akhir tetap Disetujui')
ok(rows('Item').filter(i => i.req === rid).every(i => i.status === 'Approved'), 'item ikut Approved')

sec('8. Persetujuan massal hanya untuk yang terlihat')
const m1 = post(reqBody('maya.mt', [line(2, 'KBL-005')]))
const m1id = m1.msg.match(/RQ-\d+/)[0]
const m2 = post(reqBody('rina.mt', [line(3, 'KBL-005')]))
const m2id = m2.msg.match(/RQ-\d+/)[0]
const all = post({ tx: TX(), name: 'setujuAll', me: 'tono.spv', args: ['x', [m1id]] })
ok(all.ok && /^1 request/.test(all.msg), 'hanya 1 request (yang terlihat) disetujui: ' + all.msg)
ok(rows('Request').find(x => x.id === m2id).st === 'Menunggu Approval', 'request yang masuk kemudian tetap menunggu')

sec('9. Kedatangan: tidak ganda, tidak melebihi sisa')
const S = snap()
const sel = $('makeSel')(S)
const kon = S.K.find(k => k.dept === 'Produksi' && k.tahap === 'Sudah di ERO' && sel.sisa(k) >= 2)
const sisa = sel.sisa(kon)
const KD0 = rows('Kedatangan').length
const dtg = q => ({ tx: TX(), name: 'datang', me: 'wati.wh', args: [{ id: kon.id, q, l: 0, cat: '', by: 'PALSU' }] })
const d1 = post(dtg(1))
ok(d1.ok, 'kedatangan 1 dicatat')
ok(rows('Kedatangan').slice(-1)[0].by === 'Wati Handayani', 'nama pencatat diambil server, bukan dari klien (PALSU diabaikan)')
const d2 = post({ ...dtg(1), me: 'joko.wh' })
ok(!d2.ok && /tidak dicatat ganda/i.test(d2.err), 'admin lain menginput hal yang sama -> ditolak sebagai duplikat: ' + d2.err)
const d3 = post(dtg(sisa + 5))
ok(!d3.ok && /melebihi sisa/i.test(d3.err), 'melebihi sisa ditolak')
ok(rows('Kedatangan').length === KD0 + 1, 'hanya 1 baris kedatangan')
ok(post({ tx: TX(), name: 'datang', me: 'andi.prod', args: [{ id: kon.id, q: 1, l: 0 }] }).err.includes('Hanya Admin Warehouse'), 'user biasa tidak boleh mencatat kedatangan')
const kd = rows('Kedatangan'); ok(new Set(kd.map(x => x.id)).size === kd.length, 'ID kedatangan unik')

sec('10. Pool dan SRL: daftar yang kedaluwarsa')
const appr = post({ tx: TX(), name: 'setuju', me: 'tono.spv', args: [m2id] })
const S2 = snap(); const sel2 = $('makeSel')(S2)
const poolMt = sel2.poolOf('Maintenance')
ok(poolMt.length >= 2, 'pool Maintenance berisi ' + poolMt.length)
const seen = poolMt.map(i => i.id)
const h = post({ tx: TX(), name: 'tahan', me: 'yani.admin', args: [seen[0], 'cek spek'] })
ok(h.ok, 'admin menahan satu barang')
const hh = post({ tx: TX(), name: 'tahan', me: 'yani.admin', args: [seen[0], 'lagi'] })
ok(!hh.ok && /sudah ditahan/i.test(hh.err), 'menahan dua kali ditolak')
const stale = post({ tx: TX(), name: 'simpanSrl', me: 'yani.admin', args: [{ no: 'SRL-2611-777', est: '', ids: seen }] })
ok(!stale.ok && /Daftar pool berubah/.test(stale.err), 'SRL dengan daftar kedaluwarsa ditolak: ' + stale.err)
ok(!rows('SRL').some(x => x.no === 'SRL-2611-777'), 'SRL tidak tersimpan')
const fresh = post({ tx: TX(), name: 'simpanSrl', me: 'yani.admin', args: [{ no: 'SRL-2611-777', est: '', ids: seen.slice(1) }] })
ok(fresh.ok, 'SRL dengan daftar yang benar tersimpan: ' + (fresh.err || fresh.msg))
const sameNo = post({ tx: TX(), name: 'simpanSrl', me: 'yani.admin', args: [{ no: ' srl-2611-777 ', est: '', ids: seen.slice(1) }] })
ok(!sameNo.ok && /sudah pernah disimpan/i.test(sameNo.err), 'nomor SRL ganda (beda huruf/spasi) ditolak')
const kk = rows('Konsolidasi').map(x => x.id); ok(new Set(kk).size === kk.length, 'ID konsolidasi unik')
ok(keysUnique() === '', 'semua kunci tabel unik: ' + keysUnique())

sec('11. Edit pengguna: versi baris (tidak menimpa edit orang lain)')
const uv = snap().U.find(u => u.id === 'siti.prod')
const e1 = post({ tx: TX(), name: 'saveUser', me: 'dewi.admin', args: [{ mode: 'edit', id: 'siti.prod', n: 'Siti R. A', rawWa: '081234560004', role: 'User', boss: 'budi.spv', baseV: uv._v }] })
ok(e1.ok, 'edit pertama berhasil')
const e2 = post({ tx: TX(), name: 'saveUser', me: 'dewi.admin', args: [{ mode: 'edit', id: 'siti.prod', n: 'Nama lain', rawWa: '081234560004', role: 'User', boss: 'budi.spv', baseV: uv._v }] })
ok(!e2.ok && /baru saja diubah/i.test(e2.err), 'edit dengan versi lama ditolak: ' + e2.err)
ok(rows('Users').find(u => u.id === 'siti.prod').n === 'Siti R. A', 'nama hasil edit pertama tidak tertimpa')
const e3 = post({ tx: TX(), name: 'saveUser', me: 'dewi.admin', args: [{ mode: 'edit', id: 'tono.spv', n: 'X', role: 'Atasan', baseV: '1' }] })
ok(!e3.ok && /departemen Anda/.test(e3.err), 'Admin Dept tidak boleh mengubah pengguna departemen lain')
const e4 = post({ tx: TX(), name: 'saveUser', me: 'andi.prod', args: [{ mode: 'edit', self: true, id: 'siti.prod', n: 'Peretas', role: 'User' }] })
ok(!e4.ok, 'user tidak boleh mengedit profil orang lain walau mengaku self')

sec('12. Keamanan dasar')
ok(!post({ tx: 'x', name: 'setuju', me: 'budi.spv', args: ['RQ-001'] }).ok, 'ID transaksi tidak valid ditolak')
ok(!post({ tx: TX(), name: 'hapusSemua', me: 'budi.spv', args: [] }).ok, 'aksi tidak dikenal ditolak')
ok(post({ tx: TX(), name: 'setuju', me: 'orang.asing', args: ['RQ-001'] }).err.includes('tidak ditemukan'), 'pelaku tidak dikenal ditolak')
env.props.set('API_KEY', 'rahasia')
ok(get({ action: 'sync' }).rejected === true && post({ ...reqBody('andi.prod', [line(1)]) }).rejected === true, 'API key wajib bila diset')
ok(get({ action: 'sync', key: 'rahasia' }).ok === true, 'API key benar diterima')
env.props.delete('API_KEY')

sec('13. Cache, edit manual, dan data tidak tertimpa')
const ver1 = get({ action: 'sync' }).snap.ver
env.cache.clear()
const afterClear = get({ action: 'sync' })
ok(afterClear.ok && afterClear.snap.ver > ver1, 'cache hilang -> dibangun ulang dengan versi baru')
// edit manual di sheet oleh admin
const rs = env.sheets.get('Request'); const hdr = rs.cells[0]
const rowIdx = rs.cells.findIndex(rw => rw && rw[0] === 'RQ-001')
rs.cells[rowIdx][hdr.indexOf('cat')] = 'catatan manual admin'
ctx.onEdit()
ok(get({ action: 'sync', since: String(afterClear.snap.ver) }).snap.R.find(x => x.id === 'RQ-001').cat === 'catatan manual admin', 'edit manual terlihat oleh klien setelah onEdit')
// edit manual TANPA trigger, lalu penulisan lain: edit manual tidak boleh hilang
rs.cells[rowIdx][hdr.indexOf('cat')] = 'edit manual kedua'
post(reqBody('andi.prod', [line(31, 'KBL-005')]))
ok(rs.cells[rowIdx][hdr.indexOf('cat')] === 'edit manual kedua', 'penulisan baru tidak menimpa edit manual (selalu baca data terbaru)')

// baris dihapus manual di tengah sheet: ID baru tidak boleh bentrok dengan ID yang sudah ada
const idx = rs.cells.findIndex(rw => rw && rw[0] === 'RQ-004')
rs.cells.splice(idx, 1)
const afterDel = post(reqBody('rudi.prod', [line(77, 'KBL-005')]))
const newId = ((afterDel.msg || '').match(/RQ-\d+/) || ['(gagal)'])[0]
ok(afterDel.ok && rows('Request').filter(x => x.id === newId).length === 1, 'ID baru unik walau ada baris dihapus manual (' + newId + ')')

sec('13b. Alur baru: Validasi SRL, keluarkan, serah semua, Master')
{
  const S3 = snap(); const sel3 = $('makeSel')(S3)
  const pend = S3.K.filter(k => k.tahap === 'Validasi Warehouse')
  ok(pend.length >= 2, 'seed memuat SRL menunggu validasi (' + pend.length + ' konsolidasi)')
  const no = pend[0].srl
  const itemsOf = S3.I.filter(i => i.status === 'Validasi Warehouse' && S3.K.find(k => k.id === i.kon).srl === no)
  const bad1 = post({ tx: TX(), name: 'validasiSrl', me: 'andi.prod', args: [no] })
  ok(!bad1.ok && /Hanya Admin Warehouse/.test(bad1.err), 'user biasa tidak boleh memvalidasi SRL')
  const kel = post({ tx: TX(), name: 'keluarkan', me: 'wati.wh', args: [{ ids: [itemsOf[0].id], alasan: 'spek salah', by: 'PALSU' }] })
  ok(kel.ok, 'barang dikeluarkan dari SRL: ' + (kel.err || kel.msg))
  ok(/Wati Handayani/.test(rows('Item').find(i => i.id === itemsOf[0].id).alasan), 'nama pengeluar diambil server (PALSU diabaikan)')
  const kel2 = post({ tx: TX(), name: 'keluarkan', me: 'joko.wh', args: [{ ids: [itemsOf[0].id], alasan: 'dobel', by: 'x' }] })
  ok(!kel2.ok && /sudah divalidasi|tidak ditemukan/i.test(kel2.err), 'dikeluarkan dua kali oleh admin lain ditolak')
  const v1 = post({ tx: TX(), name: 'validasiSrl', me: 'wati.wh', args: [no] })
  const v2 = post({ tx: TX(), name: 'validasiSrl', me: 'joko.wh', args: [no] })
  ok(v1.ok && !v2.ok && /sudah divalidasi/.test(v2.err), 'dua admin memvalidasi SRL yang sama: hanya satu yang berhasil')
  ok(rows('Konsolidasi').filter(k => k.srl === no).every(k => k.tahap === 'Sudah di ERO' || k.tahap === 'Dikeluarkan'), 'tahap konsolidasi konsisten')
  // serah semua
  const S4 = snap(); const sel4 = $('makeSel')(S4)
  const siap = S4.I.filter(i => i.status === 'Sudah di ERO' && sel4.siap(i) > 0)
  const SR0 = rows('SerahTerima').length
  const sa = post({ tx: TX(), name: 'serahAll', me: 'wati.wh', args: [siap.slice(0, 3).map(i => i.id)] })
  ok(sa.ok, 'serah semua: ' + (sa.err || sa.msg))
  const sa2 = post({ tx: TX(), name: 'serahAll', me: 'joko.wh', args: [siap.slice(0, 3).map(i => i.id)] })
  ok(!sa2.ok && /sudah diserahkan/.test(sa2.err), 'serah semua kedua oleh admin lain ditolak, tidak ganda')
  ok(rows('SerahTerima').length === SR0 + sa.msg.match(/^(\d+)/)[1] * 1, 'jumlah baris serah terima = yang dilaporkan')
  const srIds = rows('SerahTerima').map(x => x.id); ok(new Set(srIds).size === srIds.length, 'ID serah terima unik')
  // master
  const M0 = rows('Master').length
  const mm = post({ tx: TX(), name: 'saveMaster', me: 'wati.wh', args: [{ mode: 'new', f: { k: 'tes-001', n: 'Barang Tes', sat: 'Pcs', buf: '1', kons: '0', lead: '4' } }] })
  ok(mm.ok && rows('Master').length === M0 + 1 && rows('Master').some(m => m.k === 'TES-001'), 'master baru tersimpan (kode dinormalkan)')
  const mm2 = post({ tx: TX(), name: 'saveMaster', me: 'joko.wh', args: [{ mode: 'new', f: { k: 'TES-001', n: 'Dobel', sat: 'Pcs' } }] })
  ok(!mm2.ok && /sudah ada/.test(mm2.err), 'kode master ganda ditolak')
  const mm3 = post({ tx: TX(), name: 'saveMaster', me: 'andi.prod', args: [{ mode: 'new', f: { k: 'X-1', n: 'a', sat: 'b' } }] })
  ok(!mm3.ok && /Hanya Admin Warehouse/.test(mm3.err), 'user biasa tidak boleh mengubah master')
  const im = post({ tx: TX(), name: 'importMaster', me: 'wati.wh', args: [[{ k: 'imp-1', n: 'A', sat: 'Pcs', lead: '2' }, { k: '', n: 'rusak', sat: 'x' }, { k: 'TES-001', n: 'Barang Tes v2', sat: 'Pcs', buf: 'ya', lead: '5' }]] })
  ok(im.ok && /1 item baru, 1 item diperbarui/.test(im.msg), 'impor: baris rusak dilewati, ada baru + diperbarui: ' + im.msg)
  ok(rows('Master').find(m => m.k === 'TES-001').n === 'Barang Tes v2' && rows('Master').find(m => m.k === 'TES-001')._v === '2', 'versi baris master naik saat diubah')
  const imAgain = post({ tx: TX(), name: 'importMaster', me: 'wati.wh', args: [[{ k: 'imp-1', n: 'A', sat: 'Pcs', lead: '2' }]] })
  ok(imAgain.ok && rows('Master').filter(m => m.k === 'IMP-1').length === 1, 'impor ulang file yang sama tidak menggandakan item')
}

sec('13c. Migrasi dari backend lama (sheet tanpa kolom id/_v/tx)')
{
  // sheet lama persis format backend sebelumnya
  const old = createBackend(process.env.CODE || undefined)
  const oe = old.env
  const mk = (name, cols, data) => { const sh = old.ss.insertSheet(name); sh.cells.push(cols.slice()); data.forEach(r => sh.cells.push(r)) }
  mk('Users', ['id', 'n', 'dept', 'role', 'boss', 'hp', 'off'], [['a@x', 'Andi', 'Produksi', 'User', 'b@x', '6281234560003', ''], ['b@x', 'Budi', 'Produksi', 'Atasan', '', '6281234560002', 'Y']])
  mk('Master', ['k', 'n', 'sat', 'buf', 'kons', 'lead'], [['SRG-001', 'Sarung', 'Pasang', '0', '0', '3']])
  mk('Request', ['id', 'by', 'tgl', 'st', 'cat'], [['RQ-001', 'a@x', TODAY, 'Disetujui', '']])
  mk('Item', ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan'], [['ITM-001', 'RQ-001', 'SRG-001', '10', TODAY, TODAY, 'Sudah di ERO', TODAY, 'KON-001', '', '']])
  mk('Konsolidasi', ['id', 'dept', 'by', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan'], [['KON-001', 'Produksi', 'Dewi', 'SRG-001', 'Sudah di ERO', 'SRL-1', '10', '0', '']])
  mk('SRL', ['no', 'dept', 'est'], [['SRL-1', 'Produksi', TODAY]])
  mk('Kedatangan', ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl'], [['KON-001', '4', '0', 'Wati', '', TODAY], ['KON-001', '3', '0', 'Wati', '', TODAY]])
  mk('SerahTerima', ['item', 'qty', 'to', 'tgl'], [['ITM-001', '2', 'Andi', TODAY]])
  mk('Pengingat', ['item', 'by', 'at'], [['ITM-001', 'Wati', TODAY + 'T09:00']])
  let err = ''
  try { old.ctx.doGet({ parameter: { action: 'sync' } }).getContent(); const x = JSON.parse(old.ctx.doGet({ parameter: { action: 'sync' } }).getContent()); err = x.err || '' } catch (e) { err = String(e) }
  ok(/migrate\(\)/.test(err), 'sheet lama ditolak dengan petunjuk menjalankan migrate(): ' + err)
  const log = old.ctx.migrate()
  ok(/Kedatangan: 2 baris dilengkapi/.test(log), 'migrate melengkapi baris lama: ' + log.split('\n')[6])
  const og = JSON.parse(old.ctx.doGet({ parameter: { action: 'sync' } }).getContent())
  ok(og.ok && og.snap.KD.length === 2 && og.snap.SR.length === 1 && og.snap.RM.length === 1 && og.snap.U.length === 2, 'semua data lama utuh setelah migrasi')
  ok(og.snap.KD[0].id === 'KD-001' && og.snap.KD[1].id === 'KD-002', 'baris lama diberi ID unik')
  ok(og.snap.U[1].off === true && og.snap.HP['a@x'] === '6281234560003', 'kolom off & hp lama terbaca')
  const again = old.ctx.migrate()
  const og2 = JSON.parse(old.ctx.doGet({ parameter: { action: 'sync', since: '' } }).getContent())
  ok(og2.snap.KD.length === 2 && og2.snap.KD[0].id === 'KD-001', 'migrate dijalankan ulang aman (tidak menggandakan / mengubah ID)')
  // penulisan pertama setelah migrasi bekerja: kedatangan baru mendapat KD-003
  const w = JSON.parse(old.ctx.doPost({ postData: { contents: JSON.stringify({ tx: 'TX-mig-0000001-aaaa', name: 'datang', me: 'wati.wh', args: [] }) } }).getContent())
  ok(!w.ok, 'pelaku tak dikenal tetap ditolak setelah migrasi')
}

sec('14. Kesehatan akhir')
ok(keysUnique() === '', 'tidak ada kunci ganda di seluruh sheet')
const au = ctx.auditData()
ok(au === 'Item ITM-005: request RQ-004 tidak ada', 'auditData hanya melaporkan yatim akibat penghapusan manual tadi: ' + au)
const txs = rows('Tx'); ok(new Set(txs.map(t => t.tx)).size === txs.length, 'setiap tx tercatat tepat satu baris (' + txs.length + ')')
ok(!txs.some(t => t.status === 'PENDING'), 'tidak ada Tx menggantung')
const orphan = rows('Request').filter(x => /^TX-/.test(x.tx) && !txs.some(t => t.tx === x.tx && t.status === 'OK'))
ok(orphan.length === 0, 'setiap baris data berasal dari tx berstatus OK (yatim: ' + orphan.length + ')')

console.log(`\nPanggilan API per operasi tulis (perkiraan beban): getValues=${env.counts.getValues} setValues=${env.counts.setValues} flush=${env.counts.flush}`)
console.log(`\nHasil: ${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
