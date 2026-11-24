// Uji acak (fuzz) backend: ribuan operasi acak lintas peran + kiriman ganda + kegagalan tulis yang disuntikkan,
// lalu memeriksa aturan konsistensi data setelah SETIAP langkah. Deterministik per seed.
//   node backend/test/fuzz.mjs            (beberapa seed bawaan)
//   SEEDS=7,8 OPS=2000 node backend/test/fuzz.mjs
import { createBackend } from './mock-gas.mjs'

const SEEDS = (process.env.SEEDS || '1,2,3,4,5,6').split(',').map(Number)
const OPS = +(process.env.OPS || 700)
const mulberry = a => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

const R_ST = ['Draft', 'Menunggu Approval', 'Disetujui', 'Ditolak', 'Dibatalkan']
const I_ST = ['Draft', 'Menunggu Approval', 'Approved', 'Ditolak', 'Dibatalkan', 'Validasi Warehouse', 'Sudah di ERO']
const K_TH = ['Validasi Warehouse', 'Sudah di ERO', 'Dikeluarkan']
const SHEETS = { U: 'Users', M: 'Master', R: 'Request', I: 'Item', K: 'Konsolidasi', L: 'SRL', KD: 'Kedatangan', SR: 'SerahTerima', RM: 'Pengingat' }

let totalOps = 0, totalFail = 0
const fails = []

for (const seed of SEEDS) {
  const be = createBackend(); const { env, ctx } = be
  ctx.setup(); ctx.seedDemo()
  const makeSel = be.$('makeSel') // selector yang sama persis dengan yang berjalan di server
  const rnd = mulberry(seed)
  const pick = a => a[Math.floor(rnd() * a.length)]
  const chance = p => rnd() < p
  const TODAY = be.$('TODAY'), addDays = (d, n) => be.$(`addDays('${d}', ${n})`)
  const post = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).getContent())
  const snap = () => JSON.parse(ctx.doGet({ parameter: { action: 'sync' } }).getContent()).snap
  const rows = name => { const sh = env.sheets.get(name); const h = sh.cells[0]; return sh.cells.slice(1).filter(r => r && r[0] !== '' && r[0] !== undefined).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]]))) }
  const perSheet = () => Object.fromEntries(Object.values(SHEETS).map(n => [n, JSON.stringify(env.sheets.get(n).cells)]))
  const dataHash = () => Object.values(SHEETS).map(n => JSON.stringify(env.sheets.get(n).cells)).join('|')
  let txN = 0
  const TX = () => 'TX-f' + seed + '-' + String(++txN).padStart(6, '0') + '-' + Math.floor(rnd() * 1e6).toString(36)
  const fail = (op, msg) => { totalFail++; if (fails.length < 12) fails.push(`seed ${seed} op#${op}: ${msg}`) }

  // ---------- pemeriksaan konsistensi ----------
  const check = (op, full) => {
    const S = snap(); const sel = makeSel(S)
    // I1 kunci unik
    for (const [t, n] of Object.entries(SHEETS)) {
      const key = { U: 'id', M: 'k', R: 'id', I: 'id', K: 'id', L: 'no', KD: 'id', SR: 'id', RM: 'id' }[t]
      const ks = rows(n).map(r => r[key]); if (new Set(ks).size !== ks.length) fail(op, `kunci ganda di ${n}`)
    }
    const Rm = new Map(S.R.map(r => [r.id, r])), Km = new Map(S.K.map(k => [k.id, k])), Im = new Map(S.I.map(i => [i.id, i]))
    for (const r of S.R) {
      if (!R_ST.includes(r.st)) fail(op, `status request ${r.id}=${r.st}`)
      if (r.st === 'Ditolak' && !r.cat) fail(op, `${r.id} ditolak tanpa catatan`)
      if (!S.U.find(u => u.id === r.by)) fail(op, `${r.id} pemilik hilang`)
    }
    for (const i of S.I) {
      if (!I_ST.includes(i.status)) fail(op, `status item ${i.id}=${i.status}`)
      const r = Rm.get(i.req); if (!r) { fail(op, `${i.id} request ${i.req} hilang`); continue }
      if (!(+i.qty > 0)) fail(op, `${i.id} qty ${i.qty}`)
      if (!S.M.find(m => m.k === i.kode)) fail(op, `${i.id} barang ${i.kode} tak ada di master`)
      const inKon = ['Validasi Warehouse', 'Sudah di ERO'].includes(i.status)
      if (inKon && !i.kon) fail(op, `${i.id} status ${i.status} tanpa konsolidasi`)
      if (!inKon && i.kon) fail(op, `${i.id} status ${i.status} masih punya konsolidasi ${i.kon}`)
      if (i.kon) {
        const k = Km.get(i.kon); if (!k) fail(op, `${i.id} konsolidasi ${i.kon} hilang`)
        else if (k.tahap !== i.status) fail(op, `${i.id} status ${i.status} != tahap ${k.tahap} (${k.id})`)
      }
      if (['Disetujui'].includes(r.st) && ['Draft', 'Menunggu Approval'].includes(i.status)) fail(op, `${i.id} request disetujui tapi item ${i.status}`)
      if (r.st === 'Draft' && i.status !== 'Draft') fail(op, `${i.id} request draft tapi item ${i.status}`)
      if (r.st === 'Menunggu Approval' && i.status !== 'Menunggu Approval') fail(op, `${i.id} request menunggu tapi item ${i.status}`)
      if (i.tahan && (i.status !== 'Approved' || i.kon)) fail(op, `${i.id} ditahan padahal ${i.status}`)
      if (sel.siap(i) < 0) fail(op, `${i.id} diserahkan melebihi jatah (siap=${sel.siap(i)})`)
    }
    for (const k of S.K) {
      if (!K_TH.includes(k.tahap)) fail(op, `tahap ${k.id}=${k.tahap}`)
      const its = S.I.filter(i => i.kon === k.id)
      if (k.tahap !== 'Dikeluarkan') {
        const tot = its.reduce((a, i) => a + +i.qty, 0)
        if (+k.ero !== tot) fail(op, `${k.id} ero ${k.ero} != jumlah item ${tot}`)
        if (!its.length) fail(op, `${k.id} aktif tanpa item`)
      } else if (its.length) fail(op, `${k.id} dikeluarkan tapi masih punya item`)
      const dtg = S.KD.filter(d => d.kon === k.id).reduce((a, d) => a + +d.qty, 0)
      if (+k.ero - dtg - +k.tutup < 0) fail(op, `${k.id} kedatangan ${dtg} + tutup ${k.tutup} > ero ${k.ero}`)
      if (+k.tutup < 0) fail(op, `${k.id} tutup negatif`)
      if (k.tahap !== 'Sudah di ERO' && (dtg > 0)) fail(op, `${k.id} tahap ${k.tahap} tapi ada kedatangan`)
    }
    for (const d of S.KD) { if (!Km.has(d.kon)) fail(op, `kedatangan ${d.id} -> ${d.kon} hilang`); if (+d.qty < 0 || +d.lebih < 0) fail(op, `kedatangan ${d.id} negatif`) }
    for (const s of S.SR) { if (!Im.has(s.item)) fail(op, `serah ${s.id} -> ${s.item} hilang`); if (!(+s.qty > 0)) fail(op, `serah ${s.id} qty ${s.qty}`) }
    for (const x of S.RM) if (!Im.has(x.item)) fail(op, `pengingat ${x.id} -> ${x.item} hilang`)
    if (full) {
      // I9: setiap baris punya tx berstatus OK; tidak ada Tx menggantung
      const tx = rows('Tx'); const ok = new Set(tx.filter(t => t.status === 'OK').map(t => t.tx))
      if (tx.some(t => t.status === 'PENDING')) fail(op, 'ada Tx PENDING')
      for (const [t, n] of Object.entries(SHEETS)) { if (t === 'M' || t === 'U' || t === 'L') continue; for (const r of rows(n)) if (r.tx !== 'SEED' && !ok.has(r.tx)) { fail(op, `baris ${n}/${r.id || r.no} dari tx ${r.tx} yang tidak OK`); break } }
      const sl = S.L.map(l => l.no); if (new Set(sl.map(x => x.toUpperCase())).size !== sl.length) fail(op, 'nomor SRL kembar (abaikan huruf besar)')
    }
  }

  // ---------- pembangkit operasi ----------
  const gen = S => {
    const sel = makeSel(S)
    const act = S.U.filter(u => !u.off)
    const u = pick(act)
    const line = () => { const m = pick(S.M); const lead = +m.lead; return { kode: m.k, qty: String(1 + Math.floor(rnd() * 15)), datang: addDays(TODAY, lead + Math.floor(rnd() * 9)), pakai: chance(.6) ? addDays(TODAY, lead + 10 + Math.floor(rnd() * 5)) : '' } }
    const R = S.R, I = S.I, K = S.K
    const mine = R.filter(r => r.by === u.id)
    const subs = R.filter(r => sel.user(r.by)?.boss === u.id)
    const ids = a => a.map(x => x.id)
    const choices = []
    const any = (w, f) => choices.push([w, f])
    // peran sesuai (bobot besar) dan peran salah / argumen salah (bobot kecil, harus ditolak)
    any(6, () => ({ name: 'saveRequest', me: u.id, args: [{ status: pick(['Draft', 'Menunggu Approval']), lines: Array.from({ length: 1 + Math.floor(rnd() * 3) }, line), me: {} }] }))
    any(3, () => ({ name: pick(['ajukan', 'batal']), me: u.id, args: [pick(mine.length ? mine : R).id] }))
    any(5, () => ({ name: pick(['setuju', 'tolak']), me: u.id, args: [pick(subs.length ? subs : R).id, 'catatan'] }))
    any(2, () => ({ name: 'setujuAll', me: u.id, args: [u.id, chance(.7) ? ids(subs.filter(r => r.st === 'Menunggu Approval')) : undefined] }))
    const pool = sel.poolOf(u.dept)
    any(3, () => ({ name: pick(['tahan', 'lepas']), me: u.id, args: [pick(pool.length ? pool : I).id, 'alasan'] }))
    any(4, () => ({ name: 'simpanSrl', me: u.id, args: [{ no: 'SRL-F' + Math.floor(rnd() * 40), est: chance(.5) ? addDays(TODAY, 7) : '', ids: chance(.8) ? ids(pool) : ids(I.slice(0, 3)) }] }))
    any(2, () => ({ name: 'tutup', me: u.id, args: [pick(K).id, 'tutup sisa'] }))
    const val = K.filter(k => k.tahap === 'Validasi Warehouse'), aktif = K.filter(k => k.tahap === 'Sudah di ERO')
    any(3, () => ({ name: 'validasiSrl', me: u.id, args: [pick(val.length ? val : K).srl] }))
    any(2, () => ({ name: 'keluarkan', me: u.id, args: [{ ids: [pick(I.filter(i => i.status === 'Validasi Warehouse').length ? I.filter(i => i.status === 'Validasi Warehouse') : I).id], alasan: 'tak sesuai', by: 'PALSU' }] }))
    any(7, () => { const k = pick(aktif.length ? aktif : K); const s = sel.sisa(k); return { name: 'datang', me: u.id, args: [{ id: k.id, q: chance(.15) ? s + 1 + Math.floor(rnd() * 5) : Math.max(0, Math.floor(rnd() * (s + 1))), l: chance(.1) ? 2 : 0, cat: 'ket', by: 'PALSU' }] } })
    any(2, () => ({ name: 'datangAll', me: u.id, args: [pick(aktif.length ? aktif : K).srl] }))
    any(4, () => { const it = pick(I.filter(i => sel.siap(i) > 0).length ? I.filter(i => sel.siap(i) > 0) : I); const mx = Math.max(1, sel.siap(it)); return { name: 'serah', me: u.id, args: [it.id, chance(.15) ? mx + 3 : 1 + Math.floor(rnd() * mx)] } })
    any(2, () => ({ name: 'serahAll', me: u.id, args: [ids(I.filter(i => sel.siap(i) > 0)).slice(0, 4)] }))
    any(2, () => ({ name: 'ingat', me: u.id, args: [pick(I).id] }))
    any(1, () => ({ name: 'saveMaster', me: u.id, args: [{ mode: 'new', f: { k: 'F-' + Math.floor(rnd() * 30), n: 'Barang acak', sat: 'Pcs', buf: pick(['0', '1']), kons: '0', lead: String(1 + Math.floor(rnd() * 6)) } }] }))
    any(1, () => ({ name: 'saveUser', me: u.id, args: [{ mode: 'edit', id: pick(S.U).id, n: 'Nama ' + Math.floor(rnd() * 9), rawWa: '08123456' + Math.floor(1000 + rnd() * 8999), role: pick(['User', 'Atasan']), boss: pick(S.U).id, baseV: chance(.5) ? pick(S.U)._v : undefined }] }))
    let tot = choices.reduce((a, c) => a + c[0], 0), r = rnd() * tot
    for (const [w, f] of choices) { if ((r -= w) < 0) return f() }
    return choices[0][1]()
  }

  let accepted = 0, rejected = 0, injected = 0, replays = 0, orphaned = 0, recovered = 0
  const abandoned = []
  for (let op = 1; op <= OPS; op++) {
    totalOps++
    const S = snap()
    let body
    try { body = gen(S) } catch (e) { continue } // pembangkit gagal pada keadaan langka: lewati
    body.tx = TX()
    const before = dataHash(); const beforeS = perSheet()
    const mode = rnd()
    if (mode < 0.06) { // suntikan: tulis hilang / putus di tengah
      injected++
      env.hooks.setValues = (name) => { if (['Request', 'Item', 'Konsolidasi', 'Kedatangan', 'SerahTerima', 'Master', 'SRL', 'Users', 'Pengingat'].includes(name) && chance(.5)) return chance(.5) ? 'drop' : (() => { throw new Error('putus') })() }
      const r1 = post(body); env.hooks.setValues = null
      if (r1.ok && !r1.verified) fail(op, 'ok tanpa verified')
      if (!r1.ok && r1.retry && dataHash() !== before) {
        // rollback ikut gagal: boleh sementara setengah jadi, tapi HARUS berstatus PENDING (bisa dipulihkan)
        const pend = rows('Tx').some(t => t.tx === body.tx && t.status === 'PENDING')
        if (!pend) { const now = perSheet(); const ch = Object.keys(now).filter(n => now[n] !== beforeS[n]); const tr = rows('Tx').find(t => t.tx === body.tx); fail(op, `gagal, data berubah (${ch.join(',')}), Tx=${tr ? tr.status + ' ' + tr.msg : 'tidak ada'}: ` + body.name + ' ' + JSON.stringify(r1).slice(0, 100)) }
        else orphaned++
      }
      if (chance(.5)) { const r2 = post(body); if (r2.ok) accepted++ } // pengirim mencoba lagi
      else abandoned.push(body.tx) // pengirim menutup aplikasi: pemulihan harus datang dari transaksi orang lain
      continue
    }
    const r1 = post(body)
    if (r1.ok) {
      accepted++
      if (!r1.verified) fail(op, 'ok tanpa verified')
      if (chance(.25)) { // kirim ulang tx yang sama: harus replay, data tidak berubah
        const h = dataHash(); const r2 = post(body); replays++
        if (!(r2.ok && (r2.replay || r2.noop))) fail(op, `replay bukan replay (${body.name}): ${JSON.stringify(r2).slice(0, 90)}`)
        if (dataHash() !== h) fail(op, `replay mengubah data (${body.name})`)
      }
    } else {
      rejected++
      if (r1.rejected && dataHash() !== before) fail(op, `penolakan mengubah data (${body.name}): ${r1.err}`)
      if (!r1.rejected && !r1.retry && !r1.busy) fail(op, `respons tidak dikenal: ${JSON.stringify(r1).slice(0, 80)}`)
    }
    if (chance(.02)) { env.cache.clear() }
    while (abandoned.length) { // transaksi ditinggalkan: tx lain sesudahnya wajib sudah memulihkannya
      const t = abandoned.pop(); const row = rows('Tx').find(x => x.tx === t)
      if (row && row.status === 'PENDING') fail(op, `tx yatim ${t} belum dipulihkan oleh transaksi berikutnya`)
      else recovered++
    }
    check(op, op % 40 === 0)
  }
  check(OPS, true)
  console.log(`seed ${String(seed).padEnd(3)} ops=${OPS} diterima=${accepted} ditolak=${rejected} suntik-gagal=${injected} replay=${replays} yatim=${orphaned}/pulih=${recovered}  tabel: request=${rows('Request').length} item=${rows('Item').length} SRL=${rows('SRL').length} kedatangan=${rows('Kedatangan').length} serah=${rows('SerahTerima').length} tx=${rows('Tx').length}`)
}
console.log(`\nTotal operasi: ${totalOps}, pelanggaran aturan: ${totalFail}`)
fails.forEach(f => console.log('  ✗', f))
process.exit(totalFail ? 1 : 0)
