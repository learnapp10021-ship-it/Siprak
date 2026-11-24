// Pemeriksaan data spreadsheet SIPRAK sebelum go live. Fungsi murni: terima isi sheet, kembalikan temuan.
// Aturan mengikuti backend (SCHEMA di server.gs, relasi di rules.gs, cleanMaster/wa di src/lib/utils.js).
// auditData() di Apps Script tetap pemeriksa akhir terhadap data hidup; ini untuk menangkap salah isi lebih awal.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanMaster } from '../../src/lib/utils.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Skema diambil langsung dari server.gs supaya tidak pernah selisih dengan backend.
export function bacaSkema() {
  const src = fs.readFileSync(path.join(root, 'backend/src/server.gs'), 'utf8')
  const list = s => [...s.matchAll(/'([^']+)'/g)].map(m => m[1])
  const skema = []
  for (const m of src.matchAll(/^\s+\w+: \{ sheet: '(\w+)', key: '\w+', cols: \[([^\]]*)\] \}/gm)) skema.push({ sheet: m[1], cols: list(m[2]) })
  const tx = src.match(/const TX_COLS = \[([^\]]*)\]/)
  const jr = src.match(/const JR_COLS = \[([^\]]*)\]/)
  if (!skema.length || !tx || !jr) throw new Error('Skema tidak terbaca dari backend/src/server.gs.')
  skema.push({ sheet: 'Tx', cols: list(tx[1]) }, { sheet: 'Journal', cols: list(jr[1]) })
  return skema
}

export const ROLES = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']
const TRANSAKSI = ['Request', 'Item', 'Konsolidasi', 'SRL', 'Kedatangan', 'SerahTerima', 'Pengingat', 'Tx', 'Journal']

// sheets: { NamaSheet: [[header...], [baris...], ...] }
// opsi.izinkanTransaksi: sheet transaksi boleh berisi (mis. untuk cadangan data berjalan)
export function periksa(sheets, { izinkanTransaksi = false } = {}) {
  const galat = []
  const peringatan = []
  const E = m => galat.push(m)
  const W = m => peringatan.push(m)
  const skema = bacaSkema()

  // 1. Nama sheet dan header (urutan kolom tidak boleh berubah)
  const ada = {}
  for (const s of skema) {
    const rows = sheets[s.sheet]
    if (!rows) { E(`Sheet "${s.sheet}" tidak ada.`); continue }
    const h = rows[0] || []
    const sama = s.cols.length === h.length && s.cols.every((c, i) => c === h[i])
    if (!sama) E(`Sheet "${s.sheet}": header harus [${s.cols.join(', ')}], tetapi terbaca [${h.join(', ')}].`)
    else ada[s.sheet] = rows.slice(1).map((r, i) => ({ r, n: i + 2 })).filter(x => x.r.some(c => c !== ''))
  }
  const rowObj = (s, x) => Object.fromEntries(skema.find(k => k.sheet === s).cols.map((c, i) => [c, x.r[i] ?? '']))

  // 2. Users
  const U = (ada.Users || []).map(x => ({ ...rowObj('Users', x), n_: x.n }))
  const ids = new Map()
  const lbl = u => `Users baris ${u.n_} (${u.id || 'tanpa id'})`
  for (const u of U) {
    const k = u.id.toLowerCase()
    if (!u.id) E(`${lbl(u)}: id kosong.`)
    else {
      if (u.id !== k) E(`${lbl(u)}: id harus huruf kecil semua.`)
      if (!/^[a-z0-9][a-z0-9._@+-]*$/.test(k)) E(`${lbl(u)}: id hanya boleh huruf kecil, angka, titik, minus, garis bawah, atau @.`)
      if (ids.has(k)) E(`${lbl(u)}: id sama dengan Users baris ${ids.get(k)}.`)
      else ids.set(k, u.n_)
    }
    if (!u.n) E(`${lbl(u)}: nama kosong.`)
    if (!u.dept) E(`${lbl(u)}: departemen kosong.`)
    if (!ROLES.includes(u.role)) E(`${lbl(u)}: role "${u.role}" tidak dikenal. Pilihan: ${ROLES.join(', ')}.`)
    if (u.hp && !/^628\d{8,11}$/.test(u.hp)) E(`${lbl(u)}: nomor WhatsApp "${u.hp}" harus berformat 628xxxxxxxxxx (tanpa spasi, tanda + atau 0 di depan).`)
    if (u.off !== '' && u.off !== 'Y') E(`${lbl(u)}: kolom off hanya boleh kosong atau Y.`)
    if (u.role === 'User' && !u.boss) E(`${lbl(u)}: User wajib punya atasan (boss), kalau tidak request tidak bisa disetujui.`)
    if (u._v === '' || u.tx === '') W(`${lbl(u)}: _v/tx kosong. Isi _v = 1 dan tx = SEED untuk baris yang diketik manual (kosong pun masih terbaca).`)
  }
  const byId = new Map(U.map(u => [u.id.toLowerCase(), u]))
  for (const u of U) {
    if (!u.boss) continue
    const b = byId.get(u.boss.toLowerCase())
    if (!b) E(`${lbl(u)}: atasan "${u.boss}" tidak ada di sheet Users.`)
    else {
      if (b === u) E(`${lbl(u)}: atasan tidak boleh diri sendiri.`)
      else if (b.role !== 'Atasan') E(`${lbl(u)}: atasan "${u.boss}" ber-role "${b.role}", harus Atasan.`)
      if (b.off === 'Y' && u.off !== 'Y') W(`${lbl(u)}: atasan "${u.boss}" nonaktif, request pengguna ini tidak bisa disetujui.`)
    }
    // rantai atasan tidak boleh berputar
    const seen = new Set([u.id.toLowerCase()])
    for (let c = byId.get(u.boss.toLowerCase()); c; c = c.boss ? byId.get(c.boss.toLowerCase()) : null) {
      if (seen.has(c.id.toLowerCase())) { E(`${lbl(u)}: rantai atasan berputar kembali ke ${c.id}.`); break }
      seen.add(c.id.toLowerCase())
    }
  }
  // 3. Kelengkapan peran supaya alur bisa berjalan
  const aktif = U.filter(u => u.off !== 'Y')
  if (U.length) {
    if (!aktif.some(u => u.role === 'Admin Warehouse')) E('Belum ada Admin Warehouse aktif: validasi SRL, kedatangan, dan serah terima tidak bisa dikerjakan.')
    if (!aktif.some(u => u.role === 'Spv Warehouse')) W('Belum ada Spv Warehouse aktif: dashboard Warehouse tidak bisa dibuka siapa pun.')
    for (const d of new Set(aktif.filter(u => u.role === 'User').map(u => u.dept)))
      if (!aktif.some(u => u.role === 'Admin Dept' && u.dept === d)) E(`Departemen "${d}" punya User tetapi tidak ada Admin Dept aktif: request tidak bisa dibuatkan ERO/SRL.`)
  }

  // 4. Master
  const seenK = new Map()
  for (const x of ada.Master || []) {
    const m = rowObj('Master', x)
    const l = `Master baris ${x.n} (${m.k || 'tanpa kode'})`
    const c = cleanMaster({ k: m.k, n: m.n, sat: m.sat, buf: m.buf, kons: m.kons, lead: m.lead })
    if (c.err) E(`${l}: ${c.err}.`)
    else {
      if (m.k !== c.k) E(`${l}: kode harus huruf besar tanpa spasi (mis. ${c.k}).`)
      if (seenK.has(c.k)) E(`${l}: kode sama dengan Master baris ${seenK.get(c.k)}.`)
      else seenK.set(c.k, x.n)
    }
    if (!['0', '1'].includes(m.buf)) E(`${l}: kolom buf harus 0 atau 1 (terbaca "${m.buf}").`)
    if (!['0', '1'].includes(m.kons)) E(`${l}: kolom kons harus 0 atau 1 (terbaca "${m.kons}").`)
    if (m.lead !== '' && !/^\d+$/.test(m.lead)) E(`${l}: lead time harus bilangan bulat hari (terbaca "${m.lead}").`)
    if (m.lead === '') W(`${l}: lead time kosong, aplikasi memakai 3 hari.`)
  }
  if (ada.Master && !ada.Master.length) E('Sheet Master kosong: tidak ada barang yang bisa direquest.')
  if (ada.Users && !ada.Users.length) E('Sheet Users kosong: tidak ada yang bisa masuk.')

  // 5. Sheet transaksi harus kosong saat go live
  if (!izinkanTransaksi)
    for (const s of TRANSAKSI) if ((ada[s] || []).length) E(`Sheet "${s}" berisi ${ada[s].length} baris. Saat go live harus kosong (data contoh belum dibersihkan?). Gunakan --izinkan-transaksi bila memang cadangan data berjalan.`)

  const ringkas = { pengguna: U.length, aktif: aktif.length, barang: (ada.Master || []).length, dept: [...new Set(U.map(u => u.dept))].length }
  return { galat, peringatan, ringkas }
}
