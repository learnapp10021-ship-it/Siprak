/**
 * SIPRAK — backend Apps Script, database = Google Sheets.
 *
 * Kenapa cepat:
 *  - Setiap tabel dibaca SEKALI dengan getValues() (bukan per baris), lalu disimpan di CacheService.
 *  - Cache dipisah per tabel dan diberi nomor versi: tulis ke satu tabel hanya membuang cache tabel itu.
 *  - Tulis dikumpulkan (batch): banyak perubahan = 1x setValues per tabel, di dalam satu lock.
 *  - Klien cukup memanggil ?fn=ver (murah) untuk tahu ada perubahan; data penuh hanya diambil bila versi berubah.
 *
 * Endpoint (Web App):
 *   GET  ?fn=ver                  -> { ok, ver }
 *   GET  ?fn=all[&ver=N]          -> { ok, ver, same } atau { ok, ver, db }
 *   GET  ?fn=info                 -> { ok, app, gs, tz, ver }   (cek versi kode yang sedang terpasang)
 *   POST {fn:'mutate', ops:[...]} -> { ok, ver, base }   (body dikirim sebagai text/plain agar tanpa preflight CORS)
 *     op = { t:'R', op:'add'|'set', row:{...} }
 *
 * Server menegakkan alur proses (lihat "Aturan alur proses" di bawah): status hanya boleh maju sesuai alur,
 * kolom inti tidak boleh diubah, referensi antar tabel harus ada, dan qty kedatangan/serah terima tidak boleh melebihi jatah.
 * Pengingat WhatsApp (Fonnte), pengaturan, dan cek kesiapan go live ada di Fonnte.gs + Settings.html.
 *
 * Cara pasang: lihat apps-script/README.md
 */

var VERSION = '2.1.0';
var TZ = 'Asia/Jakarta';

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
var CACHE_TTL = 21600;   // 6 jam
var CHUNK = 30000;       // karakter per potongan cache (batas CacheService 100KB/nilai)
var MAX_OPS = 1000;

/* ------------------------------------------------------------------ HTTP */

function doGet(e) {
  var p = (e && e.parameter) || {};
  return run_(p.fn, p, null);
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, err: 'Body bukan JSON yang valid.' }); }
  return run_(body.fn, {}, body);
}

function run_(fn, params, body) {
  try {
    if (fn === 'ver') return json_({ ok: true, ver: getVer_() });
    if (fn === 'info') return json_({ ok: true, app: 'SIPRAK', gs: VERSION, tz: TZ, ver: getVer_() });
    if (fn === 'all') {
      var ver = getVer_();
      if (params.ver && String(params.ver) === ver) return json_({ ok: true, ver: ver, same: true });
      var snap = readAll_();
      return json_({ ok: true, ver: snap.ver, db: toClient_(snap.tables) });
    }
    if (fn === 'mutate') return json_(mutate_(body && body.ops));
    return json_({ ok: false, err: 'fn tidak dikenal: ' + fn });
  } catch (err) {
    if (err && err.conflict) return json_({ ok: false, conflict: true, err: err.message });
    return json_({ ok: false, err: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------------------------------------------- Spreadsheet */

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Ambil sheet; buat (dengan header + format teks) bila belum ada. */
function sheet_(ss, t) {
  var S = SCHEMA[t];
  var sh = ss.getSheetByName(S.sheet);
  if (!sh) {
    sh = ss.insertSheet(S.sheet);
    var w = S.cols.length;
    if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
    // Format teks supaya '2026-11-16' tidak diubah Sheets jadi tanggal dan '007' tidak jadi 7.
    sh.getRange(1, 1, sh.getMaxRows(), w).setNumberFormat('@');
    sh.getRange(1, 1, 1, w).setValues([S.cols]).setFontWeight('bold').setBackground('#E8F0FE');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Jalankan sekali dari editor: membuat semua sheet + header. */
function setup() {
  var ss = ss_();
  TABLES.forEach(function (t) { sheet_(ss, t); });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  if (!PropertiesService.getScriptProperties().getProperty('VER')) bump_(TABLES);
  return 'Sheet siap: ' + TABLES.map(function (t) { return SCHEMA[t].sheet; }).join(', ');
}

/* ------------------------------------------------------------------ Versi */

function getVer_() {
  return PropertiesService.getScriptProperties().getProperty('VER') || '0';
}

function getTv_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('TV') || '{}'); }
  catch (e) { return {}; }
}

/** Naikkan versi global + versi tiap tabel yang berubah (otomatis membuang cache tabel itu). */
function bump_(tables) {
  var props = PropertiesService.getScriptProperties();
  var tv = getTv_();
  var ver = String((+props.getProperty('VER') || 0) + 1);
  tables.forEach(function (t) { tv[t] = ver; });
  props.setProperties({ VER: ver, TV: JSON.stringify(tv) });
  return ver;
}

/**
 * Trigger sederhana: bila seseorang mengedit spreadsheet langsung, cache tabel itu dibuang
 * dan klien akan mengambil data baru pada polling berikutnya.
 */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    var t = TABLES.filter(function (k) { return SCHEMA[k].sheet === name; })[0];
    if (t) bump_([t]);
  } catch (err) { /* abaikan */ }
}

/* ------------------------------------------------------------------ Cache */

function cacheGet_(key) {
  var c = CacheService.getScriptCache();
  var n = +c.get(key + '#n');
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '#' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) {
    var part = got[key + '#' + j];
    if (part == null) return null;
    s += part;
  }
  try { return JSON.parse(s); } catch (e) { return null; }
}

function cachePut_(key, obj) {
  var s = JSON.stringify(obj), put = {}, n = Math.max(1, Math.ceil(s.length / CHUNK));
  for (var i = 0; i < n; i++) put[key + '#' + i] = s.substr(i * CHUNK, CHUNK);
  put[key + '#n'] = String(n);
  try { CacheService.getScriptCache().putAll(put, CACHE_TTL); } catch (e) { /* cache hanya optimasi */ }
}

/* ------------------------------------------------------------------ Baca */

function cell_(v) {
  if (v === true) return 'Y';
  if (v === false || v == null) return '';
  return String(v);
}

function norm_(v) {
  if (v instanceof Date) {
    // Selalu zona Asia/Jakarta (bukan zona spreadsheet) supaya tanggal sama dengan yang dilihat pengguna.
    var hm = Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, hm === '00:00' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
  }
  return v == null ? '' : String(v);
}

function readTable_(ss, t) {
  var S = SCHEMA[t], sh = sheet_(ss, t), last = sh.getLastRow(), w = S.cols.length;
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, w).getValues(), out = [];
  for (var r = 0; r < vals.length; r++) {
    var row = {}, any = false;
    for (var c = 0; c < w; c++) {
      var v = norm_(vals[r][c]);
      if (v !== '') any = true;
      row[S.cols[c]] = v;
    }
    if (!any) continue;                       // lewati baris kosong
    if (S.key && row[S.key] === '') continue; // tabel berkunci harus punya kunci
    out.push(row);
  }
  return out;
}

/** Baca semua tabel; tiap tabel dari cache bila versinya masih sama, kalau tidak dari sheet. */
function readAll_() {
  var ver = getVer_(), tv = getTv_(), ss = null, tables = {};
  TABLES.forEach(function (t) {
    var key = 'T_' + t + '_' + (tv[t] || '0');
    var rows = cacheGet_(key);
    if (!rows) {
      ss = ss || ss_();
      rows = readTable_(ss, t);
      cachePut_(key, rows);
    }
    tables[t] = rows;
  });
  return { ver: ver, tables: tables };
}

/** Bentuk yang dipakai aplikasi: U tanpa hp (dipindah ke peta HP), off menjadi boolean. */
function toClient_(tb) {
  var HP = {};
  var U = tb.U.map(function (u) {
    if (u.hp) HP[u.id] = u.hp;
    var o = { id: u.id, n: u.n, dept: u.dept, role: u.role, boss: u.boss };
    if (u.off) o.off = true;
    return o;
  });
  return { U: U, HP: HP, M: tb.M, R: tb.R, I: tb.I, K: tb.K, L: tb.L, KD: tb.KD, SR: tb.SR, RM: tb.RM };
}

/* ------------------------------------------------------------------ Tulis */

function conflict_(msg) { return { conflict: true, message: msg }; }

/* ------------------------------------------------------- Aturan alur proses
 * Cermin dari src/lib/actions.js. Aplikasi sudah memeriksa di layar, tetapi layar bisa usang
 * (dua orang bekerja bersamaan) atau URL dipanggil langsung. Server adalah penjaga terakhir:
 * pelanggaran ditolak sebagai "conflict" sehingga aplikasi memuat ulang data dan pengguna mengulang.
 */

var ROLES = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse'];

// f = kolom status, add = status awal yang sah, to = status tujuan yang sah dari tiap status.
var FLOW = {
  // Request: Draft -> Menunggu Approval -> Disetujui | Ditolak; Draft/Menunggu bisa Dibatalkan.
  R: { f: 'st', add: ['Draft', 'Menunggu Approval'], to: {
    'Draft': ['Menunggu Approval', 'Dibatalkan'],
    'Menunggu Approval': ['Disetujui', 'Ditolak', 'Dibatalkan']
  } },
  // Barang: ... -> Approved -> Validasi Warehouse -> Sudah di ERO. Warehouse boleh mengeluarkan barang (kembali ke Approved).
  I: { f: 'status', add: ['Draft', 'Menunggu Approval'], to: {
    'Draft': ['Menunggu Approval', 'Dibatalkan'],
    'Menunggu Approval': ['Approved', 'Ditolak', 'Dibatalkan'],
    'Approved': ['Validasi Warehouse'],
    'Validasi Warehouse': ['Approved', 'Sudah di ERO']
  } },
  // Konsolidasi per SRL: lahir di Validasi Warehouse, lalu divalidasi atau dikeluarkan seluruhnya.
  K: { f: 'tahap', add: ['Validasi Warehouse'], to: {
    'Validasi Warehouse': ['Sudah di ERO', 'Dikeluarkan']
  } }
};

// Kolom yang tidak boleh berubah setelah baris dibuat.
var LOCKED = {
  R: ['by', 'tgl'],
  I: ['req', 'kode', 'qty', 'datang', 'pakai'],
  K: ['dept', 'by', 'kode', 'srl'],
  L: ['dept']
};

// [kolom, tabel rujukan, boleh kosong]
var REFS = {
  R: [['by', 'U']],
  I: [['req', 'R'], ['kode', 'M'], ['kon', 'K', true]],
  K: [['srl', 'L'], ['kode', 'M']],
  KD: [['kon', 'K']],
  SR: [['item', 'I']],
  RM: [['item', 'I']]
};

function objOf_(S, row) {
  var o = {};
  S.cols.forEach(function (c, i) { o[c] = row[i]; });
  return o;
}

function isNum_(v) { return v !== '' && isFinite(+v); }

function checkAdd_(t, r) {
  var S = SCHEMA[t], f = FLOW[t], id = S.key ? S.sheet + ' ' + r[S.key] : S.sheet;
  if (f && f.add.indexOf(r[f.f]) < 0)
    throw conflict_(id + ': status awal "' + r[f.f] + '" tidak sah.');
  if (t === 'U' && ROLES.indexOf(r.role) < 0) throw new Error('Peran tidak dikenal: ' + r.role);
  if (t === 'KD') {
    var l = r.lebih === '' ? 0 : +r.lebih;
    if (!isNum_(r.qty) || !isFinite(l) || +r.qty < 0 || l < 0 || +r.qty + l <= 0)
      throw new Error('Kedatangan: qty tidak valid.');
  }
  if (t === 'SR' && !(isNum_(r.qty) && +r.qty > 0)) throw new Error('Serah terima: qty harus lebih dari 0.');
  if (t === 'RM' && !r.by) throw new Error('Pengingat: pengirim kosong.');
}

function checkSet_(t, old, nw) {
  var S = SCHEMA[t], f = FLOW[t], id = S.sheet + ' ' + nw[S.key];
  (LOCKED[t] || []).forEach(function (c) {
    if (old[c] !== nw[c]) throw conflict_(id + ': kolom ' + c + ' tidak boleh diubah.');
  });
  if (f && old[f.f] !== nw[f.f] && (f.to[old[f.f]] || []).indexOf(nw[f.f]) < 0)
    throw conflict_(id + ': status "' + old[f.f] + '" tidak bisa menjadi "' + nw[f.f] + '" (kemungkinan sudah diubah pengguna lain).');
  if (t === 'U' && ROLES.indexOf(nw.role) < 0) throw new Error('Peran tidak dikenal: ' + nw.role);
}

/**
 * Periksa keadaan sesudah operasi diterapkan (belum ditulis ke sheet):
 *  - rujukan antar tabel ada,
 *  - kedatangan hanya pada SRL yang sudah divalidasi dan tidak melebihi sisa,
 *  - serah terima tidak melebihi jatah barang yang sudah datang.
 */
function checkAfter_(plan) {
  var tb = readAll_().tables, by = {}, eps = 1e-9;
  plan.forEach(function (p) {
    tb[p.t] = p.rows.map(function (r) { return objOf_(SCHEMA[p.t], r); });
    by[p.t] = p;
  });

  var keys = {};
  function has(t, v) {
    if (!keys[t]) {
      keys[t] = {};
      tb[t].forEach(function (x) { keys[t][x[SCHEMA[t].key]] = 1; });
    }
    return keys[t][v] === 1;
  }
  plan.forEach(function (p) {
    var S = SCHEMA[p.t];
    (REFS[p.t] || []).forEach(function (rf) {
      p.touched.forEach(function (row) {
        var v = objOf_(S, row)[rf[0]];
        if (v === '' && rf[2]) return;
        if (!has(rf[1], v))
          throw conflict_(S.sheet + ': ' + rf[0] + ' "' + v + '" tidak ada di ' + SCHEMA[rf[1]].sheet + '.');
      });
    });
  });

  var sel = makeSel_(tb), kons = {};
  if (by.KD) by.KD.touched.forEach(function (row) {
    var d = objOf_(SCHEMA.KD, row), k = sel.K[d.kon];
    if (k.tahap !== 'Sudah di ERO') throw conflict_('SRL ' + k.srl + ' belum divalidasi Warehouse, kedatangan belum bisa dicatat.');
    kons[d.kon] = 1;
  });
  if (by.K) by.K.touched.forEach(function (row) { kons[row[0]] = 1; });
  Object.keys(kons).forEach(function (id) {
    var k = sel.K[id];
    if (k && sel.raw(k) < -eps)
      throw conflict_(id + ' (' + k.srl + '): qty datang melebihi sisa ' + sel.sisa(k) + '. Data dimuat ulang.');
  });
  if (by.SR) by.SR.touched.forEach(function (row) {
    var s = objOf_(SCHEMA.SR, row), it = sel.I[s.item];
    if (it.status !== 'Sudah di ERO') throw conflict_(s.item + ': barang belum/tidak aktif di ERO, tidak bisa diserahkan.');
    if (sel.siap(it) < -eps) throw conflict_(s.item + ': qty serah melebihi yang siap diambil (' + (sel.berhak(it) - (sel.diambil(it) - +s.qty)) + ').');
  });
}

/**
 * Port src/lib/selectors.js. Jatah barang yang sudah datang dibagi ke request menurut kebutuhan terdekat.
 * Dipakai oleh penjaga alur di atas dan oleh mesin pengingat (Fonnte.gs). Harus tetap sama dengan klien.
 */
function makeSel_(tb) {
  var U = {}, M = {}, R = {}, I = {}, K = {}, L = {}, byKon = {}, kdKon = {}, srItem = {};
  tb.U.forEach(function (x) { U[x.id] = x; });
  tb.M.forEach(function (x) { M[x.k] = x; });
  tb.R.forEach(function (x) { R[x.id] = x; });
  tb.I.forEach(function (x) { I[x.id] = x; if (x.kon) (byKon[x.kon] = byKon[x.kon] || []).push(x); });
  tb.K.forEach(function (x) { K[x.id] = x; });
  tb.L.forEach(function (x) { L[x.no] = x; });
  tb.KD.forEach(function (x) { (kdKon[x.kon] = kdKon[x.kon] || []).push(x); });
  tb.SR.forEach(function (x) { (srItem[x.item] = srItem[x.item] || []).push(x); });

  function sum(a, f) { var s = 0; a.forEach(function (x) { s += +f(x) || 0; }); return s; }
  function live(i) { return i.status !== 'Ditolak' && i.status !== 'Dibatalkan'; }
  function ord(a, b) {
    var pa = a.pakai || '9', pb = b.pakai || '9';
    return pa < pb ? -1 : pa > pb ? 1 : a.appr < b.appr ? -1 : 1;
  }
  function total(k) { return sum((byKon[k.id] || []).filter(live), function (i) { return i.qty; }); }
  function datang(k) { return sum(kdKon[k.id] || [], function (d) { return d.qty; }); }
  function raw(k) { return total(k) - datang(k) - (+k.tutup || 0); }
  function sisa(k) { return Math.max(0, raw(k)); }
  function berhak(it) {
    var k = K[it.kon];
    if (!k) return 0;
    var r = datang(k), xs = (byKon[k.id] || []).filter(live).sort(ord);
    for (var j = 0; j < xs.length; j++) {
      var g = Math.min(r, +xs[j].qty);
      if (xs[j].id == it.id) return g;
      r -= g;
    }
    return 0;
  }
  function diambil(it) { return sum(srItem[it.id] || [], function (s) { return s.qty; }); }
  function siap(it) { return berhak(it) - diambil(it); }
  function deptOf(it) { var r = R[it.req], u = r && U[r.by]; return u ? u.dept : ''; }
  function lastArrival(kon) {
    var a = (kdKon[kon] || []).map(function (d) { return d.tgl; }).sort();
    return a.length ? a[a.length - 1] : undefined;
  }
  function poolOf(dept) {
    return tb.I.filter(function (i) {
      return i.status === 'Approved' && !i.kon && !i.tahan && R[i.req] && deptOf(i) === dept;
    });
  }
  return { U: U, M: M, R: R, I: I, K: K, L: L, live: live, ord: ord, total: total, datang: datang, raw: raw, sisa: sisa,
    berhak: berhak, diambil: diambil, siap: siap, deptOf: deptOf, lastArrival: lastArrival, poolOf: poolOf };
}

/**
 * Terapkan sekumpulan operasi secara atomik per panggilan (satu lock, satu setValues per tabel).
 * 'add' pada tabel berkunci gagal bila kunci sudah ada (mis. dua orang membuat RQ-013 bersamaan);
 * 'set' gagal bila barisnya sudah tidak ada. Klien lalu memuat ulang data.
 */
function mutate_(ops) {
  if (!ops || !ops.length) return { ok: true, ver: getVer_(), base: getVer_() };
  if (ops.length > MAX_OPS) throw new Error('Terlalu banyak operasi sekaligus.');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_(), byT = {};
    ops.forEach(function (o) {
      if (!SCHEMA[o.t]) throw new Error('Tabel tidak dikenal: ' + o.t);
      if (o.op !== 'add' && o.op !== 'set') throw new Error('Operasi tidak dikenal: ' + o.op);
      if (!o.row || typeof o.row !== 'object') throw new Error('Baris kosong pada tabel ' + o.t);
      (byT[o.t] = byT[o.t] || []).push(o);
    });

    // Tahap 1: validasi + susun hasil di memori. Belum ada yang ditulis ke sheet.
    var plan = [];
    Object.keys(byT).forEach(function (t) {
      var S = SCHEMA[t], w = S.cols.length, kIdx = S.key ? S.cols.indexOf(S.key) : -1;
      var rows = readTable_(ss, t).map(function (r) { return S.cols.map(function (c) { return r[c]; }); });
      // Baris fisik di sheet. Bila berbeda dari jumlah baris valid (ada baris kosong di tengah akibat edit manual),
      // tulis ulang seluruh tabel secara rapat supaya 'add' tidak menimpa baris lain.
      var physical = Math.max(0, sheet_(ss, t).getLastRow() - 1);
      var base = rows.length, index = {}, rewrite = physical !== rows.length, touched = [];
      if (kIdx >= 0) rows.forEach(function (r, i) { index[r[kIdx]] = i; });

      byT[t].forEach(function (o) {
        var row = S.cols.map(function (c) { return cell_(o.row[c]); });
        if (kIdx >= 0 && !row[kIdx]) throw new Error('Kunci kosong pada tabel ' + t);
        if (o.op === 'add') {
          if (kIdx >= 0 && Object.prototype.hasOwnProperty.call(index, row[kIdx]))
            throw conflict_(S.sheet + ': ' + row[kIdx] + ' sudah ada (dibuat pengguna lain).');
          checkAdd_(t, objOf_(S, row));
          rows.push(row);
          if (kIdx >= 0) index[row[kIdx]] = rows.length - 1;
        } else {
          if (kIdx < 0) throw new Error('Tabel ' + t + ' hanya mendukung add.');
          if (!Object.prototype.hasOwnProperty.call(index, row[kIdx]))
            throw conflict_(S.sheet + ': ' + row[kIdx] + ' tidak ditemukan.');
          checkSet_(t, objOf_(S, rows[index[row[kIdx]]]), objOf_(S, row));
          rows[index[row[kIdx]]] = row;
          rewrite = true;
        }
        touched.push(row);
      });
      plan.push({ t: t, w: w, rows: rows, base: base, rewrite: rewrite, physical: physical, touched: touched });
    });

    // Tahap 1b: konsistensi lintas tabel pada keadaan SESUDAH operasi (referensi, qty datang, qty serah).
    checkAfter_(plan);

    // Tahap 2: tulis. Hanya-tambah => tulis ekor saja; ada perubahan => tulis ulang tabel (kecil, 1 panggilan).
    var base = getVer_();
    plan.forEach(function (p) {
      var sh = sheet_(ss, p.t);
      var from = p.rewrite ? 0 : p.base;
      var chunk = p.rows.slice(from);
      // Tulis ulang: kosongkan dulu area lama agar tidak tersisa baris basi di bawah data baru.
      if (p.rewrite && p.physical > 0) sh.getRange(2, 1, p.physical, p.w).clearContent();
      if (!chunk.length) return;
      var need = 1 + from + chunk.length;
      if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
      sh.getRange(2 + from, 1, chunk.length, p.w).setNumberFormat('@').setValues(chunk);
    });
    SpreadsheetApp.flush();

    var ver = bump_(plan.map(function (p) { return p.t; }));
    return { ok: true, ver: ver, base: base };
  } finally {
    lock.releaseLock();
  }
}

/** Dipakai Seed.gs: kosongkan semua tabel lalu isi dari objek db (bentuk sama dengan aplikasi). */
function writeAll_(db) {
  var ss = ss_();
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var U = db.U.map(function (u) { return { id: u.id, n: u.n, dept: u.dept, role: u.role, boss: u.boss || '', hp: (db.HP || {})[u.id] || '', off: u.off ? 'Y' : '' }; });
    var src = { U: U, M: db.M, R: db.R, I: db.I, K: db.K, L: db.L, KD: db.KD, SR: db.SR, RM: db.RM };
    TABLES.forEach(function (t) {
      var S = SCHEMA[t], sh = sheet_(ss, t), rows = src[t] || [], w = S.cols.length;
      var last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, w).clearContent();
      if (!rows.length) return;
      var need = 1 + rows.length;
      if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
      var vals = rows.map(function (r) { return S.cols.map(function (c) { return cell_(r[c]); }); });
      sh.getRange(2, 1, vals.length, w).setNumberFormat('@').setValues(vals);
    });
    SpreadsheetApp.flush();
    return bump_(TABLES);
  } finally {
    lock.releaseLock();
  }
}

/** Darurat: buang semua cache (data di sheet tidak disentuh). */
function resetCache() {
  return bump_(TABLES);
}
