// Validator spreadsheet go live: templat di repo harus bersih, dan tiap aturan harus menangkap salah isinya.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bacaXlsx } from '../../scripts/lib/xlsx-mini.mjs'
import { periksa, bacaSkema } from '../../scripts/lib/sheet-rules.mjs'

const TEMPLAT = path.resolve(__dirname, '../../backend/template/SIPRAK-Spreadsheet.xlsx')
const DASAR = bacaXlsx(TEMPLAT) // diparse sekali; tiap tes memakai salinan sendiri
const baru = () => JSON.parse(JSON.stringify(DASAR))
const kol = (rows, c) => rows[0].indexOf(c)
const cari = (r, teks) => r.galat.some(m => m.includes(teks))

describe('templat di backend/template', () => {
  it('lolos tanpa galat maupun peringatan', () => {
    const r = periksa(baru())
    expect(r.galat).toEqual([])
    expect(r.peringatan).toEqual([])
    expect(r.ringkas).toMatchObject({ pengguna: 16, aktif: 15, barang: 27, dept: 3 })
  })
  it('header semua sheet sama persis dengan SCHEMA di server.gs', () => {
    const s = baru()
    for (const { sheet, cols } of bacaSkema()) expect(s[sheet][0], sheet).toEqual(cols)
  })
})

describe('aturan header dan sheet', () => {
  it('urutan kolom berubah ditolak', () => {
    const s = baru(); [s.Users[0][1], s.Users[0][2]] = [s.Users[0][2], s.Users[0][1]]
    expect(cari(periksa(s), 'Sheet "Users": header harus')).toBe(true)
  })
  it('sheet hilang ditolak', () => {
    const s = baru(); delete s.Master
    expect(cari(periksa(s), 'Sheet "Master" tidak ada')).toBe(true)
  })
})

describe('aturan Users', () => {
  const ubah = (fn, opsi) => { const s = baru(); fn(s.Users, s); return periksa(s, opsi) }
  const U = (rows, id) => rows.find(r => r[0] === id)
  const c = (rows, n) => kol(rows, n)

  it('id ganda (tidak peka huruf besar/kecil) dan id huruf besar', () => {
    expect(cari(ubah(u => { u.push([...U(u, 'andi.prod')]) }), 'id sama dengan Users baris')).toBe(true)
    expect(cari(ubah(u => { U(u, 'andi.prod')[0] = 'Andi.Prod' }), 'huruf kecil semua')).toBe(true)
  })
  it('nomor WhatsApp tidak berformat 628', () => {
    expect(cari(ubah(u => { U(u, 'andi.prod')[c(u, 'hp')] = '081234567890' }), 'harus berformat 628')).toBe(true)
    expect(ubah(u => { U(u, 'andi.prod')[c(u, 'hp')] = '' }).galat).toEqual([])
  })
  it('role salah ketik', () => {
    expect(cari(ubah(u => { U(u, 'andi.prod')[c(u, 'role')] = 'user' }), 'role "user" tidak dikenal')).toBe(true)
  })
  it('atasan tidak ada, bukan role Atasan, diri sendiri', () => {
    expect(cari(ubah(u => { U(u, 'andi.prod')[c(u, 'boss')] = 'tidak.ada' }), 'tidak ada di sheet Users')).toBe(true)
    expect(cari(ubah(u => { U(u, 'andi.prod')[c(u, 'boss')] = 'siti.prod' }), 'harus Atasan')).toBe(true)
    expect(cari(ubah(u => { U(u, 'hendra.mgr')[c(u, 'boss')] = 'hendra.mgr' }), 'diri sendiri')).toBe(true)
  })
  it('rantai atasan berputar', () => {
    expect(cari(ubah(u => { U(u, 'hendra.mgr')[c(u, 'boss')] = 'budi.spv' }), 'berputar')).toBe(true)
  })
  it('User tanpa atasan', () => {
    expect(cari(ubah(u => { U(u, 'andi.prod')[c(u, 'boss')] = '' }), 'wajib punya atasan')).toBe(true)
  })
  it('kolom off selain kosong/Y', () => {
    expect(cari(ubah(u => { U(u, 'andi.prod')[c(u, 'off')] = 'ya' }), 'kosong atau Y')).toBe(true)
  })
  it('departemen ber-User tanpa Admin Dept aktif; tanpa Admin Warehouse', () => {
    expect(cari(ubah(u => { U(u, 'dewi.admin')[c(u, 'off')] = 'Y' }), 'Departemen "Produksi" punya User tetapi tidak ada Admin Dept')).toBe(true)
    const r = ubah(u => { U(u, 'wati.wh')[c(u, 'off')] = 'Y'; U(u, 'joko.wh')[c(u, 'off')] = 'Y' })
    expect(cari(r, 'Belum ada Admin Warehouse aktif')).toBe(true)
  })
  it('_v/tx kosong hanya peringatan, bukan galat', () => {
    const r = ubah(u => { U(u, 'andi.prod')[c(u, 'tx')] = '' })
    expect(r.galat).toEqual([])
    expect(r.peringatan.some(m => m.includes('_v/tx kosong'))).toBe(true)
  })
})

describe('aturan Master', () => {
  const ubah = fn => { const s = baru(); fn(s.Master); return periksa(s) }
  const M = (rows, k) => rows.find(r => r[0] === k)
  it('kode ganda, huruf kecil, buf/kons bukan 0/1, lead bukan angka', () => {
    expect(cari(ubah(m => { m.push([...M(m, 'SRG-001')]) }), 'kode sama dengan Master baris')).toBe(true)
    expect(cari(ubah(m => { M(m, 'SRG-001')[0] = 'srg-001' }), 'huruf besar')).toBe(true)
    expect(cari(ubah(m => { M(m, 'SRG-001')[kol(m, 'buf')] = '2' }), 'buf harus 0 atau 1')).toBe(true)
    expect(cari(ubah(m => { M(m, 'SRG-001')[kol(m, 'kons')] = 'ya' }), 'kons harus 0 atau 1')).toBe(true)
    expect(cari(ubah(m => { M(m, 'SRG-001')[kol(m, 'lead')] = 'tiga' }), 'Lead time harus angka')).toBe(true)
  })
  it('nama atau satuan kosong', () => {
    expect(cari(ubah(m => { M(m, 'SRG-001')[1] = '' }), 'Nama kosong')).toBe(true)
    expect(cari(ubah(m => { M(m, 'SRG-001')[2] = '' }), 'Satuan kosong')).toBe(true)
  })
})

describe('sheet transaksi harus kosong saat go live', () => {
  const dgBaris = () => { const s = baru(); s.Request.push(['RQ-001', 'andi.prod', '2026-11-03', 'Disetujui', '', '', '1', 'TX-1']); return s }
  it('berisi data contoh ditolak, kecuali --izinkan-transaksi', () => {
    expect(cari(periksa(dgBaris()), 'Sheet "Request" berisi 1 baris')).toBe(true)
    expect(periksa(dgBaris(), { izinkanTransaksi: true }).galat).toEqual([])
  })
})

describe('pembaca xlsx untuk ekspor Google Sheets', () => {
  // zip minimal (tanpa kompresi) berisi: sharedStrings, angka eksponen, sel kosong, rich text, entitas XML
  const zip = files => {
    const parts = [], cd = []; let off = 0
    for (const [name, data] of Object.entries(files)) {
      const n = Buffer.from(name), d = Buffer.from(data)
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26)
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
      parts.push(lh, n, d); cd.push(ch, n); off += 30 + n.length + d.length
    }
    const cdb = Buffer.concat(cd), end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cd.length / 2, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16)
    return Buffer.concat([...parts, cdb, end])
  }
  it('membaca string bersama, rich text, entitas, angka eksponen, dan sel kosong', () => {
    const f = path.join(os.tmpdir(), 'sheet-check-' + process.pid + '.xlsx')
    fs.writeFileSync(f, zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Users &amp; Co" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>id</t></si><si><r><t>Ayam </t></r><r><t>&amp; Bebek</t></r></si><si><t>x</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>6.281234560001E12</v></c></row><row r="3"><c r="A3" s="1"/></row></sheetData></worksheet>',
    }))
    const s = bacaXlsx(f); fs.unlinkSync(f)
    expect(Object.keys(s)).toEqual(['Users & Co'])
    expect(s['Users & Co']).toEqual([['id', 'Ayam & Bebek'], ['x', '', '6281234560001']])
  })
  it('berkas bukan xlsx ditolak dengan pesan jelas', () => {
    const f = path.join(os.tmpdir(), 'bukan-xlsx-' + process.pid + '.xlsx')
    fs.writeFileSync(f, 'halo')
    expect(() => bacaXlsx(f)).toThrow(/bukan berkas \.xlsx/i)
    fs.unlinkSync(f)
  })
})
