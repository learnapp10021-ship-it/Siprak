// Uji backend Supabase: Edge Function ASLI + migrasi SQL ASLI di atas Postgres sungguhan (PGlite).
//   node backend/test/supabase.mjs
import { createSupabaseBackend } from './supabase-harness.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  GAGAL:', m) } }
const sec = t => console.log('\n# ' + t)

const B = await createSupabaseBackend({ env: {} })
const { handler, db, sb, stats } = B
const call = async (method, q, body) => JSON.parse(await (await handler(new Request('http://x/api' + (q || ''), { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }))).text())
const get = p => call('GET', '?' + new URLSearchParams(p))
const post = b => call('POST', '', b)
let n = 0
const TX = () => 'TX-' + String(++n).padStart(6, '0') + '-' + Math.random().toString(36).slice(2, 8)
const today = (await get({ action: 'ping' })).time.slice(0, 10)
const addDays = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10)
const line = (qty, kode = 'SRG-001') => ({ kode, qty: String(qty), datang: addDays(today, 20), pakai: addDays(today, 25) })
const saveReq = (me, lines, tx = TX()) => ({ tx, name: 'saveRequest', me, args: [{ status: 'Menunggu Approval', lines, me: { id: me } }] })
const q = async sql => (await db.query(sql)).rows
const count = async t => +(await q(`select count(*)::int c from public.${t}`))[0].c
const ver = async () => +(await q('select ver from public.meta'))[0].ver

sec('1. Skema SQL sama dengan SCHEMA, RLS terkunci')
{
  const { SCHEMA, TABLES } = B.nrb
  for (const t of TABLES) {
    const cols = (await q(`select column_name c from information_schema.columns where table_schema='public' and table_name='${SCHEMA[t].sheet.toLowerCase()}' and column_name <> 'seq' order by ordinal_position`)).map(r => r.c)
    ok(JSON.stringify(cols) === JSON.stringify(SCHEMA[t].cols), `kolom ${SCHEMA[t].sheet} sama dengan SCHEMA`)
    const pk = await q(`select a.attname k from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid='public.${SCHEMA[t].sheet.toLowerCase()}'::regclass and i.indisprimary`)
    ok(pk.length === 1 && pk[0].k === SCHEMA[t].key, `kunci utama ${SCHEMA[t].sheet} = ${SCHEMA[t].key}`)
  }
  const rls = await q(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'`)
  ok(rls.length >= 11 && rls.every(r => r.relrowsecurity), 'RLS aktif di semua tabel (' + rls.length + ')')
  const pol = await q(`select count(*)::int c from pg_policies where schemaname='public'`)
  ok(+pol[0].c === 0, 'tidak ada kebijakan RLS => hanya service_role yang bisa mengakses')
  for (const role of ['anon', 'authenticated']) {
    let e1 = '', e2 = '', e3 = ''
    await db.exec(`set role ${role}`)
    try { await db.query('select * from public.users') } catch (e) { e1 = e.message }
    try { await db.query('select public.nrb_load()') } catch (e) { e2 = e.message }
    try { await db.query(`select public.nrb_apply('TX-x','a','b',1,'{}'::jsonb,'','')`) } catch (e) { e3 = e.message }
    await db.exec('reset role')
    ok(/permission denied/.test(e1), `${role}: tidak bisa membaca tabel users (${e1.slice(0, 40)})`)
    ok(/permission denied/.test(e2), `${role}: tidak bisa memanggil nrb_load`)
    ok(/permission denied/.test(e3), `${role}: tidak bisa memanggil nrb_apply`)
  }
  await db.exec('set role service_role')
  const v = (await db.query('select public.nrb_ver() v')).rows[0].v
  await db.exec('reset role')
  ok(+v >= 1, 'service_role bisa memanggil fungsi')
}

sec('2. Sinkronisasi dan kebocoran kolom')
const s0 = (await get({ action: 'sync' })).snap
ok(s0.U.length === 16 && s0.M.length === 27 && s0.R.length === 0, 'seed termuat: 16 pengguna, 27 master, 0 request')
ok(typeof s0.ver === 'number', 'snapshot memiliki versi')
ok((await get({ action: 'sync', since: String(s0.ver) })).same === true, 'sync dengan versi sama tidak mengirim ulang data')
ok(!('tx' in s0.U[0]) && !('hp' in s0.U[0]) && !('seq' in s0.U[0]), 'kolom internal (tx, hp, seq) tidak bocor ke klien')
ok(s0.HP['andi.prod'] === '6281234560003', 'peta WhatsApp turunan dari kolom hp')
ok(s0.U.every(u => typeof u.off === 'boolean'), 'kolom off berupa boolean')

sec('3. Kirim ulang tanpa data ganda (replay)')
{
  const tx = TX()
  const r1 = await post(saveReq('andi.prod', [line(10)], tx))
  ok(r1.ok === true && r1.verified === true, 'request pertama tersimpan: ' + (r1.msg || r1.err))
  const r2 = await post(saveReq('andi.prod', [line(10)], tx))
  ok(r2.ok === true && r2.replay === true, 'kirim ulang tx sama dijawab replay')
  ok((await count('request')) === 1 && (await count('item')) === 1, 'hanya 1 request dan 1 item tersimpan')
  const tx3 = TX()
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => post(saveReq('siti.prod', [line(3)], tx3))))
  ok(rs.every(r => r.ok), 'kiriman kembar bersamaan semuanya dijawab sukses')
  ok((await count('request')) === 2, 'enam kiriman kembar (tx sama) hanya membuat 1 request tambahan')
  ok((await q(`select count(*)::int c from public.tx where tx='${tx3}'`))[0].c === 1, 'log tx tepat satu baris')
}

sec('4. Hak akses (server otoritatif)')
{
  const rid = (await get({ action: 'sync' })).snap.R.find(r => r.by === 'andi.prod').id
  const a = await post({ tx: TX(), name: 'setuju', me: 'andi.prod', args: [rid] })
  ok(a.rejected && /atasan/i.test(a.err), 'User tidak boleh menyetujui: ' + a.err)
  const b = await post({ tx: TX(), name: 'setuju', me: 'hendra.mgr', args: [rid] })
  ok(b.rejected, 'Atasan lain (bukan atasan pemilik) ditolak: ' + b.err)
  ok((await post(saveReq('wati.wh', [line(1)]))).rejected, 'Admin Warehouse tidak boleh membuat request')
  ok((await post({ tx: TX(), name: 'datang', me: 'andi.prod', args: [{ id: 'KON-001', q: 1 }] })).rejected, 'User tidak boleh mencatat kedatangan')
  ok((await post({ tx: TX(), name: 'hapusSemua', me: 'wati.wh', args: [] })).err === 'Aksi tidak dikenal.', 'aksi tak dikenal ditolak')
  ok((await post({ tx: 'bad', name: 'setuju', me: 'budi.spv', args: [rid] })).err === 'ID transaksi tidak valid.', 'ID transaksi tidak valid ditolak')
  ok(/tidak ditemukan/.test((await post(saveReq('hantu', [line(1)]))).err), 'pelaku tidak dikenal ditolak')
  await db.query(`update public.users set "off"='Y' where "id"='dika.prod'`)
  ok(/nonaktif/.test((await post(saveReq('dika.prod', [line(1)]))).err), 'pengguna nonaktif ditolak')
  await db.query(`update public.users set "off"='' where "id"='dika.prod'`)
  const toString = await post({ tx: TX(), name: 'toString', me: 'wati.wh', args: [] })
  ok(toString.rejected, 'nama aksi berbahaya (toString) ditolak')
  const bad = await post(saveReq('andi.prod', [{ kode: 'SRG-001', qty: '-5', datang: addDays(today, 20), pakai: '' }]))
  ok(bad.rejected, 'jumlah negatif ditolak: ' + bad.err)
  const early = await post(saveReq('andi.prod', [{ kode: 'SRG-001', qty: '1', datang: today, pakai: addDays(today, 5) }]))
  ok(early.rejected && /paling cepat/.test(early.err), 'tanggal datang lebih awal dari lead time ditolak: ' + early.err)
}

sec('5. Alur penuh: request -> setuju -> SRL -> validasi -> kedatangan -> serah terima')
{
  const snap = (await get({ action: 'sync' })).snap
  const rid = snap.R.find(r => r.by === 'andi.prod').id
  const ap = await post({ tx: TX(), name: 'setuju', me: 'budi.spv', args: [rid] })
  ok(ap.ok, 'atasan menyetujui: ' + (ap.msg || ap.err))
  const sr = await post({ tx: TX(), name: 'simpanSrl', me: 'dewi.admin', args: [{ no: 'SRL-2611-901', est: addDays(today, 25) }] })
  ok(sr.ok, 'Admin Dept menyimpan SRL: ' + (sr.msg || sr.err))
  const dup = await post({ tx: TX(), name: 'simpanSrl', me: 'dewi.admin', args: [{ no: 'srl-2611-901', est: '' }] })
  ok(dup.rejected, 'nomor SRL ganda (beda huruf besar/kecil) ditolak: ' + dup.err)
  const v = await post({ tx: TX(), name: 'validasiSrl', me: 'wati.wh', args: ['SRL-2611-901'] })
  ok(v.ok, 'Admin Warehouse memvalidasi: ' + (v.msg || v.err))
  const dt = await post({ tx: TX(), name: 'datangAll', me: 'wati.wh', args: ['SRL-2611-901'] })
  ok(dt.ok, 'kedatangan dicatat: ' + (dt.msg || dt.err))
  const item = dt.snap ? JSON.parse(JSON.stringify((await get({ action: 'sync' })).snap)).I.find(i => i.req === rid) : null
  const sh = await post({ tx: TX(), name: 'serah', me: 'wati.wh', args: [item.id, 10] })
  ok(sh.ok, 'serah terima dicatat: ' + (sh.msg || sh.err))
  const fin = (await get({ action: 'sync' })).snap
  ok(fin.KD.length === 1 && fin.SR.length === 1 && fin.L.length === 1, 'kedatangan, serah terima, SRL masing-masing tercatat')
  const over = await post({ tx: TX(), name: 'serah', me: 'wati.wh', args: [item.id, 1] })
  ok(over.rejected, 'serah melebihi jumlah ditolak: ' + over.err)
  ok((await q(`select count(*)::int c from public.tx where action in ('setuju','simpanSrl','validasiSrl','datangAll','serah')`))[0].c === 5, 'log tx mencatat kelima transaksi sukses')
}

sec('6. Penulis bersamaan')
const writers = ['andi.prod', 'siti.prod', 'rudi.prod', 'dika.prod']
const burst = async (hs, total) => {
  const jobs = Array.from({ length: total }, (_, i) => ({ i, me: writers[i % 4], tx: TX(), h: hs[i % hs.length] }))
  // isi tiap permintaan unik (aturan bisnis menolak request identik dalam 2 menit sebagai input ganda)
  const seq = (burst.n = (burst.n || 0) + 1000)
  return Promise.all(
    jobs.map(async j => {
      for (let k = 0; k < 30; k++) {
        // klien mengirim ulang dengan tx SAMA bila server menjawab retry
        const res = JSON.parse(await (await j.h(new Request('http://x/api', { method: 'POST', body: JSON.stringify(saveReq(j.me, [line(seq + j.i + 1)], j.tx)) }))).text())
        if (!res.retry) return res
        await new Promise(ok => setTimeout(ok, 20))
      }
      return { ok: false, err: 'menyerah' }
    })
  )
}
{
  const before = await count('request'), v0 = await ver(), c0 = stats.conflict
  const final = await burst([handler], 40)
  ok(final.every(r => r.ok === true), '40 penulis serentak di satu isolate: semua sukses')
  ok((await count('request')) === before + 40 && (await ver()) === v0 + 40, 'tepat 40 request baru, versi naik tepat 40')
  ok(stats.conflict === c0, 'antrean tulis per isolate: tanpa konflik (' + (stats.conflict - c0) + ')')
  const ids = (await q('select "id" from public.request')).map(r => r.id)
  ok(new Set(ids).size === ids.length, 'semua ID request unik')
}
{
  const before = await count('request'), v0 = await ver(), c0 = stats.conflict
  const h2 = B.isolate()
  const final = await burst([handler, h2], 40)
  ok(final.every(r => r.ok === true), '40 penulis di 2 isolate: semua akhirnya sukses')
  ok((await count('request')) === before + 40 && (await ver()) === v0 + 40, 'tepat 40 request baru (tanpa hilang/ganda), versi +40')
  ok(stats.conflict > c0, 'konflik antar-isolate benar-benar terjadi dan tertangani (' + (stats.conflict - c0) + ')')
  const aud = (await q(`select count(*)::int c from public.item i left join public.request r on r."id"=i."req" where r."id" is null`))[0].c
  ok(aud === 0, 'tidak ada item yatim (relasi item -> request utuh)')
}

sec('7. Atomik: kegagalan di tengah tidak menulis apa pun')
{
  const v0 = await ver()
  const m0 = await count('master')
  const bad = await sb.rpc('nrb_apply', {
    p_tx: 'TX-ATOMIK-0001', p_action: 'uji', p_actor: 'x', p_expected: v0, p_msg: '', p_ms: '1',
    p_changes: {
      master: { add: [{ k: 'ATOM-1', n: 'Uji', sat: 'Pcs', buf: '0', kons: '0', lead: '1', _v: '1', tx: 'TX-ATOMIK-0001' }], upd: [] },
      users: { add: [{ id: 'andi.prod', n: 'Ganda', dept: 'X', role: 'User', boss: '', hp: '', off: '', _v: '1', tx: 'TX-ATOMIK-0001' }], upd: [] }, // kunci ganda -> gagal
    },
  })
  ok(!!bad.error && /duplicate|unique/i.test(bad.error.message), 'kunci ganda membatalkan transaksi: ' + (bad.error && bad.error.message.slice(0, 50)))
  ok((await count('master')) === m0, 'baris master yang sudah "ditulis" ikut dibatalkan')
  ok((await ver()) === v0, 'versi tidak berubah')
  ok((await q(`select count(*)::int c from public.tx where tx='TX-ATOMIK-0001'`))[0].c === 0, 'log tx tidak tercatat')
  const miss = await sb.rpc('nrb_apply', { p_tx: 'TX-ATOMIK-0002', p_action: 'uji', p_actor: 'x', p_expected: v0, p_msg: '', p_ms: '1', p_changes: { users: { add: [], upd: [{ id: 'tidak-ada', n: 'X', dept: '', role: 'User', boss: '', hp: '', off: '', _v: '2', tx: 'T' }] } } })
  ok(!!miss.error && /tidak ditemukan/.test(miss.error.message), 'update baris yang tidak ada ditolak')
}

sec('8. Zona waktu WIB, kunci API, CORS, input rusak')
{
  const RealDate = Date
  const at = iso => { globalThis.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(iso) } static now() { return new RealDate(iso).getTime() } } }
  at('2026-11-24T20:00:00Z')
  const t1 = (await get({ action: 'ping' })).time
  at('2026-11-24T16:59:00Z')
  const t2 = (await get({ action: 'ping' })).time
  globalThis.Date = RealDate
  ok(t1 === '2026-11-25T03:00', 'UTC 20:00 = WIB 03:00 hari berikutnya: ' + t1)
  ok(t2 === '2026-11-24T23:59', 'UTC 16:59 = WIB 23:59 hari yang sama: ' + t2)

  const K = await createSupabaseBackend({ env: { API_KEY: 'rahasia' } })
  const kget = async (p) => JSON.parse(await (await K.handler(new Request('http://x/api?' + new URLSearchParams(p)))).text())
  ok((await kget({ action: 'sync' })).err === 'Akses ditolak.', 'tanpa kunci API: ditolak')
  ok((await kget({ action: 'sync', key: 'salah' })).err === 'Akses ditolak.', 'kunci API salah: ditolak')
  ok((await kget({ action: 'sync', key: 'rahasia' })).ok === true, 'kunci API benar: diterima')
  const kp = JSON.parse(await (await K.handler(new Request('http://x/api', { method: 'POST', body: JSON.stringify({ key: 'salah', tx: TX(), name: 'setuju', me: 'a', args: [] }) }))).text())
  ok(kp.err === 'Akses ditolak.', 'POST dengan kunci salah ditolak')

  const opt = await handler(new Request('http://x/api', { method: 'OPTIONS' }))
  ok(opt.status === 204 && opt.headers.get('Access-Control-Allow-Origin') === '*', 'OPTIONS (CORS) dijawab 204')
  const junk = await post('bukan json {{{')
  ok(junk.retry === true && /kesalahan/i.test(junk.err), 'badan permintaan rusak tidak membuat server jatuh')
  const big = await post('x'.repeat(600001))
  ok(big.rejected && /terlalu besar/.test(big.err), 'permintaan > 600 KB ditolak')
}

sec('9. Kesehatan akhir')
{
  const s = (await get({ action: 'sync' })).snap
  const k = new Set(s.K.map(x => x.id))
  ok(s.I.every(i => !i.kon || k.has(i.kon)), 'setiap item yang terhubung menunjuk konsolidasi yang ada')
  ok(s.R.every(r => s.U.some(u => u.id === r.by)), 'setiap request menunjuk pengguna yang ada')
  console.log('   statistik nrb_apply:', JSON.stringify(stats))
}

console.log(`\nHasil Supabase: ${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
