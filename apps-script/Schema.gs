/**
 * SIPRAK — skema database (satu-satunya sumber kebenaran struktur data).
 *
 * File ini hanya berisi literal, tanpa memanggil fungsi file lain, jadi aman terhadap urutan muat file Apps Script.
 *
 * Relasi antartabel (semua kunci asing memakai ID, bukan nama):
 *
 *   Users ─┬─< Users.boss               (atasan; ber-role Atasan)
 *          ├─< Request.by               (pemohon)
 *          ├─< Konsolidasi.by           (Admin Dept pembuat SRL)
 *          ├─< Kedatangan.by            (Admin Warehouse pencatat)
 *          ├─< SerahTerima.to           (penerima = pemohon)
 *          └─< Pengingat.by             (pengirim pengingat)
 *   Master ─┬─< Item.kode
 *           └─< Konsolidasi.kode
 *   Request ──< Item.req
 *   SRL ──────< Konsolidasi.srl         (satu SRL boleh memuat banyak barang/Konsolidasi)
 *   Konsolidasi ─┬─< Item.kon            (baris request yang digabung; kosong sebelum masuk SRL)
 *                └─< Kedatangan.kon
 *   Item ─┬─< SerahTerima.item
 *         └─< Pengingat.item
 *
 * Alur status (Item.status dan Konsolidasi.tahap berjalan searah):
 *   Draft → Menunggu Approval → Approved → Validasi Warehouse → Sudah di ERO
 *   (Ditolak/Dibatalkan keluar dari alur; barang yang dikeluarkan Warehouse kembali ke Approved)
 */

var SCHEMA = {
  U:  { sheet: 'Users',       key: 'id',  cols: ['id', 'n', 'dept', 'role', 'boss', 'hp', 'off'] },
  M:  { sheet: 'Master',      key: 'k',   cols: ['k', 'n', 'sat', 'buf', 'kons', 'lead'] },
  R:  { sheet: 'Request',     key: 'id',  cols: ['id', 'by', 'tgl', 'st', 'cat'] },
  I:  { sheet: 'Item',        key: 'id',  cols: ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan'] },
  K:  { sheet: 'Konsolidasi', key: 'id',  cols: ['id', 'dept', 'by', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan'] },
  L:  { sheet: 'SRL',         key: 'no',  cols: ['no', 'dept', 'est'] },
  KD: { sheet: 'Kedatangan',  key: null,  cols: ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl'] },
  SR: { sheet: 'SerahTerima', key: null,  cols: ['item', 'qty', 'to', 'tgl'] },
  RM: { sheet: 'Pengingat',   key: null,  cols: ['item', 'by', 'at'] }
};
var TABLES = Object.keys(SCHEMA);

/** Nilai yang diperbolehkan untuk kolom bertipe enum. */
var ENUM = {
  role:   ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse'],
  reqSt:  ['Draft', 'Menunggu Approval', 'Disetujui', 'Ditolak', 'Dibatalkan'],
  itemSt: ['Draft', 'Menunggu Approval', 'Approved', 'Validasi Warehouse', 'Sudah di ERO', 'Ditolak', 'Dibatalkan'],
  tahap:  ['Validasi Warehouse', 'Sudah di ERO', 'Dikeluarkan']
};

/** Status Item yang sudah tergabung ke Konsolidasi (wajib punya `kon`). */
var IN_KON = ['Validasi Warehouse', 'Sudah di ERO'];
/** Status Item yang tidak dihitung sebagai jumlah yang harus datang. */
var DEAD = ['Ditolak', 'Dibatalkan'];

/**
 * Aturan per kolom. Format: jenis[?][:argumen]   ("?" = boleh kosong)
 *   req  teks wajib       text  teks bebas        date  YYYY-MM-DD        dtm  tanggal atau tanggal-jam
 *   pos  angka > 0        num0  angka >= 0        int0  bilangan bulat    flag 0/1       yn  kosong atau Y
 *   phone 628xxxxxxxxx    enum:<ENUM>             id:<PREFIX> (mis. RQ-001)   fk:<tabel> (harus ada di tabel itu)
 */
var REL = {
  U:  { id: 'req', n: 'req', dept: 'req', role: 'enum:role', boss: 'fk?:U', hp: 'phone?', off: 'yn?' },
  M:  { k: 'req', n: 'req', sat: 'req', buf: 'flag', kons: 'flag', lead: 'int0' },
  R:  { id: 'id:RQ', by: 'fk:U', tgl: 'date', st: 'enum:reqSt', cat: 'text' },
  I:  { id: 'id:ITM', req: 'fk:R', kode: 'fk:M', qty: 'pos', datang: 'date', pakai: 'date?', status: 'enum:itemSt',
        appr: 'dtm?', kon: 'fk?:K', tahan: 'yn?', alasan: 'text' },
  K:  { id: 'id:KON', dept: 'req', by: 'fk:U', kode: 'fk:M', tahap: 'enum:tahap', srl: 'fk:L', ero: 'num0', tutup: 'num0', alasan: 'text' },
  L:  { no: 'req', dept: 'req', est: 'date?' },
  KD: { kon: 'fk:K', qty: 'num0', lebih: 'num0', by: 'fk:U', cat: 'text', tgl: 'date' },
  SR: { item: 'fk:I', qty: 'pos', to: 'fk:U', tgl: 'date' },
  RM: { item: 'fk:I', by: 'fk:U', at: 'dtm' }
};

var PAT = {
  date:  /^\d{4}-\d{2}-\d{2}$/,
  dtm:   /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/,
  phone: /^628\d{8,11}$/,
  num:   /^\d+(\.\d+)?$/,
  int:   /^\d+$/,
  flag:  /^[01]$/
};
