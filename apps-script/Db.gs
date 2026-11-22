/**
 * Akses data: sheet, versi, cache, baca, dan tulis massal.
 *
 * Kenapa cepat:
 *  - Tiap tabel dibaca SEKALI dengan getValues() (bukan per baris), lalu disimpan di CacheService.
 *  - Cache dipisah per tabel dan diberi nomor versi: menulis satu tabel hanya membuang cache tabel itu.
 *  - Klien cukup memanggil ?fn=ver (murah) untuk tahu ada perubahan; data penuh hanya diambil bila versi berubah.
 */

var CACHE_TTL = 21600;   // 6 jam
var CHUNK = 30000;       // karakter per potongan cache (batas CacheService 100KB per nilai)

/* ------------------------------------------------------------------ Spreadsheet */

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

/** Darurat: buang semua cache (data di sheet tidak disentuh). */
function resetCache() {
  return bump_(TABLES);
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

/** Nilai objek -> teks sel. */
function cell_(v) {
  if (v === true) return 'Y';
  if (v === false || v == null) return '';
  return String(v);
}

/** Nilai sel -> teks. Tanggal yang terlanjur dikonversi Sheets dikembalikan ke yyyy-MM-dd[THH:mm]. */
function norm_(v) {
  if (v instanceof Date) {
    var tz = Session.getScriptTimeZone();
    var midnight = v.getHours() === 0 && v.getMinutes() === 0;
    return Utilities.formatDate(v, tz, midnight ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
  }
  return v == null ? '' : String(v);
}

/** Baca satu tabel dari sheet -> array objek. Baris kosong (atau tanpa kunci pada tabel berkunci) dilewati. */
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
    if (!any) continue;
    if (S.key && row[S.key] === '') continue;
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

/* ------------------------------------------------------------------ Tulis massal (Seed) */

/** Kebalikan toClient_: db aplikasi -> tabel mentah (U memuat hp & off). */
function fromClient_(db) {
  var U = db.U.map(function (u) {
    return { id: u.id, n: u.n, dept: u.dept, role: u.role, boss: u.boss || '', hp: (db.HP || {})[u.id] || '', off: u.off ? 'Y' : '' };
  });
  return { U: U, M: db.M, R: db.R, I: db.I, K: db.K, L: db.L, KD: db.KD, SR: db.SR, RM: db.RM };
}

/** Dipakai Seed.gs: kosongkan semua tabel lalu isi dari objek db (bentuk sama dengan aplikasi). Data diperiksa dulu. */
function writeAll_(db) {
  var src = fromClient_(db);
  var errs = validateAll_(src);
  if (errs.length) throw new Error('Data awal tidak valid (' + errs.length + '): ' + errs.slice(0, 5).map(function (e) { return e.m; }).join(' | '));

  var ss = ss_();
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
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
