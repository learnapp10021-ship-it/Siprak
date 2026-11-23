// =====================================================================================
// SIPRAK -- relasi antartabel dan aturan data
// -------------------------------------------------------------------------------------
// Dipakai di dua tempat:
//  1. locked_ (server.gs): setelah sebuah aksi dijalankan dan SEBELUM menulis, baris yang berubah diperiksa
//     terhadap keadaan sesudah perubahan. Pelanggaran = aksi ditolak, tidak ada yang ditulis.
//  2. auditData(): memeriksa SELURUH database (mis. setelah seseorang mengedit sheet manual).
//
// Semua kolom relasi berisi ID, bukan nama:
//
//   Users ─┬─< Users.boss        (atasan; ber-role Atasan)
//          ├─< Request.by        (pemohon)
//          ├─< Konsolidasi.by    (Admin Dept pembuat SRL)
//          ├─< Kedatangan.by     (Admin Warehouse pencatat)
//          ├─< SerahTerima.to    (penerima = pemohon barang)
//          └─< Pengingat.by      (pengirim pengingat)
//   Master ─┬─< Item.kode
//           └─< Konsolidasi.kode
//   Request ──< Item.req
//   SRL ──────< Konsolidasi.srl
//   Konsolidasi ─┬─< Item.kon         (kosong sebelum barang masuk SRL)
//                └─< Kedatangan.kon
//   Item ─┬─< SerahTerima.item
//         └─< Pengingat.item
//
// Status Item.status dan Konsolidasi.tahap berjalan searah:
//   Draft > Menunggu Approval > Approved > Validasi Warehouse > Sudah di ERO
//   (Ditolak/Dibatalkan keluar dari alur; barang yang dikeluarkan Warehouse kembali ke Approved)
//
// File ini hanya berisi literal dan fungsi (aman terhadap urutan penggabungan).
// =====================================================================================

const ENUM = {
  role: ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse'],
  reqSt: ['Draft', 'Menunggu Approval', 'Disetujui', 'Ditolak', 'Dibatalkan'],
  itemSt: ['Draft', 'Menunggu Approval', 'Approved', 'Validasi Warehouse', 'Sudah di ERO', 'Ditolak', 'Dibatalkan'],
  tahap: ['Validasi Warehouse', 'Sudah di ERO', 'Dikeluarkan'],
}
const IN_KON = ['Validasi Warehouse', 'Sudah di ERO'] // status Item yang wajib terhubung ke Konsolidasi
const DEAD = ['Ditolak', 'Dibatalkan'] // tidak dihitung sebagai jumlah yang harus datang

// Aturan kolom. Format: jenis[?][:argumen]   ("?" = boleh kosong)
//   req teks wajib   text teks bebas   date YYYY-MM-DD   dtm tanggal atau tanggal-jam
//   pos angka > 0   num0 angka >= 0   int0 bilangan bulat   flag 0/1   phone 628xxxxxxxxx
//   enum:<ENUM>   id:<PREFIX> (mis. RQ-001)   fk:<tabel> (harus ada di tabel itu)
const REL = {
  U: { id: 'req', n: 'req', dept: 'req', role: 'enum:role', boss: 'fk?:U', hp: 'phone?' },
  M: { k: 'req', n: 'req', sat: 'req', buf: 'flag', kons: 'flag', lead: 'int0' },
  R: { id: 'id:RQ', by: 'fk:U', tgl: 'date', st: 'enum:reqSt', cat: 'text', at: 'dtm?' },
  I: { id: 'id:ITM', req: 'fk:R', kode: 'fk:M', qty: 'pos', datang: 'date', pakai: 'date?', status: 'enum:itemSt',
       appr: 'dtm?', kon: 'fk?:K', alasan: 'text' },
  K: { id: 'id:KON', dept: 'req', by: 'fk:U', kode: 'fk:M', tahap: 'enum:tahap', srl: 'fk:L', ero: 'num0', tutup: 'num0', alasan: 'text' },
  L: { no: 'req', dept: 'req', est: 'date?' },
  KD: { id: 'id:KD', kon: 'fk:K', qty: 'num0', lebih: 'num0', by: 'fk:U', cat: 'text', tgl: 'date', at: 'dtm?' },
  SR: { id: 'id:SR', item: 'fk:I', qty: 'pos', to: 'fk:U', tgl: 'date', at: 'dtm?' },
  RM: { id: 'id:RM', item: 'fk:I', by: 'fk:U', at: 'dtm' },
}
const PAT = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  dtm: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/,
  phone: /^628\d{8,11}$/,
  num: /^\d+(\.\d+)?$/,
  int: /^\d+$/,
  flag: /^[01]$/,
}
const EPS = 1e-9

// ---------- bantu ----------
function vHas_(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k)
}
function vSum_(a, f) {
  return a.reduce((s, x) => s + (+f(x) || 0), 0)
}
function vPush_(m, k, v) {
  ;(m[k] = m[k] || []).push(v)
}

// Peta bantu: kunci -> baris per tabel, anak per induk, log per induk
function vState_(tables) {
  const st = { by: {}, kids: {}, kd: {}, sr: {}, names: {} }
  TABLES.forEach(t => {
    const m = (st.by[t] = {})
    ;(tables[t] || []).forEach(r => (m[r[SCHEMA[t].key]] = r))
  })
  ;(tables.U || []).forEach(u => (st.names[String(u.n).toLowerCase().trim()] = u.id))
  ;(tables.I || []).forEach(i => i.kon && vPush_(st.kids, i.kon, i))
  ;(tables.KD || []).forEach(x => vPush_(st.kd, x.kon, x))
  ;(tables.SR || []).forEach(x => vPush_(st.sr, x.item, x))
  return st
}

// Periksa satu nilai terhadap aturan kolom; kembalikan pesan galat atau ''
function vCell_(rule, v, st) {
  const m = /^([a-z0-9]+)(\?)?(?::(.+))?$/.exec(rule)
  const kind = m[1], opt = !!m[2], arg = m[3]
  if (v === '') return opt || kind === 'text' ? '' : 'wajib diisi'
  switch (kind) {
    case 'req': case 'text': return ''
    case 'date': return PAT.date.test(v) ? '' : 'harus tanggal YYYY-MM-DD'
    case 'dtm': return PAT.dtm.test(v) ? '' : 'harus tanggal (YYYY-MM-DD) atau tanggal-jam'
    case 'phone': return PAT.phone.test(v) ? '' : 'nomor WA harus berbentuk 628xxxxxxxxx'
    case 'flag': return PAT.flag.test(v) ? '' : 'harus 0 atau 1'
    case 'pos': return PAT.num.test(v) && +v > 0 ? '' : 'harus angka lebih dari 0'
    case 'num0': return PAT.num.test(v) ? '' : 'harus angka 0 atau lebih'
    case 'int0': return PAT.int.test(v) ? '' : 'harus bilangan bulat 0 atau lebih'
    case 'enum': return ENUM[arg].indexOf(v) >= 0 ? '' : "'" + v + "' tidak dikenal (pilihan: " + ENUM[arg].join(', ') + ')'
    case 'id': return new RegExp('^' + arg + '-\\d{3,}$').test(v) ? '' : 'format harus ' + arg + '-001'
    case 'fk':
      if (vHas_(st.by[arg], v)) return ''
      return "'" + v + "' tidak ada di sheet " + SCHEMA[arg].sheet +
        (arg === 'U' && vHas_(st.names, v.toLowerCase().trim()) ? ' (ini NAMA pengguna; kolom harus berisi ID. Jalankan migrate() lalu auditData())' : '')
  }
  return 'aturan tidak dikenal: ' + rule
}

function vLabel_(t, row) {
  return SCHEMA[t].sheet + ' ' + row[SCHEMA[t].key]
}

// Periksa baris-baris: aturan kolom, lalu aturan lintas tabel bila kolomnya sah. rows = [{ t, row }]
// Hasil: [{ m: pesan, c: true bila akibat benturan jumlah dengan pengguna lain }]
function vRows_(st, rows) {
  const errs = []
  rows.forEach(x => {
    const t = x.t, row = x.row, rules = REL[t], before = errs.length
    const add = (msg, c) => errs.push({ m: vLabel_(t, row) + ': ' + msg, c: !!c })
    Object.keys(rules).forEach(col => {
      const msg = vCell_(rules[col], row[col] == null ? '' : String(row[col]), st)
      if (msg) add('kolom ' + col + ' ' + msg)
    })
    if (errs.length === before) vLinks_(t, row, st, add)
  })
  return errs
}

// Aturan lintas tabel untuk satu baris
function vLinks_(t, row, st, add) {
  if (t === 'U' && row.boss) {
    const boss = st.by.U[row.boss]
    if (row.boss === row.id) add('atasan tidak boleh diri sendiri')
    else if (boss && boss.role !== 'Atasan') add("atasan '" + row.boss + "' harus ber-role Atasan")
  }

  if (t === 'I') {
    const inKon = IN_KON.indexOf(row.status) >= 0
    if (inKon && !row.kon) add('status ' + row.status + ' wajib terhubung ke Konsolidasi (kolom kon)')
    if (!inKon && row.kon) add("kolom kon harus kosong untuk status '" + row.status + "'")
    const k = row.kon && st.by.K[row.kon]
    if (k && k.kode !== row.kode) add('kode barang ' + row.kode + ' tidak sama dengan Konsolidasi ' + k.id + ' (' + k.kode + ')')
    if (k && inKon && k.tahap !== row.status) add("status '" + row.status + "' tidak sama dengan tahap SRL '" + k.tahap + "'")
  }

  if (t === 'K') {
    const l = st.by.L[row.srl]
    if (l && l.dept !== row.dept) add('departemen ' + row.dept + ' tidak sama dengan SRL ' + l.no + ' (' + l.dept + ')')
    const kids = st.kids[row.id] || []
    if (row.tahap === 'Dikeluarkan' && kids.length) add("tahap 'Dikeluarkan' tetapi masih ada barang di dalamnya")
    if (row.tahap !== 'Dikeluarkan')
      kids.forEach(i => {
        if (i.status !== row.tahap) add('barang ' + i.id + " berstatus '" + i.status + "' tetapi tahap SRL '" + row.tahap + "'")
      })
    vArrival_(row, st, add)
  }

  if (t === 'KD') {
    const k = st.by.K[row.kon]
    if (!(+row.qty > 0) && !(+row.lebih > 0)) add('isi qty datang atau qty lebih')
    if (k && k.tahap !== 'Sudah di ERO') add('SRL ' + k.srl + " belum divalidasi Warehouse (tahap '" + k.tahap + "')")
    if (k) vArrival_(k, st, add)
  }

  if (t === 'SR') {
    const it = st.by.I[row.item]
    if (!it) return
    if (it.status !== 'Sudah di ERO') add("barang '" + it.id + "' belum berstatus Sudah di ERO")
    const handed = vSum_(st.sr[it.id] || [], s => s.qty)
    if (handed > +it.qty + EPS) add('total diserahkan ' + handed + ' melebihi qty request ' + it.qty, true)
    const k = st.by.K[it.kon]
    if (k) {
      const out = vSum_(st.kids[k.id] || [], i => vSum_(st.sr[i.id] || [], s => s.qty))
      const got = vSum_(st.kd[k.id] || [], d => d.qty)
      if (out > got + EPS) add('total diserahkan ' + out + ' melebihi barang yang sudah datang ' + got, true)
    }
  }
}

// Barang datang + sisa yang ditutup tidak boleh melebihi total yang diminta
function vArrival_(k, st, add) {
  const total = vSum_((st.kids[k.id] || []).filter(i => DEAD.indexOf(i.status) < 0), i => i.qty)
  const got = vSum_(st.kd[k.id] || [], d => d.qty)
  const closed = +k.tutup || 0
  if (got + closed > total + EPS) add('datang ' + got + ' + ditutup ' + closed + ' melebihi total request ' + total, true)
}

// Seluruh database (audit). tables = { U: [...], ... }
function validateAll_(tables) {
  const rows = []
  TABLES.forEach(t => (tables[t] || []).forEach(r => rows.push({ t: t, row: r })))
  return vRows_(vState_(tables), rows)
}

// Hanya baris yang diubah sebuah aksi, diperiksa pada keadaan sesudah perubahan. d = tabel kerja, ch = hasil diff_
function validateChange_(d, ch) {
  const rows = []
  TABLES.forEach(t => {
    ch[t].add.forEach(r => rows.push({ t: t, row: r }))
    ch[t].upd.forEach(u => rows.push({ t: t, row: u.after }))
  })
  return vRows_(vState_(d), rows)
}
