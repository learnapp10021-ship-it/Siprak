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
 *   POST {fn:'mutate', ops:[...]} -> { ok, ver, base }   (body dikirim sebagai text/plain agar tanpa preflight CORS)
 *     op = { t:'R', op:'add'|'set', row:{...} }
 *
 * Cara pasang: lihat apps-script/README.md
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
    var tz = Session.getScriptTimeZone();
    var midnight = v.getHours() === 0 && v.getMinutes() === 0;
    return Utilities.formatDate(v, tz, midnight ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
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
      var base = rows.length, index = {}, rewrite = physical !== rows.length;
      if (kIdx >= 0) rows.forEach(function (r, i) { index[r[kIdx]] = i; });

      byT[t].forEach(function (o) {
        var row = S.cols.map(function (c) { return cell_(o.row[c]); });
        if (kIdx >= 0 && !row[kIdx]) throw new Error('Kunci kosong pada tabel ' + t);
        if (o.op === 'add') {
          if (kIdx >= 0 && Object.prototype.hasOwnProperty.call(index, row[kIdx]))
            throw conflict_(S.sheet + ': ' + row[kIdx] + ' sudah ada (dibuat pengguna lain).');
          rows.push(row);
          if (kIdx >= 0) index[row[kIdx]] = rows.length - 1;
        } else {
          if (kIdx < 0) throw new Error('Tabel ' + t + ' hanya mendukung add.');
          if (!Object.prototype.hasOwnProperty.call(index, row[kIdx]))
            throw conflict_(S.sheet + ': ' + row[kIdx] + ' tidak ditemukan.');
          rows[index[row[kIdx]]] = row;
          rewrite = true;
        }
      });
      plan.push({ t: t, w: w, rows: rows, base: base, rewrite: rewrite, physical: physical });
    });

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
