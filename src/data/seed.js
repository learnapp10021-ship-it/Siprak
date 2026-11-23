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
agus.spv|Agus Prasetyo|Warehouse|Spv Warehouse|
dika.prod|Dika Pratama|Produksi|User|budi.spv
lina.mt|Lina Wulandari|Maintenance|User|tono.spv
eko.prod|Eko Nugroho|Produksi|User|budi.spv`,
    ['id', 'n', 'dept', 'role', 'boss']
  )
  const HP = {
    'hendra.mgr': '6281234560001', 'budi.spv': '6281234560002', 'andi.prod': '6281234560003',
    'siti.prod': '6281234560004', 'rudi.prod': '6281234560005', 'dewi.admin': '6281234560006',
    'tono.spv': '6281234560007', 'maya.mt': '6281234560008', 'rina.mt': '6281234560009',
    'yani.admin': '6281234560010', 'wati.wh': '6281234560011', 'joko.wh': '6281234560012',
    'agus.spv': '6281234560013', 'dika.prod': '6281234560014', 'lina.mt': '6281234560015',
    'eko.prod': '6281234560016',
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
    `KON-001|15|0|wati.wh||2026-11-16
KON-002|20|5|wati.wh|Supplier kirim 25, kelebihan 5 dicatat terpisah|2026-11-16
KON-003|4|0|joko.wh||2026-11-17`,
    ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl']
  )
  const SR = T(
    `ITM-003|10|siti.prod
ITM-002|20|andi.prod`,
    ['item', 'qty', 'to']
  )

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
        if (i < 3 && !j) SR.push({ item: id, qty: String(q), to: P[r] })
      })
      K.push({ id: kid, dept: 'Produksi', kode: k, tahap: 'Sudah di ERO', srl: no, ero: String(tot), tutup: '0', alasan: '' })
      if (i < 6)
        KD.push({ kon: kid, qty: String(tot), lebih: '0', by: 'wati.wh', cat: '', tgl: '2026-11-18' })
      else if (i < 12)
        KD.push({ kon: kid, qty: String(Math.floor(tot / 2) || 1), lebih: '0', by: 'joko.wh', cat: '', tgl: '2026-11-21' })
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
  K.forEach(k => (k.by = k.dept == 'Produksi' ? 'dewi.admin' : 'yani.admin'))
  SR.forEach((s, n) => (s.tgl = addDays('2026-11-18', n % 3)))

  // ===== Data contoh lengkap: semua tahap proses, kedua departemen =====
  {
    const B = '2026-11-23'
    const WT = 'Wati Handayani', JK = 'Joko Susilo' // hanya untuk teks alasan; kolom relasi memakai ID
    const WI = 'wati.wh', JI = 'joko.wh'
    U.find(u => u.id == 'eko.prod').off = true // contoh akun nonaktif
    const buf = k => M.find(m => m.k == k).buf == '1'
    const rq = (id, by, tgl, st, cat = '') => R.push({ id, by, tgl, st, cat })
    const it = (req, kode, qty, o = {}) => {
      const id = 'ITM-' + String(I.length + 1).padStart(3, '0')
      I.push({ id, req, kode, qty: String(qty), datang: '', pakai: '', status: 'Draft', appr: '', kon: '', tahan: '', alasan: '', ...o })
      return id
    }
    // tanggal butuh: non-buffer wajib punya tgl pakai
    const need = (kode, dDatang, dPakai) => ({ datang: addDays(B, dDatang), pakai: buf(kode) ? '' : addDays(B, dPakai) })
    const apr = (tgl, m) => tgl + 'T08:' + String(m).padStart(2, '0')

    // --- Menunggu approval atasan (Produksi: Budi, Maintenance: Tono)
    rq('RQ-022', 'dika.prod', addDays(B, -1), 'Menunggu Approval')
    ;[['SRG-001', 20, 10, 14], ['APD-007', 10, 12, 0], ['KBL-006', 4, 9, 13]].forEach(([k, q, a, b]) => it('RQ-022', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    rq('RQ-023', 'siti.prod', B, 'Menunggu Approval')
    ;[['LAS-021', 15, 8, 12], ['GRD-101', 6, 8, 11]].forEach(([k, q, a, b]) => it('RQ-023', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    rq('RQ-024', 'maya.mt', B, 'Menunggu Approval')
    ;[['BRG-205', 4, 9, 0], ['SEL-601', 6, 8, 0]].forEach(([k, q, a, b]) => it('RQ-024', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    rq('RQ-025', 'lina.mt', addDays(B, -1), 'Menunggu Approval')
    ;[['CTR-801', 2, 8, 12], ['LMP-701', 3, 10, 14], ['KBL-005', 6, 7, 10]].forEach(([k, q, a, b]) => it('RQ-025', k, q, { ...need(k, a, b), status: 'Menunggu Approval' }))
    // --- Draft
    rq('RQ-026', 'rudi.prod', B, 'Draft')
    it('RQ-026', 'OLI-010', 2, { ...need('OLI-010', 9, 13), status: 'Draft' })
    rq('RQ-027', 'rina.mt', addDays(B, -1), 'Draft')
    ;[['FTG-501', 12, 9, 12], ['SLG-402', 6, 8, 11]].forEach(([k, q, a, b]) => it('RQ-027', k, q, { ...need(k, a, b), status: 'Draft' }))
    // --- Ditolak (catatan atasan) dan Dibatalkan
    rq('RQ-028', 'andi.prod', addDays(B, -4), 'Ditolak', 'Stok masih ada di gudang line 2, cek dulu sebelum request')
    it('RQ-028', 'BOR-201', 10, { ...need('BOR-201', 6, 10), status: 'Ditolak' })
    rq('RQ-029', 'lina.mt', addDays(B, -3), 'Ditolak', 'Anggaran bulan ini sudah habis, ajukan lagi bulan depan')
    it('RQ-029', 'VBT-401', 2, { ...need('VBT-401', 7, 0), status: 'Ditolak' })
    rq('RQ-030', 'dika.prod', addDays(B, -6), 'Dibatalkan')
    it('RQ-030', 'GRD-102', 5, { ...need('GRD-102', 6, 9), status: 'Dibatalkan' })

    // --- Pool Admin Dept: disetujui, belum dibuat di ERO (termasuk ditahan)
    const ap = (id, by, d, rows) => {
      rq(id, by, addDays(B, d), 'Disetujui')
      rows.forEach(([k, q, a, b, o]) => it(id, k, q, { ...need(k, a, b), status: 'Approved', appr: apr(addDays(B, d + 1), 15), ...o }))
    }
    ap('RQ-031', 'andi.prod', -3, [['BOR-202', 8, 7, 10], ['BLT-301', 3, 8, 0], ['SLG-401', 30, 10, 14, { tahan: 'Y', alasan: 'Menunggu konfirmasi panjang selang dari produksi' }]])
    ap('RQ-032', 'rudi.prod', -2, [['GRD-102', 10, 7, 9], ['FTG-501', 20, 8, 11]])
    ap('RQ-033', 'maya.mt', -3, [['BRG-206', 4, 8, 0], ['VBT-401', 2, 7, 0], ['CTR-801', 2, 8, 12]])
    ap('RQ-034', 'lina.mt', -2, [['LMP-701', 3, 9, 13], ['FTG-501', 10, 8, 11, { tahan: 'Y', alasan: 'Tunggu ukuran fitting dari teknisi' }]])
    // Dikeluarkan Warehouse dari SRL-2611-006 (semua barang dikeluarkan) -> kembali ke pool dengan alasan
    L.push({ no: 'SRL-2611-006', dept: 'Maintenance', est: addDays(B, 7) })
    rq('RQ-035', 'rina.mt', addDays(B, -5), 'Disetujui')
    ;[['SKR-901', 3, 7, 0], ['BRG-205', 6, 9, 0]].forEach(([k, q, a, b], n) => {
      it('RQ-035', k, q, { ...need(k, a, b), status: 'Approved', appr: apr(addDays(B, -4), 20 + n), alasan: 'Dikeluarkan Warehouse (' + WT + ') dari SRL-2611-006: Jumlah tidak sesuai dengan permintaan' })
    })

    let kn = Math.max(...K.map(k => +k.id.slice(4)))
    const kon = (dept, kode, tahap, srl, ero, o = {}) => {
      const id = 'KON-' + String(++kn).padStart(3, '0')
      K.push({ id, dept, kode, tahap, srl, ero: String(ero), tutup: '0', alasan: '', by: dept == 'Produksi' ? 'dewi.admin' : 'yani.admin', ...o })
      return id
    }
    kon('Maintenance', 'SKR-901', 'Dikeluarkan', 'SRL-2611-006', 0, { alasan: 'Jumlah tidak sesuai dengan permintaan' })
    kon('Maintenance', 'BRG-205', 'Dikeluarkan', 'SRL-2611-006', 0, { alasan: 'Jumlah tidak sesuai dengan permintaan' })

    // --- SRL sudah di ERO. lines: [kode, [[req, jumlah], ...], jumlah datang (null = semua), kelebihan, catatan, tutup, alasan tutup]
    const srl = (no, dept, est, tglReq, reqs, lines, tglDatang, by) => {
      L.push({ no, dept, est })
      Object.entries(reqs).forEach(([id, u]) => rq(id, u, addDays(B, tglReq), 'Disetujui'))
      lines.forEach(([kode, rs, dtg, lebih, cat, tutup, alasan], li) => {
        let tot = 0
        const kid = 'KON-' + String(kn + 1).padStart(3, '0')
        rs.forEach(([rid, q], j) => {
          tot += q
          it(rid, kode, q, { datang: est, pakai: buf(kode) ? '' : addDays(est, 4 + li + j), status: 'Sudah di ERO', appr: apr(addDays(B, tglReq + 1), 10 + li * 3 + j), kon: kid })
        })
        kon(dept, kode, 'Sudah di ERO', no, tot, tutup ? { tutup: String(tutup), alasan } : {})
        const dq = dtg == null ? tot : dtg
        if (dq > 0 || lebih) KD.push({ kon: kid, qty: String(dq), lebih: String(lebih || 0), by, cat: cat || '', tgl: tglDatang })
      })
    }
    // 1) Selesai penuh: barang datang semua dan sudah diserahkan semua
    srl('SRL-2611-007', 'Produksi', addDays(B, -8), -14, { 'RQ-036': 'andi.prod', 'RQ-037': 'siti.prod' }, [
      ['GRD-101', [['RQ-036', 6], ['RQ-037', 4]]],
      ['BOR-201', [['RQ-036', 4], ['RQ-037', 3]]],
      ['KBL-006', [['RQ-037', 5]], null, 2, 'Supplier kirim lebih 2 roll, dicatat terpisah'],
    ], addDays(B, -7), WI)
    // 2) Sebagian datang, ada barang ditutup sisanya
    srl('SRL-2611-008', 'Maintenance', addDays(B, -4), -10, { 'RQ-038': 'maya.mt', 'RQ-039': 'rina.mt' }, [
      ['BRG-205', [['RQ-038', 4], ['RQ-039', 6]], 6],
      ['SEL-601', [['RQ-038', 3], ['RQ-039', 5]]],
      ['CTR-801', [['RQ-038', 2]], 0, 0, '', 2, 'Supplier tidak bisa kirim, item discontinue'],
    ], addDays(B, -3), JI)
    // 3) Terlambat: estimasi sudah lewat, belum ada kedatangan
    srl('SRL-2611-009', 'Produksi', addDays(B, -3), -9, { 'RQ-040': 'dika.prod', 'RQ-041': 'rudi.prod' }, [
      ['LAS-021', [['RQ-040', 10], ['RQ-041', 5]], 0],
      ['OLI-010', [['RQ-040', 4]], 0],
    ], B, WI)
    // 4) Belum waktunya datang (estimasi ke depan)
    srl('SRL-2611-010', 'Maintenance', addDays(B, 5), -3, { 'RQ-042': 'maya.mt' }, [
      ['LKT-101', [['RQ-042', 6]], 0],
      ['PNT-201', [['RQ-042', 3]], 0],
      ['KBL-006', [['RQ-042', 2]], 0],
    ], B, JI)
    // 5) Datang sebagian hari ini, belum diserahkan
    srl('SRL-2611-011', 'Produksi', addDays(B, -1), -6, { 'RQ-043': 'andi.prod', 'RQ-044': 'dika.prod' }, [
      ['SLG-402', [['RQ-043', 8], ['RQ-044', 6]], 8],
      ['LMP-701', [['RQ-043', 2], ['RQ-044', 2]], 4],
      ['PNT-201', [['RQ-044', 5]], 0],
    ], B, JI)

    // Serah terima: hitung jatah dengan aturan aplikasi supaya tidak melebihi jatah
    const sl = makeSel({ U, HP, M, R, I, K, L, KD, SR, RM: [] })
    const to = it => R.find(r => r.id == it.req).by
    const serah = (it, q, d) => q > 0 && SR.push({ item: it.id, qty: String(q), to: to(it), tgl: addDays(B, d) })
    I.filter(i => ['SRL-2611-007'].includes(sl.KN(i.kon)?.srl)).forEach((i, n) => serah(i, sl.siap(i), -6 + (n % 3)))
    I.filter(i => sl.KN(i.kon)?.srl == 'SRL-2611-008').forEach((i, n) => serah(i, n % 2 ? Math.ceil(sl.siap(i) / 2) : 0, -2))
    I.filter(i => sl.KN(i.kon)?.srl == 'SRL-2611-011').forEach((i, n) => serah(i, n == 0 ? Math.floor(sl.siap(i) / 2) : 0, 0))
  }

  const db = { U, HP, M, R, I, K, L, KD, SR, RM: [] }
  // Contoh riwayat pengingat
  const sel = makeSel(db)
  db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).forEach((i, n) => {
    for (let c = 0; c < n % 4; c++)
      db.RM.push({ item: i.id, by: 'wati.wh', at: addDays(TODAY, -((n % 4) - c)) + 'T09:00' })
  })
  return db
}
