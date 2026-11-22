// Uji tambahan hasil audit konkurensi (celah yang tidak tercakup sim.mjs):
//   A. Transaksi PENDING milik ORANG LAIN yang tidak pernah dikirim ulang tidak boleh menjadi permanen
//   B. Pembaca yang membangun ulang cache tidak boleh menerbitkan data setengah jadi
//   C. Cache gagal ditulis SETELAH commit: klien tetap diberi tahu berhasil (data memang tersimpan)
//   D. Cache basi (versi lebih lama dari server) harus sembuh sendiri, bukan tampil sampai 6 jam
//   node backend/test/audit.mjs
import { createBackend } from './mock-gas.mjs'
const { env, ctx, $ } = createBackend(process.env.CODE || undefined)

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
const TX = () => 'TX-A' + String(++txN).padStart(6, '0') + '-' + Math.random().toString(36).slice(2, 8)
const line = (qty, kode = 'SRG-001') => ({ kode, qty: String(qty), datang: addDays(TODAY, 10), pakai: addDays(TODAY, 14) })
const reqBody = (me, lines, status = 'Menunggu Approval', tx = TX()) => ({ tx, name: 'saveRequest', me, args: [{ status, lines, me: { id: me } }] })
const snap = () => get({ action: 'sync' }).snap

ctx.setup()
ctx.seedDemo()
get({ action: 'sync' })

// Tiruan proses yang mati di tengah jalan: Tx PENDING + baris di dua tabel sudah tertulis, tidak ada yang mengirim ulang.
const killMidWrite = (me, n) => {
  const dead = TX()
  env.sheets.get('Tx').cells.push([dead, 'saveRequest', me, TODAY + 'T08:00', 'PENDING', '', ''])
  env.sheets.get('Request').cells.push(['RQ-9' + n, me, TODAY, 'Menunggu Approval', '', TODAY + 'T08:00', '1', dead])
  env.sheets.get('Item').cells.push(['ITM-9' + n, 'RQ-9' + n, 'SRG-001', '77', addDays(TODAY, 10), '', 'Menunggu Approval', '', '', '', '', '1', dead])
  return dead
}

sec('A. PENDING milik orang lain dipulihkan oleh penulis berikutnya')
const deadA = killMidWrite('andi.prod', '01')
ok(rows('Request').some(r => r.id === 'RQ-901'), '(kondisi awal: ada baris setengah jadi dari proses yang mati)')
const rA = post(reqBody('siti.prod', [line(5)]))
ok(rA.ok && rA.verified, 'penulis lain tetap berhasil: ' + (rA.err || rA.msg))
ok(!rows('Request').some(r => r.id === 'RQ-901'), 'baris setengah jadi di Request dibatalkan, bukan dilanjutkan')
ok(!rows('Item').some(r => r.id === 'ITM-901'), 'baris setengah jadi di Item dibatalkan')
ok(/RQ-022/.test(rA.msg), 'ID baru dihitung dari data bersih, bukan dari yatim (' + rA.msg + ')')
const txA = rows('Tx').find(t => t.tx === deadA)
ok(txA && txA.status === 'ROLLED_BACK', 'Tx yang mati ditandai ROLLED_BACK (status: ' + (txA && txA.status) + ')')
ok(!rows('Tx').some(t => t.status === 'PENDING'), 'tidak ada Tx PENDING tersisa')
ok(!snap().R.some(r => r.id === 'RQ-901'), 'snapshot klien tidak memuat data yatim')

sec('B. Pembaca yang membangun ulang cache tidak menerbitkan data setengah jadi')
const deadB = killMidWrite('rudi.prod', '02')
env.cache.clear()
const sB = snap()
ok(!sB.R.some(r => r.id === 'RQ-902'), 'snapshot hasil bangun-ulang bersih dari yatim')
ok(!rows('Request').some(r => r.id === 'RQ-902'), 'yatim dibersihkan dari sheet')
ok(rows('Tx').find(t => t.tx === deadB).status === 'ROLLED_BACK', 'Tx yatim ditandai ROLLED_BACK')

sec('B2. Pengirim asli kemudian mengirim ulang (tx sama) setelah dipulihkan: tepat sekali')
const R1 = rows('Request').length
const retryDead = post({ tx: deadB, name: 'saveRequest', me: 'rudi.prod', args: [{ status: 'Menunggu Approval', lines: [line(77)], me: { id: 'rudi.prod' } }] })
ok(retryDead.ok && !retryDead.replay, 'kirim ulang diproses sebagai transaksi baru yang bersih: ' + (retryDead.err || retryDead.msg))
ok(rows('Request').length === R1 + 1, 'tepat 1 request baru')
ok(post({ tx: deadB, name: 'saveRequest', me: 'rudi.prod', args: [] }).replay === true, 'kirim ulang berikutnya hanya replay')

sec('C. Cache gagal ditulis setelah commit: klien tetap diberi tahu BERHASIL')
const R2 = rows('Request').length
const bC = reqBody('andi.prod', [line(9, 'SRG-002')])
const origSet = env.cache.set.bind(env.cache)
env.cache.set = (k, v) => { if (String(k).startsWith('snap')) throw new Error('quota cache habis'); return origSet(k, v) }
const rC = post(bC)
env.cache.set = origSet
ok(rC.ok && rC.verified, 'data sudah terverifikasi di sheet, jadi klien tidak boleh menerima kegagalan: ' + (rC.err || rC.msg))
ok(rows('Request').length === R2 + 1, 'tepat 1 request tersimpan')
ok(rows('Tx').find(t => t.tx === bC.tx).status === 'OK', 'Tx = OK')
const sC = snap()
ok(sC.R.length === R2 + 1 && sC.R.some(r => /RQ-/.test(r.id) && r.id === rows('Request').pop().id), 'pembacaan berikutnya langsung melihat data baru')
const rC2 = post(bC)
ok(rC2.ok && rC2.replay && rows('Request').length === R2 + 1, 'kirim ulang = replay, tidak ganda')
ok(rC2.snap && rC2.snap.R.length === R2 + 1, 'snapshot di respons replay memuat data baru')

sec('D. Cache basi (versi lebih rendah dari server) sembuh sendiri')
const R3 = rows('Request').length
const stale = new Map(env.cache)          // cache sebelum transaksi
const bD = reqBody('siti.prod', [line(13, 'KBL-005')])
ok(post(bD).ok, 'transaksi berhasil')
env.cache.clear()
stale.forEach((v, k) => { if (!String(k).startsWith('tx:')) env.cache.set(k, v) })   // cache lama "muncul kembali"
const sD = get({ action: 'sync' })
ok(sD.snap && sD.snap.R.length === R3 + 1, 'sync tidak melayani cache basi: ' + (sD.snap ? sD.snap.R.length : 'tanpa snap') + ' vs ' + (R3 + 1))
const rD = post(bD)
ok(rD.ok && rD.replay && rD.snap && rD.snap.R.length === R3 + 1, 'replay juga membawa data terbaru')

sec('E. Kesehatan akhir')
const k = rows('Request').map(r => r.id)
ok(new Set(k).size === k.length, 'tidak ada ID request ganda')
ok(ctx.auditData().startsWith('OK'), 'auditData bersih: ' + ctx.auditData())

console.log(`\nHasil audit: ${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
