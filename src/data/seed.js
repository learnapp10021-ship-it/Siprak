import { T, addDays, TODAY } from '../lib/utils'
import { makeSel } from '../lib/selectors'

// Data contoh (sama dengan versi HTML). Ganti dengan API/backend saat produksi.
export function buildSeed() {
  const U = T(
    `hendra.mgr|Hendra Wijaya|Produksi|Atasan|
budi.spv|Budi Hartono|Produksi|Atasan|hendra.mgr
andi.prod|Andi Saputra|Produksi|User|budi.spv
siti.prod|Siti Rahma|Produksi|User|budi.spv
rudi.prod|Rudi Firmansyah|Produksi|User|budi.spv
dewi.admin|Dewi Lestari|Produksi|Admin Dept|budi.spv
tono.spv|Tono Sugiarto|Maintenance|Atasan|
maya.mt|Maya Anggraeni|Maintenance|User|tono.spv
rina.mt|Rina Marlina|Maintenance|User|tono.spv
yani.admin|Yani Kusuma|Maintenance|Admin Dept|tono.spv
wati.wh|Wati Handayani|Warehouse|Admin Warehouse|
joko.wh|Joko Susilo|Warehouse|Admin Warehouse|
agus.spv|Agus Prasetyo|Warehouse|Spv Warehouse|`,
    ['id', 'n', 'dept', 'role', 'boss']
  )
  const HP = {
    'hendra.mgr': '6281234560001', 'budi.spv': '6281234560002', 'andi.prod': '6281234560003',
    'siti.prod': '6281234560004', 'rudi.prod': '6281234560005', 'dewi.admin': '6281234560006',
    'tono.spv': '6281234560007', 'maya.mt': '6281234560008', 'rina.mt': '6281234560009',
    'yani.admin': '6281234560010', 'wati.wh': '6281234560011', 'joko.wh': '6281234560012',
    'agus.spv': '6281234560013',
  }
  const M = T(
    `SRG-001|Sarung Tangan Kain|Pasang|0|0|3
SRG-002|Masker KN95|Box|1|0|3
APD-007|Helm Safety|Pcs|1|0|7
OLI-010|Oli Hidrolik 20L|Jerigen|0|1|5
BRG-204|Bearing 6204|Pcs|1|1|7
KBL-005|Kabel Tie 30cm|Pack|0|0|2
LAS-021|Kawat Las RB26|Kg|0|0|3`,
    ['k', 'n', 'sat', 'buf', 'kons', 'lead']
  )
  const R = T(
    `RQ-001|andi.prod|2026-11-03|Disetujui|
RQ-002|siti.prod|2026-11-03|Disetujui|
RQ-003|rudi.prod|2026-11-03|Disetujui|
RQ-004|siti.prod|2026-11-12|Disetujui|
RQ-005|rudi.prod|2026-11-12|Disetujui|
RQ-006|maya.mt|2026-11-04|Disetujui|
RQ-007|rina.mt|2026-11-04|Disetujui|
RQ-008|siti.prod|2026-11-18|Menunggu Approval|
RQ-009|andi.prod|2026-11-18|Draft|
RQ-010|rudi.prod|2026-11-09|Ditolak|Stok helm masih cukup, tunda dulu
RQ-011|andi.prod|2026-11-10|Dibatalkan|`,
    ['id', 'by', 'tgl', 'st', 'cat']
  )
  const I = T(
    `ITM-001|RQ-001|SRG-001|10|2026-11-16|2026-11-25|Sudah di ERO|2026-11-04|KON-001||
ITM-002|RQ-001|SRG-002|20|2026-11-16||Sudah di ERO|2026-11-04|KON-002||
ITM-003|RQ-002|SRG-001|10|2026-11-16|2026-11-20|Sudah di ERO|2026-11-04|KON-001||
ITM-004|RQ-003|SRG-001|10|2026-11-16|2026-12-02|Sudah di ERO|2026-11-04|KON-001||
ITM-005|RQ-004|BRG-204|4|2026-11-30||Approved|2026-11-12||Y|Menunggu konfirmasi spesifikasi bearing
ITM-006|RQ-005|LAS-021|5|2026-11-30|2026-12-05|Approved|2026-11-13|||
ITM-007|RQ-006|OLI-010|4|2026-11-17|2026-11-25|Sudah di ERO|2026-11-05|KON-003||
ITM-008|RQ-006|BRG-204|6|2026-11-25||Approved|2026-11-05|||
ITM-009|RQ-007|OLI-010|2|2026-11-17|2026-12-02|Sudah di ERO|2026-11-05|KON-003||
ITM-010|RQ-008|KBL-005|3|2026-12-03|2026-12-10|Menunggu Approval||||
ITM-011|RQ-009|OLI-010|2|2026-12-03|2026-12-10|Draft||||
ITM-012|RQ-010|APD-007|2|2026-11-23||Ditolak||||
ITM-013|RQ-011|LAS-021|1|2026-11-20|2026-12-01|Dibatalkan||||`,
    ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan']
  )
  const K = T(
    `KON-001|Produksi|SRG-001|Sudah di ERO|SRL-2611-001|30|0|
KON-002|Produksi|SRG-002|Sudah di ERO|SRL-2611-001|20|0|
KON-003|Maintenance|OLI-010|Sudah di ERO|SRL-2611-002|6|2|Supplier tidak bisa kirim sisa 2 jerigen`,
    ['id', 'dept', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan']
  )
  const L = T(
    `SRL-2611-001|Produksi|2026-11-16
SRL-2611-002|Maintenance|2026-11-17`,
    ['no', 'dept', 'est']
  )
  const KD = T(
    `KON-001|15|0|Wati Handayani||2026-11-16
KON-002|20|5|Wati Handayani|Supplier kirim 25, kelebihan 5 dicatat terpisah|2026-11-16
KON-003|4|0|Joko Susilo||2026-11-17`,
    ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl']
  )
  const SR = T(
    `ITM-003|10|Siti Rahma
ITM-002|20|Andi Saputra`,
    ['item', 'qty', 'to']
  )
  const nmOf = id => U.find(u => u.id == id)?.n || id

  // Tambahan data contoh: SRL-2611-003 dengan 20 barang
  {
    const A = [
      ['GRD-101', 'Mata Gerinda Potong 4 inci', 'Pcs', 0], ['GRD-102', 'Mata Gerinda Poles 4 inci', 'Pcs', 0],
      ['BOR-201', 'Mata Bor HSS 8mm', 'Pcs', 0], ['BOR-202', 'Mata Bor HSS 10mm', 'Pcs', 0],
      ['BLT-301', 'Baut Hex M10x50', 'Box', 1], ['BLT-302', 'Mur Hex M10', 'Box', 1],
      ['BLT-303', 'Ring Plat M10', 'Box', 1], ['SLG-401', 'Selang Hidrolik 1/2 inci', 'Meter', 0],
      ['SLG-402', 'Klem Selang 1 inci', 'Pcs', 0], ['FTG-501', 'Fitting Nipple 1/2 inci', 'Pcs', 0],
      ['BRG-205', 'Bearing 6205', 'Pcs', 1], ['BRG-206', 'Bearing 6206', 'Pcs', 1],
      ['SEL-601', 'Oil Seal 35x52x7', 'Pcs', 1], ['VBT-401', 'V-Belt B-52', 'Pcs', 1],
      ['KBL-006', 'Kabel NYAF 1.5mm', 'Roll', 0], ['LMP-701', 'Lampu LED Highbay 100W', 'Pcs', 0],
      ['CTR-801', 'Kontaktor 3P 25A', 'Pcs', 0], ['SKR-901', 'Sekring Cartridge 10A', 'Box', 1],
      ['LKT-101', 'Lakban Isolasi Hitam', 'Roll', 0], ['PNT-201', 'Cat Marking Kuning', 'Kaleng', 0],
    ]
    const P = ['andi.prod', 'siti.prod', 'rudi.prod']
    const no = 'SRL-2611-003'
    for (let n = 0; n < 6; n++)
      R.push({ id: 'RQ-0' + (12 + n), by: P[n % 3], tgl: n < 3 ? '2026-11-14' : '2026-11-15', st: 'Disetujui', cat: '' })
    L.push({ no, dept: 'Produksi', est: '2026-11-24' })
    A.forEach(([k, nama, sat, buf], i) => {
      M.push({ k, n: nama, sat, buf: String(buf), kons: '0', lead: String(3 + (i % 4)) })
      const kid = 'KON-' + String(5 + i).padStart(3, '0')
      const rs = i % 2 ? [i % 3] : [i % 3, (i + 1) % 3]
      const dt = addDays('2026-11-20', i % 6)
      let tot = 0
      rs.forEach((r, j) => {
        const q = j ? ((i * 5) % 6) + 1 : ((i * 7) % 9) + 2
        const id = 'ITM-' + String(I.length + 1).padStart(3, '0')
        tot += q
        I.push({
          id, req: 'RQ-0' + (12 + r + (i < 10 ? 0 : 3)), kode: k, qty: String(q), datang: dt,
          pakai: buf ? '' : addDays(dt, 3 + (i % 5)), status: 'Sudah di ERO',
          appr: '2026-11-16T08:' + String(10 + i).padStart(2, '0'), kon: kid, tahan: '', alasan: '',
        })
        if (i < 3 && !j) SR.push({ item: id, qty: String(q), to: nmOf(P[r]) })
      })
      K.push({ id: kid, dept: 'Produksi', kode: k, tahap: 'Sudah di ERO', srl: no, ero: String(tot), tutup: '0', alasan: '' })
      if (i < 6)
        KD.push({ kon: kid, qty: String(tot), lebih: '0', by: 'Wati Handayani', cat: '', tgl: '2026-11-18' })
      else if (i < 12)
        KD.push({ kon: kid, qty: String(Math.floor(tot / 2) || 1), lebih: '0', by: 'Joko Susilo', cat: '', tgl: '2026-11-21' })
    })
  }
  // Data contoh menu Validasi SRL: dua SRL dari Admin Dept yang menunggu diperiksa Admin Warehouse
  {
    const V = [
      { no: 'SRL-2611-004', dept: 'Maintenance', est: '2026-12-01', lines: [
        ['APD-007', [['RQ-018', 'maya.mt', 5], ['RQ-019', 'rina.mt', 3]]],
        ['KBL-005', [['RQ-018', 'maya.mt', 10]]],
        ['SRG-001', [['RQ-019', 'rina.mt', 12]]],
      ] },
      { no: 'SRL-2611-005', dept: 'Produksi', est: '2026-12-03', lines: [
        ['SRG-002', [['RQ-020', 'andi.prod', 6], ['RQ-021', 'siti.prod', 4]]],
        ['LAS-021', [['RQ-021', 'siti.prod', 8]]],
      ] },
    ]
    const made = new Set()
    let kn = Math.max(...K.map(k => +k.id.slice(4)))
    V.forEach((v, vi) => {
      L.push({ no: v.no, dept: v.dept, est: v.est })
      v.lines.forEach(([kode, rs], li) => {
        const kid = 'KON-' + String(++kn).padStart(3, '0')
        const buf = M.find(m => m.k == kode).buf == '1'
        let tot = 0
        rs.forEach(([rid, by, q], j) => {
          if (!made.has(rid)) {
            made.add(rid)
            R.push({ id: rid, by, tgl: '2026-11-19', st: 'Disetujui', cat: '' })
          }
          tot += q
          I.push({
            id: 'ITM-' + String(I.length + 1).padStart(3, '0'), req: rid, kode, qty: String(q),
            datang: addDays('2026-11-27', vi * 2 + li), pakai: buf ? '' : addDays('2026-12-04', vi * 2 + li + j),
            status: 'Validasi Warehouse', appr: '2026-11-20T08:' + String(10 + vi * 10 + li * 2 + j).padStart(2, '0'),
            kon: kid, tahan: '', alasan: '',
          })
        })
        K.push({ id: kid, dept: v.dept, kode, tahap: 'Validasi Warehouse', srl: v.no, ero: String(tot), tutup: '0', alasan: '' })
      })
    })
  }
  K.forEach(k => (k.by = nmOf(k.dept == 'Produksi' ? 'dewi.admin' : 'yani.admin')))
  SR.forEach((s, n) => (s.tgl = addDays('2026-11-18', n % 3)))

  const db = { U, HP, M, R, I, K, L, KD, SR, RM: [] }
  // Contoh riwayat pengingat
  const sel = makeSel(db)
  db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).forEach((i, n) => {
    for (let c = 0; c < n % 4; c++)
      db.RM.push({ item: i.id, by: 'Wati Handayani', at: addDays(TODAY, -((n % 4) - c)) + 'T09:00' })
  })
  return db
}
