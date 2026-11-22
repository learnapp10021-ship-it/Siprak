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
 *   GET  ?fn=ver                  -> { ok, ver }                       (tanpa login; hanya nomor versi)
 *   POST {fn:'login', u, p}       -> { ok, token, uid, n }             (password diperiksa di server)
 *   GET  ?fn=all&t=TOKEN[&ver=N]  -> { ok, ver, same } atau { ok, ver, db }
 *   POST {fn:'mutate', t, ops}    -> { ok, ver, base }   (body dikirim sebagai text/plain agar tanpa preflight CORS)
 *   POST {fn:'chpw', t, o, n}     -> { ok }                            (ganti password sendiri)
 *     op = { t:'R', op:'add'|'set', row:{...} }
 *   Kegagalan login/sesi: { ok:false, auth:true, err }
 *
 * Cara pasang: lihat apps-script/README.md
 */

var SCHEMA = {
  U:  { sheet: 'Users',       key: 'id',  cols: ['id', 'n', 'dept', 'role', 'boss', 'hp', 'off', 'pw'] },
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
  return run_(p.fn, p, null, p.t);
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, err: 'Body bukan JSON yang valid.' }); }
  return run_(body.fn, {}, body, body.t);
}

function run_(fn, params, body, token) {
  try {
    if (fn === 'ver') return json_({ ok: true, ver: getVer_() });
    if (fn === 'login') return json_(login_(body && body.u, body && body.p));
    // Selebihnya wajib login: token ditandatangani server dan masih berlaku
    var uid = checkToken_(token);
    if (!uid) return json_({ ok: false, auth: true, err: 'Sesi berakhir, silakan login lagi.' });
    if (fn === 'all') {
      var ver = getVer_();
      if (params.ver && String(params.ver) === ver) return json_({ ok: true, ver: ver, same: true });
      var snap = readAll_();
      return json_({ ok: true, ver: snap.ver, db: toClient_(snap.tables) });
    }
    if (fn === 'mutate') return json_(mutate_(body && body.ops, uid));
    if (fn === 'chpw') return json_(chpw_(uid, body && body.o, body && body.n));
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
  TABLES.forEach(function (t) {
    var sh = sheet_(ss, t), S = SCHEMA[t];
    sh.getRange(1, 1, 1, S.cols.length).setValues([S.cols]);   // aman diulang; menambah header kolom baru (mis. pw)
    sh.getRange(1, 1, sh.getMaxRows(), S.cols.length).setNumberFormat('@');
  });
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

/* ------------------------------------------------------------------ Autentikasi */
/*
 * Password disimpan sebagai 'h1$garam$hash' (SHA-256 berulang + garam per pengguna) di kolom Users.pw;
 * kolom ini tidak pernah dikirim ke aplikasi. Login menghasilkan token bertanda tangan (HMAC) berlaku 30 hari.
 * Gagal login 5x dalam 10 menit mengunci akun itu sementara.
 */

var TOKEN_DAYS = 30;
var MAX_FAIL = 5;
var FAIL_TTL = 600;
var PW_ROUNDS = 500;
var PW_MIN = 6;

function hex_(bytes) {
  return bytes.map(function (b) { b = b < 0 ? b + 256 : b; return (b < 16 ? '0' : '') + b.toString(16); }).join('');
}
function pwHash_(salt, pw) {
  var h = salt + ':' + pw;
  for (var i = 0; i < PW_ROUNDS; i++)
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + ':' + salt, Utilities.Charset.UTF_8));
  return h;
}
function pwMake_(pw) {
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return 'h1$' + salt + '$' + pwHash_(salt, pw);
}
function pwCheck_(stored, pw) {
  var p = String(stored || '').split('$');
  return p.length === 3 && p[0] === 'h1' && pwHash_(p[1], String(pw)) === p[2];
}

function secret_() {
  var P = PropertiesService.getScriptProperties(), v = P.getProperty('SECRET');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); P.setProperty('SECRET', v); }
  return v;
}
function sign_(v) { return hex_(Utilities.computeHmacSha256Signature(v, secret_())); }
function makeToken_(uid) {
  var pl = uid + '|' + (Date.now() + TOKEN_DAYS * 864e5);
  return Utilities.base64EncodeWebSafe(pl, Utilities.Charset.UTF_8) + '.' + sign_(pl);
}
/** id pengguna bila token sah, masih berlaku, dan penggunanya masih aktif; selain itu null. */
function checkToken_(t) {
  if (!t || typeof t !== 'string') return null;
  var i = t.indexOf('.');
  if (i < 1) return null;
  var pl;
  try { pl = Utilities.newBlob(Utilities.base64DecodeWebSafe(t.slice(0, i))).getDataAsString(); } catch (e) { return null; }
  if (sign_(pl) !== t.slice(i + 1)) return null;
  var k = pl.lastIndexOf('|'), uid = pl.slice(0, k);
  if (!(+pl.slice(k + 1) > Date.now())) return null;
  var u = ix_(readAll_().tables.U, 'id')[uid];
  return u && !u.off ? uid : null;
}

function login_(user, pw) {
  var id = String(user || '').trim().toLowerCase(), cache = CacheService.getScriptCache(), fk = 'F_' + id;
  if (!id || !pw) throw new Error('Isi username dan password.');
  if (+(cache.get(fk) || 0) >= MAX_FAIL) throw new Error('Terlalu banyak percobaan gagal. Coba lagi dalam 10 menit.');
  var rec = null;
  readAll_().tables.U.forEach(function (u) { if (String(u.id).toLowerCase() === id) rec = u; });
  if (!rec || rec.off || !rec.pw || !pwCheck_(rec.pw, pw)) {
    cache.put(fk, String((+(cache.get(fk) || 0)) + 1), FAIL_TTL);
    throw new Error('Username atau password salah.');
  }
  cache.remove(fk);
  return { ok: true, token: makeToken_(rec.id), uid: rec.id, n: rec.n };
}

/** Ganti password milik sendiri (butuh password lama). */
function chpw_(uid, oldPw, newPw) {
  if (String(newPw || '').length < PW_MIN) throw new Error('Password baru minimal ' + PW_MIN + ' karakter.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_(), rows = readTable_(ss, 'U'), rec = null;
    rows.forEach(function (u) { if (u.id === uid) rec = u; });
    if (!rec || !pwCheck_(rec.pw, oldPw)) throw new Error('Password lama salah.');
    rec.pw = pwMake_(String(newPw));
    rewriteTable_(ss, 'U', rows);
    SpreadsheetApp.flush();
    bump_(['U']);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Dari editor: atur password satu pengguna. Contoh: aturPassword('andi.prod', 'passwordBaru') */
function aturPassword(id, pw) {
  if (String(pw || '').length < PW_MIN) throw new Error('Password minimal ' + PW_MIN + ' karakter.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_(), rows = readTable_(ss, 'U'), rec = null;
    rows.forEach(function (u) { if (String(u.id).toLowerCase() === String(id).toLowerCase()) rec = u; });
    if (!rec) throw new Error('Pengguna tidak ditemukan: ' + id);
    rec.pw = pwMake_(String(pw));
    rewriteTable_(ss, 'U', rows);
    SpreadsheetApp.flush();
    bump_(['U']);
    return 'Password ' + rec.id + ' diatur.';
  } finally {
    lock.releaseLock();
  }
}

/** Dari editor: beri password awal yang sama ke SEMUA pengguna yang belum punya (pengguna diminta menggantinya). */
function aturPasswordSemua(pw) {
  if (String(pw || '').length < PW_MIN) throw new Error('Password minimal ' + PW_MIN + ' karakter.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_(), rows = readTable_(ss, 'U'), n = 0;
    rows.forEach(function (u) { if (!u.pw) { u.pw = pwMake_(String(pw)); n++; } });
    if (n) { rewriteTable_(ss, 'U', rows); SpreadsheetApp.flush(); bump_(['U']); }
    return n + ' pengguna diberi password awal.';
  } finally {
    lock.releaseLock();
  }
}

/** Dari editor: paksa semua pengguna login ulang (membatalkan semua sesi yang ada). */
function resetSesi() {
  PropertiesService.getScriptProperties().setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  return 'Semua sesi dibatalkan.';
}

/* ------------------------------------------------------------ Validasi relasi & aturan */
/*
 * Semua tulisan melewati validasi ini SEBELUM menyentuh sheet, jadi sheet tidak pernah berisi data yang
 * relasinya rusak walau layar pengguna basi atau permintaan dibuat manual.
 *  - Kunci asing: Request.by->Users, Item.req->Request, Item.kode->Master, Item.kon->Konsolidasi,
 *    Konsolidasi.srl->SRL, Kedatangan.kon->Konsolidasi, SerahTerima.item->Item, Pengingat.item->Item,
 *    kolom by/to di log -> Users.id (bukan nama).
 *  - Status hanya boleh maju lewat jalur yang sah; kolom identitas (req, kode, qty, ...) tidak boleh diubah.
 *  - Angka: kedatangan + tutup <= total, serah terima <= jatah (dibagi menurut urutan kebutuhan).
 * Galat karena data sudah berubah oleh pengguna lain dilaporkan sebagai konflik (klien memuat ulang).
 */

var ROLES = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse'];
var REQ_ST = ['Draft', 'Menunggu Approval', 'Disetujui', 'Ditolak', 'Dibatalkan'];
var ITEM_ST = ['Draft', 'Menunggu Approval', 'Approved', 'Masuk Konsolidasi', 'Sudah di ERO', 'Ditolak', 'Dibatalkan'];
var REQ_NEXT = {
  'Draft': ['Menunggu Approval', 'Dibatalkan'],
  'Menunggu Approval': ['Disetujui', 'Ditolak', 'Dibatalkan']
};
var ITEM_NEXT = {
  'Draft': ['Menunggu Approval', 'Dibatalkan'],
  'Menunggu Approval': ['Approved', 'Ditolak', 'Dibatalkan'],
  'Approved': ['Masuk Konsolidasi', 'Sudah di ERO'],
  'Masuk Konsolidasi': ['Sudah di ERO']
};
var RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
var RE_DT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
var RE_HP = /^628\d{8,11}$/;
var EPS = 1e-9;

function bad_(x, msg, stale) {
  if (x.collect) { x.errs.push(msg); return; }
  throw stale ? conflict_(msg) : new Error(msg);
}
function has_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function ix_(rows, key) {
  var m = Object.create(null);
  for (var i = 0; i < rows.length; i++) m[rows[i][key]] = rows[i];
  return m;
}
function num_(v) { return v === '' || v == null ? NaN : +v; }
function sum_(rows, f) {
  var s = 0;
  for (var i = 0; i < rows.length; i++) s += +f(rows[i]) || 0;
  return Math.round(s * 1e6) / 1e6;
}
function isLive_(i) { return i.status !== 'Ditolak' && i.status !== 'Dibatalkan'; }
function addDays_(d, n) { return new Date(Date.parse(d.slice(0, 10)) + n * 864e5).toISOString().slice(0, 10); }
function same_(a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); }

// Urutan kebutuhan paling dekat; HARUS sama dengan `ord` di src/lib/selectors.js
function ordItem_(a, b) {
  var pa = a.pakai || '9', pb = b.pakai || '9';
  if (pa !== pb) return pa < pb ? -1 : 1;
  if (a.appr !== b.appr) return a.appr < b.appr ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function ctxOf_(post, collect) {
  return {
    P: post, collect: !!collect, errs: [],
    U: ix_(post.U, 'id'), M: ix_(post.M, 'k'), R: ix_(post.R, 'id'),
    I: ix_(post.I, 'id'), K: ix_(post.K, 'id'), L: ix_(post.L, 'no')
  };
}

function totalOf_(x, kon) {
  return sum_(x.P.I.filter(function (i) { return i.kon === kon && isLive_(i); }), function (i) { return i.qty; });
}
function datangOf_(x, kon) {
  return sum_(x.P.KD.filter(function (d) { return d.kon === kon; }), function (d) { return d.qty; });
}
function berhak_(x, item) {
  if (!item.kon) return 0;
  var r = datangOf_(x, item.kon);
  var peers = x.P.I.filter(function (i) { return i.kon === item.kon && isLive_(i); }).sort(ordItem_);
  for (var n = 0; n < peers.length; n++) {
    var g = Math.min(r, +peers[n].qty);
    if (peers[n].id === item.id) return g;
    r -= g;
  }
  return 0;
}
function diambil_(x, itemId) {
  return sum_(x.P.SR.filter(function (s) { return s.item === itemId; }), function (s) { return s.qty; });
}

// Status barang yang masih hidup harus sejalan dengan status request induknya. '' bila sejalan.
function consistent_(R, i) {
  if (!isLive_(i)) return '';
  var ok;
  if (R.st === 'Draft' || R.st === 'Menunggu Approval') ok = i.status === R.st;
  else if (R.st === 'Disetujui') ok = ['Approved', 'Masuk Konsolidasi', 'Sudah di ERO'].indexOf(i.status) >= 0;
  else ok = false;
  return ok ? '' : 'Barang ' + i.id + ' berstatus "' + i.status + '" padahal ' + R.id + ' berstatus "' + R.st + '"';
}

function bossOk_(x, uid, label) {
  var u = x.U[uid];
  if (!u || u.off) { bad_(x, label + ': pembuat nonaktif atau tidak ada.'); return; }
  var b = u.boss ? x.U[u.boss] : null;
  if (!b) bad_(x, label + ': pembuat belum punya atasan.');
  else if (b.off) bad_(x, label + ': atasan (' + b.n + ') nonaktif.');
}

function vUser_(x, c) {
  var r = c.row, U = x.U, L = 'Users ' + r.id;
  if (!r.id) bad_(x, 'Users: id kosong.');
  if (!r.n) bad_(x, L + ': nama kosong.');
  if (!r.dept) bad_(x, L + ': departemen kosong.');
  if (ROLES.indexOf(r.role) < 0) bad_(x, L + ': role "' + r.role + '" tidak valid.');
  if (r.hp && !RE_HP.test(r.hp)) bad_(x, L + ': nomor WhatsApp tidak valid (harus 628...).');
  if (r.boss) {
    if (r.boss === r.id) bad_(x, L + ': atasan tidak boleh diri sendiri.');
    else if (!U[r.boss]) bad_(x, L + ': atasan "' + r.boss + '" tidak ada di Users.');
    else {
      if (U[r.boss].role !== 'Atasan') bad_(x, L + ': ' + U[r.boss].n + ' bukan berperan Atasan.');
      var seen = {}, cur = r.boss;
      while (cur) {
        if (cur === r.id) { bad_(x, L + ': rantai atasan berputar.'); break; }
        if (seen[cur]) break;
        seen[cur] = 1;
        cur = U[cur] ? U[cur].boss : '';
      }
    }
  } else if (r.role === 'User' && !r.off) {
    bad_(x, L + ': User wajib punya atasan.');
  }
  if (c.op === 'set' && c.old && c.old.role === 'Atasan' && (r.role !== 'Atasan' || r.off)) {
    var subs = x.P.U.filter(function (u) { return u.boss === r.id && !u.off; });
    if (subs.length) bad_(x, L + ': masih menjadi atasan ' + subs.length + ' pengguna aktif.');
  }
}

function vMaster_(x, c) {
  var r = c.row, L = 'Master ' + r.k;
  if (!r.n || !r.sat) bad_(x, L + ': nama/satuan kosong.');
  if (r.buf !== '0' && r.buf !== '1') bad_(x, L + ': buf harus 0 atau 1.');
  if (r.kons !== '0' && r.kons !== '1') bad_(x, L + ': kons harus 0 atau 1.');
  if (!(num_(r.lead) >= 0)) bad_(x, L + ': lead tidak valid.');
}

function vReq_(x, c) {
  var r = c.row, o = c.old, id = r.id, L = 'Request ' + id;
  if (!/^RQ-\d+$/.test(id)) bad_(x, L + ': format id harus RQ-nnn.');
  if (!x.U[r.by]) bad_(x, L + ': pembuat "' + r.by + '" tidak ada di Users.');
  if (REQ_ST.indexOf(r.st) < 0) bad_(x, L + ': status "' + r.st + '" tidak valid.');
  if (!RE_DATE.test(r.tgl)) bad_(x, L + ': tanggal tidak valid.');
  if (r.st === 'Ditolak' && !r.cat) bad_(x, L + ': penolakan wajib punya catatan.');
  var its = x.P.I.filter(function (i) { return i.req === id; });
  if (c.op === 'add' || c.op === 'audit') {
    if (!its.length) bad_(x, L + ': tidak punya barang.');
  }
  if (c.op === 'add') {
    if (r.st !== 'Draft' && r.st !== 'Menunggu Approval') bad_(x, L + ': request baru harus Draft atau Menunggu Approval.');
    if (r.st === 'Menunggu Approval') bossOk_(x, r.by, L);
    if (x.uid && r.by !== x.uid) bad_(x, L + ': request hanya boleh dibuat atas nama sendiri.');
  } else if (c.op === 'set') {
    if (!same_(o.by, r.by) || !same_(o.tgl, r.tgl)) bad_(x, L + ': pembuat/tanggal tidak boleh diubah.');
    if (o.st !== r.st && x.uid) {
      // Persetujuan/penolakan hanya oleh atasan langsung; pengajuan/pembatalan hanya oleh pembuat
      var boss = x.U[r.by] ? x.U[r.by].boss : '';
      var byBoss = r.st === 'Disetujui' || r.st === 'Ditolak';
      if (byBoss ? x.uid !== boss : x.uid !== r.by)
        bad_(x, L + ': hanya ' + (byBoss ? 'atasan langsung pembuat' : 'pembuat request') + ' yang boleh mengubah status ini.');
    }
    if (o.st !== r.st) {
      if ((REQ_NEXT[o.st] || []).indexOf(r.st) < 0)
        bad_(x, L + ' sudah berstatus "' + o.st + '", tidak bisa menjadi "' + r.st + '" (kemungkinan sudah diubah pengguna lain).', true);
      if (r.st === 'Menunggu Approval') bossOk_(x, r.by, L);
    }
  }
  its.forEach(function (i) {
    var m = consistent_(r, i);
    if (m) bad_(x, m + '.');
  });
}

function vItem_(x, c) {
  var r = c.row, o = c.old, L = 'Item ' + r.id, R = x.R[r.req], m = x.M[r.kode];
  if (c.op === 'set') {
    if (o.status !== r.status && (ITEM_NEXT[o.status] || []).indexOf(r.status) < 0)
      bad_(x, L + ' sudah berstatus "' + o.status + '", tidak bisa menjadi "' + r.status + '" (kemungkinan sudah diubah pengguna lain).', true);
    ['req', 'kode', 'qty', 'datang', 'pakai'].forEach(function (col) {
      if (!same_(o[col], r[col])) bad_(x, L + ': kolom ' + col + ' tidak boleh diubah.');
    });
    if (!same_(o.kon, r.kon) && !(o.status !== 'Sudah di ERO' && r.status === 'Sudah di ERO'))
      bad_(x, L + ': konsolidasi tidak boleh diubah.');
  }
  if (!/^ITM-\d+$/.test(r.id)) bad_(x, L + ': format id harus ITM-nnn.');
  if (!R) bad_(x, L + ': request "' + r.req + '" tidak ada.');
  if (!m) bad_(x, L + ': barang "' + r.kode + '" tidak ada di Master.');
  if (!(num_(r.qty) > 0)) bad_(x, L + ': qty harus lebih dari 0.');
  if (ITEM_ST.indexOf(r.status) < 0) bad_(x, L + ': status "' + r.status + '" tidak valid.');
  if (!RE_DATE.test(r.datang)) bad_(x, L + ': tgl datang tidak valid.');
  if (r.pakai && !RE_DATE.test(r.pakai)) bad_(x, L + ': tgl pakai tidak valid.');
  if (r.pakai && r.datang && r.pakai < r.datang) bad_(x, L + ': tgl pakai sebelum tgl datang.');
  if (r.appr && !RE_DT.test(r.appr)) bad_(x, L + ': waktu approve tidak valid.');
  if (r.status === 'Approved' && !r.appr) bad_(x, L + ': Approved tanpa waktu approve.');
  if (r.tahan && !r.alasan) bad_(x, L + ': ditahan tanpa alasan.');
  if (r.tahan && (r.status !== 'Approved' || r.kon)) bad_(x, L + ': hanya barang Approved yang belum masuk ERO bisa ditahan.');
  if (r.status === 'Sudah di ERO') {
    if (!r.kon) bad_(x, L + ': Sudah di ERO tapi tanpa konsolidasi.');
    else {
      var k = x.K[r.kon];
      if (!k) bad_(x, L + ': konsolidasi "' + r.kon + '" tidak ada.');
      else {
        if (k.kode !== r.kode) bad_(x, L + ': kode ' + r.kode + ' berbeda dengan konsolidasi ' + k.id + ' (' + k.kode + ').');
        var dp = R && x.U[R.by] ? x.U[R.by].dept : '';
        if (dp && dp !== k.dept) bad_(x, L + ': departemen ' + dp + ' berbeda dengan konsolidasi ' + k.id + ' (' + k.dept + ').');
      }
    }
  } else if (r.kon) {
    bad_(x, L + ': berstatus "' + r.status + '" tapi sudah punya konsolidasi.');
  }
  if (R) {
    var cm = consistent_(R, r);
    if (cm) bad_(x, cm + '.');
  }
  if (c.op === 'add') {
    if (r.status !== 'Draft' && r.status !== 'Menunggu Approval') bad_(x, L + ': barang baru harus Draft atau Menunggu Approval.');
    if (m && m.buf === '0' && !r.pakai) bad_(x, L + ': ' + m.n + ' non buffer wajib punya tgl pakai.');
    if (m && R && RE_DATE.test(R.tgl) && RE_DATE.test(r.datang) && r.datang < addDays_(R.tgl, +m.lead))
      bad_(x, L + ': tgl datang kurang dari lead time ' + m.lead + ' hari.');
  }
}

function vKon_(x, c) {
  var r = c.row, o = c.old, id = r.id, L = 'Konsolidasi ' + id;
  if (!/^KON-\d+$/.test(id)) bad_(x, L + ': format id harus KON-nnn.');
  if (!r.dept) bad_(x, L + ': departemen kosong.');
  if (!x.M[r.kode]) bad_(x, L + ': barang "' + r.kode + '" tidak ada di Master.');
  var l = x.L[r.srl];
  if (!l) bad_(x, L + ': SRL "' + r.srl + '" tidak ada.');
  else if (l.dept !== r.dept) bad_(x, L + ': departemen ' + r.dept + ' berbeda dengan SRL ' + r.srl + ' (' + l.dept + ').');
  var ero = num_(r.ero), tutup = num_(r.tutup === '' ? '0' : r.tutup);
  if (!(ero > 0)) bad_(x, L + ': jumlah ERO harus lebih dari 0.');
  if (!(tutup >= 0)) bad_(x, L + ': jumlah ditutup tidak valid.');
  if (tutup > 0 && !r.alasan) bad_(x, L + ': penutupan sisa wajib punya alasan.');
  // Baris lama (by masih nama) yang kolom by-nya tidak diubah tetap boleh diperbarui; migrasiRelasi() merapikannya.
  var byUnchanged = c.op === 'set' && same_(o.by, r.by);
  if (r.by && !x.U[r.by] && !byUnchanged) {
    bad_(x, L + ': kolom by "' + r.by + '" bukan id pengguna' + (c.op === 'add' ? '.' : ' (jalankan migrasiRelasi()).'));
  } else if (c.op === 'add' && !r.by) {
    bad_(x, L + ': kolom by wajib diisi id pengguna.');
  }
  if (c.op === 'add' || c.op === 'audit') {
    var its = x.P.I.filter(function (i) { return i.kon === id; });
    if (!its.length) bad_(x, L + ': tidak punya barang.');
    its.forEach(function (i) {
      if (i.kode !== r.kode) bad_(x, L + ': barang ' + i.id + ' berkode ' + i.kode + ', bukan ' + r.kode + '.');
      if (i.status !== 'Sudah di ERO' && isLive_(i)) bad_(x, L + ': barang ' + i.id + ' berstatus "' + i.status + '".');
      var rq = x.R[i.req], d = rq && x.U[rq.by] ? x.U[rq.by].dept : '';
      if (d && d !== r.dept) bad_(x, L + ': barang ' + i.id + ' dari departemen ' + d + ', bukan ' + r.dept + '.');
    });
    var tot = totalOf_(x, id);
    if (Math.abs(tot - ero) > EPS) bad_(x, L + ': jumlah ERO ' + r.ero + ' tidak sama dengan total barang ' + tot + '.');
  }
  if (c.op === 'add' && tutup !== 0) bad_(x, L + ': jumlah ditutup harus 0 saat dibuat.');
  if (c.op === 'add' && x.uid && r.by !== x.uid) bad_(x, L + ': hanya boleh dibuat atas nama sendiri.');
  if (c.op === 'set') {
    ['dept', 'kode', 'srl', 'ero', 'by'].forEach(function (col) {
      if (!same_(o[col], r[col])) bad_(x, L + ': kolom ' + col + ' tidak boleh diubah.');
    });
    if (tutup + EPS < num_(o.tutup === '' ? '0' : o.tutup)) bad_(x, L + ': jumlah ditutup tidak boleh berkurang.');
  }
  var dt = datangOf_(x, id), t2 = totalOf_(x, id);
  if (dt + tutup > t2 + EPS)
    bad_(x, L + ': datang ' + dt + ' + ditutup ' + tutup + ' melebihi total ' + t2 + '.', c.op === 'set');
}

function vSrl_(x, c) {
  var r = c.row, o = c.old, L = 'SRL ' + r.no;
  if (!r.dept) bad_(x, L + ': departemen kosong.');
  else if (!x.P.U.some(function (u) { return u.dept === r.dept; })) bad_(x, L + ': departemen "' + r.dept + '" tidak punya pengguna.');
  if (r.est && !RE_DATE.test(r.est)) bad_(x, L + ': estimasi datang tidak valid.');
  if (c.op === 'set') {
    ['dept', 'est'].forEach(function (col) {
      if (!same_(o[col], r[col])) bad_(x, L + ': kolom ' + col + ' tidak boleh diubah.');
    });
  }
  if (c.op === 'audit' && !x.P.K.some(function (k) { return k.srl === r.no; })) bad_(x, L + ': tidak dipakai konsolidasi mana pun.');
}

function vKd_(x, c) {
  var r = c.row, k = x.K[r.kon], L = 'Kedatangan ' + r.kon + ' ' + r.tgl;
  if (!k) bad_(x, L + ': konsolidasi "' + r.kon + '" tidak ada.');
  var q = num_(r.qty), l = num_(r.lebih === '' ? '0' : r.lebih);
  if (!(q >= 0) || !(l >= 0)) bad_(x, L + ': qty/lebih tidak valid atau negatif.');
  else if (!(q > 0) && !(l > 0)) bad_(x, L + ': qty dan lebih sama-sama kosong.');
  if (l > 0 && !r.cat) bad_(x, L + ': kelebihan wajib punya catatan.');
  if (!RE_DATE.test(r.tgl)) bad_(x, L + ': tanggal tidak valid.');
  var u = x.U[r.by];
  if (!u) bad_(x, L + ': pencatat "' + r.by + '" bukan id pengguna' + (c.op === 'add' ? '.' : ' (jalankan migrasiRelasi()).'));
  else if (c.op === 'add' && u.role !== 'Admin Warehouse') bad_(x, L + ': hanya Admin Warehouse yang mencatat kedatangan.');
  if (c.op === 'add' && x.uid && r.by !== x.uid) bad_(x, L + ': hanya boleh dicatat atas nama sendiri.');
  if (k) {
    var dt = datangOf_(x, k.id), tt = num_(k.tutup === '' ? '0' : k.tutup), tot = totalOf_(x, k.id);
    if (dt + tt > tot + EPS) bad_(x, L + ': total datang ' + dt + ' + ditutup ' + tt + ' melebihi jumlah ' + tot + '.', c.op === 'add');
  }
}

function vSr_(x, c) {
  var r = c.row, i = x.I[r.item], L = 'SerahTerima ' + r.item + ' ' + r.tgl;
  if (!i) { bad_(x, L + ': barang "' + r.item + '" tidak ada.'); return; }
  if (i.status !== 'Sudah di ERO') bad_(x, L + ': barang belum masuk ERO.');
  if (!(num_(r.qty) > 0)) bad_(x, L + ': qty harus lebih dari 0.');
  if (!RE_DATE.test(r.tgl)) bad_(x, L + ': tanggal tidak valid.');
  var rq = x.R[i.req];
  if (rq && r.to !== rq.by) {
    bad_(x, L + ': penerima "' + r.to + '" harus id peminta (' + rq.by + ')' + (c.op === 'add' ? '.' : ' (jalankan migrasiRelasi()).'));
  }
  var amb = diambil_(x, i.id), b = berhak_(x, i);
  if (amb > b + EPS) bad_(x, L + ': total diambil ' + amb + ' melebihi jatah ' + b + '.', c.op === 'add');
}

function vRm_(x, c) {
  var r = c.row, L = 'Pengingat ' + r.item + ' ' + r.at, u = x.U[r.by];
  if (!x.I[r.item]) bad_(x, L + ': barang "' + r.item + '" tidak ada.');
  if (!RE_DT.test(r.at)) bad_(x, L + ': waktu tidak valid.');
  if (!u) bad_(x, L + ': pengirim "' + r.by + '" bukan id pengguna' + (c.op === 'add' ? '.' : ' (jalankan migrasiRelasi()).'));
  else if (c.op === 'add' && u.role !== 'Admin Warehouse') bad_(x, L + ': hanya Admin Warehouse yang mengirim pengingat.');
  if (c.op === 'add' && x.uid && r.by !== x.uid) bad_(x, L + ': hanya boleh dikirim atas nama sendiri.');
}

var VALIDATORS = { U: vUser_, M: vMaster_, R: vReq_, I: vItem_, K: vKon_, L: vSrl_, KD: vKd_, SR: vSr_, RM: vRm_ };

/** Validasi perubahan terhadap kondisi SESUDAH semua operasi diterapkan; melempar galat pada pelanggaran pertama. */
function validateChanges_(post, changes, uid) {
  var x = ctxOf_(post, false);
  x.uid = uid || null;   // pengguna yang login; null = tidak diperiksa (audit / alat internal)
  changes.forEach(function (c) { VALIDATORS[c.t](x, c); });
}

/** Periksa seluruh isi database; mengembalikan daftar masalah (kosong = konsisten). */
function auditAll_(tb) {
  var x = ctxOf_(tb, true);
  TABLES.forEach(function (t) {
    tb[t].forEach(function (row) { VALIDATORS[t](x, { t: t, op: 'audit', row: row }); });
  });
  var seen = {};
  TABLES.forEach(function (t) {
    var key = SCHEMA[t].key;
    if (!key) return;
    tb[t].forEach(function (r) {
      var id = t + ':' + r[key];
      if (seen[id]) x.errs.push(SCHEMA[t].sheet + ': kunci ' + r[key] + ' ganda.');
      seen[id] = 1;
    });
  });
  return x.errs;
}

/**
 * Jalankan dari editor untuk memeriksa seluruh relasi di spreadsheet.
 * Hasilnya ada di Execution log; tidak mengubah data.
 */
function cekIntegritas() {
  var ss = ss_(), tb = {};
  TABLES.forEach(function (t) { tb[t] = readTable_(ss, t); });
  var errs = auditAll_(tb);
  var msg = errs.length
    ? errs.length + ' masalah ditemukan:\n- ' + errs.join('\n- ')
    : 'OK: semua relasi konsisten (' + TABLES.map(function (t) { return SCHEMA[t].sheet + ' ' + tb[t].length; }).join(', ') + ').';
  Logger.log(msg);
  return msg;
}

/** Tulis ulang satu tabel secara rapat (hapus isi lama, tulis baris baru). Pemanggil memegang lock. */
function rewriteTable_(ss, t, rows) {
  var S = SCHEMA[t], sh = sheet_(ss, t), w = S.cols.length, last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, w).clearContent();
  if (!rows.length) return;
  var need = 1 + rows.length;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  var vals = rows.map(function (r) { return S.cols.map(function (c) { return cell_(r[c]); }); });
  sh.getRange(2, 1, vals.length, w).setNumberFormat('@').setValues(vals);
}

/**
 * Migrasi sekali jalan untuk data lama: kolom by/to di log dulu berisi NAMA pengguna, sekarang berisi ID.
 *  - Konsolidasi.by, Kedatangan.by, Pengingat.by: nama -> id (bila nama unik).
 *  - SerahTerima.to: diisi dari id peminta barang.
 * Aman dijalankan berulang. Nama yang kembar atau tidak dikenal dilaporkan, tidak ditebak.
 */
function migrasiRelasi() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_(), tb = {};
    TABLES.forEach(function (t) { tb[t] = readTable_(ss, t); });
    var ids = ix_(tb.U, 'id'), byName = {}, dup = {};
    tb.U.forEach(function (u) { if (byName[u.n]) dup[u.n] = 1; byName[u.n] = u.id; });
    var changed = {}, unresolved = [];
    function mark(t) { changed[t] = (changed[t] || 0) + 1; }
    [['K', 'by'], ['KD', 'by'], ['RM', 'by']].forEach(function (p) {
      tb[p[0]].forEach(function (r) {
        var v = r[p[1]];
        if (!v || ids[v]) return;
        if (has_(byName, v) && !dup[v]) { r[p[1]] = byName[v]; mark(p[0]); }
        else unresolved.push(SCHEMA[p[0]].sheet + '.' + p[1] + ' "' + v + '"' + (dup[v] ? ' (nama kembar)' : ' (tidak dikenal)'));
      });
    });
    var I = ix_(tb.I, 'id'), R = ix_(tb.R, 'id');
    tb.SR.forEach(function (s) {
      var i = I[s.item], rq = i && R[i.req];
      if (!rq) { unresolved.push('SerahTerima.item "' + s.item + '" tidak ada'); return; }
      if (s.to !== rq.by) { s.to = rq.by; mark('SR'); }
    });
    var tables = Object.keys(changed);
    tables.forEach(function (t) { rewriteTable_(ss, t, tb[t]); });
    if (tables.length) { SpreadsheetApp.flush(); bump_(tables); }
    var msg = (tables.length
      ? 'Diperbarui: ' + tables.map(function (t) { return SCHEMA[t].sheet + ' ' + changed[t] + ' baris'; }).join(', ') + '.'
      : 'Tidak ada yang perlu dimigrasi.') + (unresolved.length ? '\nTidak bisa dipetakan:\n- ' + unresolved.join('\n- ') : '');
    Logger.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ Tulis */

function conflict_(msg) { return { conflict: true, message: msg }; }

/**
 * Terapkan operasi ke salinan data di memori (murni, tanpa menyentuh sheet) dan catat tiap perubahan.
 * 'add' pada tabel berkunci gagal bila kunci sudah ada (mis. dua orang membuat RQ-013 bersamaan);
 * 'set' gagal bila barisnya sudah tidak ada. Klien lalu memuat ulang data.
 */
function planOps_(pre, ops) {
  var post = {}, idx = {}, changes = [];
  TABLES.forEach(function (t) { post[t] = pre[t].slice(); });
  ops.forEach(function (o) {
    var t = o.t, S = SCHEMA[t], key = S.key;
    if (key && !idx[t]) {
      idx[t] = Object.create(null);
      post[t].forEach(function (r, i) { idx[t][r[key]] = i; });
    }
    var row = {};
    S.cols.forEach(function (c) { row[c] = cell_(o.row[c]); });
    if (key && !row[key]) throw new Error('Kunci kosong pada tabel ' + S.sheet);
    if (t === 'U') row.pw = '';   // hash password hanya diubah lewat login/chpw/aturPassword, tidak pernah dari klien
    if (o.op === 'add') {
      if (key && idx[t][row[key]] !== undefined)
        throw conflict_(S.sheet + ': ' + row[key] + ' sudah ada (dibuat pengguna lain).');
      post[t].push(row);
      if (key) idx[t][row[key]] = post[t].length - 1;
      changes.push({ t: t, op: 'add', row: row });
    } else {
      if (!key) throw new Error('Tabel ' + S.sheet + ' hanya mendukung add.');
      if (idx[t][row[key]] === undefined) throw conflict_(S.sheet + ': ' + row[key] + ' tidak ditemukan.');
      var old = post[t][idx[t][row[key]]];
      if (t === 'U') row.pw = old.pw || '';
      post[t][idx[t][row[key]]] = row;
      changes.push({ t: t, op: 'set', row: row, old: old });
    }
  });
  return { post: post, changes: changes };
}

/**
 * Terapkan sekumpulan operasi secara atomik per panggilan (satu lock, satu setValues per tabel).
 * Urutan: baca kondisi terkini -> terapkan di memori -> VALIDASI relasi/aturan -> baru tulis ke sheet.
 * Bila ada pelanggaran, tidak ada satu pun baris yang ditulis.
 */
function mutate_(ops, uid) {
  if (!ops || !ops.length) return { ok: true, ver: getVer_(), base: getVer_() };
  if (ops.length > MAX_OPS) throw new Error('Terlalu banyak operasi sekaligus.');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_(), byT = {};
    ops.forEach(function (o) {
      if (!o || !SCHEMA[o.t]) throw new Error('Tabel tidak dikenal: ' + (o && o.t));
      if (o.op !== 'add' && o.op !== 'set') throw new Error('Operasi tidak dikenal: ' + o.op);
      if (!o.row || typeof o.row !== 'object') throw new Error('Baris kosong pada tabel ' + o.t);
      (byT[o.t] = byT[o.t] || []).push(o);
    });

    // Tahap 1: kondisi terkini. Tabel yang akan ditulis dibaca langsung dari sheet; tabel lain (untuk
    // memeriksa relasi) dari cache yang versinya selalu dibuang setiap ada tulisan.
    var pre = {}, physical = {}, cached = null;
    TABLES.forEach(function (t) {
      if (byT[t]) {
        pre[t] = readTable_(ss, t);
        physical[t] = Math.max(0, sheet_(ss, t).getLastRow() - 1);
      } else {
        cached = cached || readAll_().tables;
        pre[t] = cached[t];
      }
    });

    // Tahap 2: terapkan di memori + validasi. Belum ada yang ditulis ke sheet.
    var res = planOps_(pre, ops);
    validateChanges_(res.post, res.changes, uid);

    // Tahap 3: tulis. Hanya-tambah => tulis ekor saja; ada perubahan => tulis ulang tabel (kecil, 1 panggilan).
    // Bila baris fisik berbeda dari jumlah baris valid (ada baris kosong di tengah akibat edit manual),
    // tulis ulang rapat supaya 'add' tidak menimpa baris lain.
    var plan = Object.keys(byT).map(function (t) {
      var S = SCHEMA[t];
      return {
        t: t, w: S.cols.length, base: pre[t].length, physical: physical[t],
        rows: res.post[t].map(function (r) { return S.cols.map(function (c) { return r[c]; }); }),
        rewrite: physical[t] !== pre[t].length || byT[t].some(function (o) { return o.op === 'set'; })
      };
    });

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
    var U = db.U.map(function (u) { return { id: u.id, n: u.n, dept: u.dept, role: u.role, boss: u.boss || '', hp: (db.HP || {})[u.id] || '', off: u.off ? 'Y' : '', pw: '' }; });
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
