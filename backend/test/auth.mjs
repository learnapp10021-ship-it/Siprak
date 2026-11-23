// Uji login PIN: identitas tidak bisa dipalsukan, PIN tidak tersimpan polos, percobaan salah dibatasi.
//   node backend/test/auth.mjs
import { createBackend } from './mock-gas.mjs'
const { env, ctx, $ } = createBackend(process.env.CODE || undefined)

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  GAGAL:', msg) } }
const sec = t => console.log('\n# ' + t)
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent())
const get = p => JSON.parse(ctx.doGet({ parameter: p }).getContent())
const sheetRows = name => {
  const sh = env.sheets.get(name)
  if (!sh) return null
  const h = sh.cells[0]
  return sh.cells.slice(1).filter(r => r && r[0]).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}
const TODAY = $('TODAY')
const addDays = (d, n) => $(`addDays('${d}', ${n})`)
let n = 0
const TX = () => 'TX-AU' + String(++n).padStart(6, '0') + '-' + Math.random().toString(36).slice(2, 8)
const line = q => ({ kode: 'SRG-001', qty: String(q), datang: addDays(TODAY, 10), pakai: addDays(TODAY, 14) })
const login = (id, pin) => post({ action: 'login', id, pin })
const sync = token => post({ action: 'sync', since: '', token })
const write = (token, name, args, me) => post({ tx: TX(), name, args, me, token })

ctx.setup()
ctx.seedDemo()
get({ action: 'sync' })

sec('1. Sebelum login diaktifkan: perilaku lama tetap jalan (kompatibel mundur)')
ok(get({ action: 'sync' }).ok === true, 'sync GET tanpa token berfungsi')
ok(login('andi.prod', '123456').rejected === true, 'login ditolak karena belum diaktifkan')

sec('2. Mengaktifkan login butuh PIN untuk semua pengguna aktif')
let err = ''
try { ctx.aktifkanLogin() } catch (e) { err = e.message }
ok(/belum punya PIN/i.test(err), 'aktifkanLogin menolak bila ada pengguna tanpa PIN: ' + err)
const info = ctx.buatPinAwal()
ok(/13/.test(info), 'PIN awal dibuat untuk 13 pengguna: ' + info)
const awal = sheetRows('PIN_AWAL')
ok(awal && awal.length === 13 && awal.every(r => /^\d{6}$/.test(r.pin)), 'sheet PIN_AWAL berisi PIN 6 angka untuk tiap pengguna')
const akses = sheetRows('Akses')
ok(akses.length === 13, 'sheet Akses berisi 13 baris')
ok(akses.every(a => a.hash && a.salt && !JSON.stringify(a).includes(awal.find(r => r.id === a.id).pin)), 'PIN tidak tersimpan polos di sheet Akses (hanya hash + salt)')
ok(new Set(akses.map(a => a.hash)).size === 13, 'hash berbeda untuk tiap pengguna (salt unik)')
ok(ctx.buatPinAwal().startsWith('Tidak ada'), 'dijalankan lagi tidak mengganti PIN yang sudah ada')
const pin = id => awal.find(r => r.id === id).pin
ctx.aktifkanLogin()
ok(env.props.get('AUTH') === '1' && env.props.get('AUTH_SECRET').length >= 32, 'login aktif dengan rahasia penanda tangan')

sec('3. Tanpa login, tidak ada data yang keluar')
const g = get({ action: 'sync' })
ok(g.auth === true && !g.snap && !g.U, 'GET sync ditolak dan tanpa data')
ok(Array.isArray(g.users) && g.users.length === 13 && g.users.every(u => u.id && u.n && !('hp' in u) && !('boss' in u)), 'hanya daftar login minimal (id, nama, dept, role) tanpa nomor HP')
const s0 = sync('')
ok(s0.auth === true && !s0.snap, 'sync POST tanpa token ditolak')
const w0 = write('', 'saveRequest', [{ status: 'Draft', lines: [line(1)], me: { id: 'andi.prod' } }], 'andi.prod')
ok(w0.auth === true && !w0.ok, 'tulis tanpa token ditolak walau "me" diisi: ' + w0.err)

sec('4. Login')
const bad = login('andi.prod', '000001')
const unk = login('tidak.ada', '123456')
ok(!bad.ok && !unk.ok && bad.err === unk.err, 'PIN salah dan pengguna tak dikenal mendapat pesan yang sama: ' + bad.err)
const A = login('andi.prod', pin('andi.prod'))
ok(A.ok && typeof A.token === 'string' && A.id === 'andi.prod', 'PIN benar -> token')
ok(!JSON.stringify(A).includes(pin('andi.prod')), 'respons tidak memuat PIN')
const sA = sync(A.token)
ok(sA.ok && sA.snap && sA.snap.U.length === 13, 'sync dengan token berhasil')

sec('5. Identitas tidak bisa dipalsukan')
const before = sheetRows('Request').length
const imp = write(A.token, 'setuju', ['RQ-008'], 'budi.spv')           // andi (User) berpura-pura jadi budi (Atasan)
ok(!imp.ok && /bukan atasan/i.test(imp.err), 'argumen "me" diabaikan; pelaku = pemilik token: ' + imp.err)
ok(sheetRows('Request').find(r => r.id === 'RQ-008').st === 'Menunggu Approval', 'request tidak berubah')
const ownOk = write(A.token, 'saveRequest', [{ status: 'Draft', lines: [line(3)], me: { id: 'budi.spv', role: 'Atasan' } }], 'budi.spv')
ok(ownOk.ok, 'andi tetap bisa menulis atas namanya sendiri: ' + (ownOk.err || ownOk.msg))
ok(sheetRows('Request').find(r => r.id === 'RQ-' + String(before + 1).padStart(3, '0')).by === 'andi.prod', 'pemilik request = andi, bukan "me" yang dikirim')
const forged = A.token.replace(/^[^.]+/, encodeURIComponent('budi.spv'))
ok(write(forged, 'setuju', ['RQ-008'], 'budi.spv').auth === true, 'token yang id-nya diubah ditolak (tanda tangan tidak cocok)')
ok(write(A.token.slice(0, -4) + 'abcd', 'ajukan', ['RQ-009'], 'andi.prod').auth === true, 'tanda tangan diubah ditolak')
const expired = $(`mkToken_('andi.prod', -1000)`)
ok(sync(expired).auth === true && write(expired, 'ajukan', ['RQ-009'], 'andi.prod').auth === true, 'token kedaluwarsa ditolak')
ok(write(A.token, 'ajukan', ['RQ-009'], 'andi.prod').ok, 'token sah masih berfungsi')

sec('6. Replay tx tetap butuh login')
const body = { tx: TX(), name: 'saveRequest', args: [{ status: 'Draft', lines: [line(4)], me: { id: 'andi.prod' } }], me: 'andi.prod', token: A.token }
ok(post(body).ok, 'tulis pertama ok')
ok(post({ ...body, token: '' }).auth === true, 'mengirim ulang tx yang sama tanpa token ditolak (tidak bocor hasil)')
ok(post(body).replay === true, 'dengan token tetap replay')

sec('7. Batas percobaan salah')
for (let i = 0; i < 5; i++) login('siti.prod', '111222')
const locked = login('siti.prod', pin('siti.prod'))
ok(!locked.ok && locked.locked === true, 'setelah 5x salah, PIN benar pun ditolak sementara')
ok(login('rudi.prod', pin('rudi.prod')).ok, 'akun lain tidak terpengaruh')
env.cache.delete('pinfail:siti.prod')

sec('8. Ganti PIN')
ok(!post({ action: 'ubahPin', token: A.token, lama: '999999', baru: '482915' }).ok, 'PIN lama salah ditolak')
ok(/6 sampai 12/.test(post({ action: 'ubahPin', token: A.token, lama: pin('andi.prod'), baru: '12' }).err), 'PIN terlalu pendek ditolak')
ok(!post({ action: 'ubahPin', token: A.token, lama: pin('andi.prod'), baru: '123456' }).ok, 'PIN mudah ditebak (urut) ditolak')
ok(!post({ action: 'ubahPin', token: A.token, lama: pin('andi.prod'), baru: '777777' }).ok, 'PIN angka kembar ditolak')
ok(!post({ action: 'ubahPin', token: '', lama: pin('andi.prod'), baru: '482915' }).ok, 'ganti PIN tanpa login ditolak')
const ch = post({ action: 'ubahPin', token: A.token, lama: pin('andi.prod'), baru: '482915' })
ok(ch.ok, 'ganti PIN berhasil: ' + (ch.err || ch.msg))
ok(!login('andi.prod', pin('andi.prod')).ok && login('andi.prod', '482915').ok, 'PIN lama tak berlaku, PIN baru berlaku')

sec('9. Admin mengatur ulang PIN')
ctx.aturPin('siti.prod', '593817')
ok(login('siti.prod', '593817').ok, 'aturPin dari editor berfungsi dan membuka kunci')
let e2 = ''
try { ctx.aturPin('tidak.ada', '593817') } catch (e) { e2 = e.message }
ok(/tidak ditemukan/i.test(e2), 'aturPin untuk pengguna tak dikenal ditolak')

sec('10. Pengguna dinonaktifkan: akses berhenti')
const T = login('rudi.prod', pin('rudi.prod'))
ok(sync(T.token).ok, '(awal) rudi bisa sync')
const usersSh = env.sheets.get('Users')
const ri = usersSh.cells.findIndex(r => r && r[0] === 'rudi.prod')
usersSh.cells[ri][6] = 'Y'                     // kolom off diisi manual oleh admin
env.cache.clear()
ok(write(T.token, 'ajukan', ['RQ-009'], 'rudi.prod').ok === false, 'tulis oleh akun nonaktif ditolak')
const sT = sync(T.token)
ok(sT.auth === true && !sT.snap, 'sync akun nonaktif ditolak')
ok(!login('rudi.prod', pin('rudi.prod')).ok, 'login akun nonaktif ditolak')

sec('11. PIN awal dihapus dari spreadsheet')
ctx.hapusPinAwal()
ok(!env.sheets.has('PIN_AWAL'), 'sheet PIN_AWAL dihapus')

sec('12. Darurat: matikan login')
ctx.matikanLogin()
ok(get({ action: 'sync' }).ok === true, 'setelah dimatikan, perilaku lama kembali (untuk pemulihan darurat)')

console.log(`\nHasil login: ${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
