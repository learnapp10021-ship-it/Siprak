/**
 * SIPRAK - Backend Google Apps Script (Google Spreadsheet sebagai database)
 *
 * Jaminan (lihat docs/ARSITEKTUR.md):
 *  1. Semua TULIS lewat satu LockService.getScriptLock(): hanya satu penulis pada satu waktu.
 *  2. Setiap transaksi punya opId unik dari klien. opId yang sama tidak pernah dieksekusi dua kali
 *     (idempotent) -> retry aman, tidak ada data ganda.
 *  3. Write-ahead log (_Ops): PENDING dicatat dulu, baru data ditulis, lalu dibaca ulang dan
 *     dibandingkan (verifikasi). Baru setelah cocok status menjadi COMMITTED.
 *     Crash di tengah jalan -> transaksi PENDING otomatis diselesaikan (roll-forward) oleh
 *     pemegang lock berikutnya, atau di-rollback bila gagal 3 kali.
 *  4. Logika bisnis (validasi, izin, status) dijalankan DI SERVER pada data terbaru, memakai kode
 *     yang sama dengan klien (Core.gs, hasil build dari shared/). Klien tidak bisa menimpa data
 *     lewat tampilan yang sudah basi.
 *  5. Tidak ada operasi hapus. Baris hanya ditambah atau diubah, dan tiap baris mencatat
 *     _cr (dibuat), _ts (diubah), _op (ID transaksi terakhir), _by (pelaku).
 */

var CFG = {
  LOCK_WAIT_MS: 10000, // tunggu lock; lewat itu balas BUSY supaya eksekusi tidak menumpuk (batas 30 paralel)
  TZ: 'Asia/Jakarta',
  OPS_KEEP: 4000, // jumlah log transaksi yang disimpan
  OPS_SCAN: 2000, // jendela pencarian opId untuk idempotensi
  MAX_PAYLOAD: 135000, // batas ukuran perubahan per transaksi (3 sel x 45.000 karakter)
  CHUNK_CELL: 45000,
  MAX_ATTEMPTS: 3, // percobaan pemulihan sebelum rollback
  CACHE_TTL: 900, // detik; snapshot dibangun ulang tiap 15 menit bila tidak ada tulisan
  CACHE_CHUNK: 90000,
  MAX_FAIL: 5, // gagal PIN per 10 menit
  PIN_MIN: 6,
};
var OPS = 'Log_Transaksi';
var META = '_Meta';
var AKSES = 'Akses';
var OPS_HEAD = ['opId', 'actor', 'action', 'status', 'ts', 'result', 'c1', 'c2', 'c3', 'attempts'];

/* ======================= Entry point ======================= */

function doGet() {
  return out_({ ok: true, service: 'SIPRAK', time: nowParts_().now });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (x) {
    return out_({ ok: false, code: 'BAD_REQUEST', error: 'Permintaan tidak valid.' });
  }
  try {
    if (req.type === 'login') return out_(handleLogin_(req));
    if (req.type === 'state') return out_(handleState_(req));
    if (req.type === 'act') return out_(handleAct_(req));
    return out_({ ok: false, code: 'BAD_REQUEST', error: 'Tipe permintaan tidak dikenal.' });
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    // Hasil TIDAK pasti: klien akan mengulang dengan opId yang sama (aman, idempotent).
    return out_({
      ok: false,
      code: 'SERVER_ERROR',
      retryable: true,
      error: 'Gangguan server sementara. Data belum dipastikan tersimpan, mencoba lagi otomatis.',
    });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================= Handler ======================= */

function handleLogin_(req) {
  var a = authenticate_(req.actor, req.pin);
  if (a.err) return { ok: false, code: 'AUTH', error: a.err };
  return { ok: true, user: a.id };
}

function handleState_(req) {
  var a = authenticate_(req.actor, req.pin);
  if (a.err) return { ok: false, code: 'AUTH', error: a.err };
  var ver = getVersion_();
  if (req.since != null && +req.since === ver) return { ok: true, unchanged: true, v: ver };
  var snap = getSnapshot_();
  if (!snap) return { ok: false, code: 'BUSY', retryable: true, error: 'Server sibuk, mencoba lagi.' };
  return { ok: true, v: snap.v, st: snap.st, today: snap.today };
}

function handleAct_(req) {
  var opId = String(req.opId || '');
  if (!/^op_[A-Za-z0-9]{12,60}$/.test(opId)) return { ok: false, code: 'BAD_REQUEST', error: 'ID transaksi tidak valid.' };
  var action = String(req.action || '');
  var a = authenticate_(req.actor, req.pin);
  if (a.err) return { ok: false, code: 'AUTH', error: a.err };

  // jalur cepat: transaksi ini sudah pernah berhasil
  var known = cacheGetOp_(opId);
  if (known && known.status === 'COMMITTED') return replay_(known.result);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_WAIT_MS)) {
    return { ok: false, code: 'BUSY', retryable: true, error: 'Server sedang sibuk. Mencoba lagi otomatis.' };
  }
  try {
    // 1) selesaikan transaksi menggantung milik siapa pun sebelum memproses yang baru
    var rec = recover_();
    if (rec && rec.retry) {
      return { ok: false, code: 'RECOVERING', retryable: true, error: 'Menyelesaikan transaksi sebelumnya, mencoba lagi otomatis.' };
    }

    // 2) idempotensi
    var prev = findOp_(opId);
    if (prev) {
      if (prev.status === 'COMMITTED') return replay_(prev.result);
      if (prev.status === 'FAILED') {
        return { ok: false, code: 'FAILED', error: 'Transaksi gagal dan dibatalkan. Data tidak berubah. Silakan kirim ulang dari awal.' };
      }
      if (prev.status === 'PENDING') {
        // PENDING tanpa penunjuk di _Meta = belum sempat menulis data -> batalkan dan proses ulang
        setOpStatus_(prev.row, 'ABORTED', '');
      }
    }

    // 3) baca data TERBARU, jalankan aksi (validasi + izin + status saat ini)
    var read = readAll_();
    var P = nowParts_();
    var actor = null;
    for (var i = 0; i < read.state.U.length; i++) if (read.state.U[i].id === a.id) actor = read.state.U[i];
    var r = SiprakCore.runAction(read.state, action, req.args, { actor: actor, today: P.today, now: P.now, opId: opId });
    if (r.err) return { ok: false, code: 'REJECTED', error: r.err, v: getVersion_() };
    if (!r.changes.length) return { ok: true, noop: true, msg: r.ok, ids: r.ids, v: getVersion_() };

    var payload = JSON.stringify(r.changes);
    if (payload.length > CFG.MAX_PAYLOAD) {
      return { ok: false, code: 'REJECTED', error: 'Transaksi terlalu besar. Pecah menjadi beberapa bagian.' };
    }

    // 4) WAL: catat PENDING + perubahan SEBELUM menulis data
    var rowNo = appendOp_(opId, a.id, action, payload, P.now);
    setMeta_({ pendingOp: opId, pendingRow: String(rowNo) });
    SpreadsheetApp.flush();

    // 5) tulis, lalu BACA ULANG dan bandingkan
    try {
      applyChanges_(r.changes, read);
      SpreadsheetApp.flush();
      var probs = verify_(r.changes);
      if (probs.length) throw new Error('Verifikasi gagal: ' + probs.join(', '));
    } catch (e) {
      console.error('apply/verify gagal untuk ' + opId + ': ' + e);
      // PENDING dibiarkan: retry klien (opId sama) atau pemegang lock berikutnya akan menyelesaikannya.
      return {
        ok: false,
        code: 'VERIFY_FAILED',
        retryable: true,
        error: 'Data belum terverifikasi tersimpan. Mencoba lagi otomatis (aman, tidak akan ganda).',
      };
    }

    // 6) COMMIT
    var res = { ok: true, msg: r.ok, ids: r.ids };
    var v = commit_(rowNo, opId, res, P.now);
    var snap = { v: v, today: P.today, st: publicState_(r.state) };
    putSnapshot_(snap);
    return { ok: true, msg: r.ok, ids: r.ids, v: v, snap: snap };
  } finally {
    lock.releaseLock();
  }
}

function replay_(result) {
  return { ok: true, replay: true, msg: result.msg, ids: result.ids, v: getVersion_() };
}

/* ======================= Autentikasi ======================= */

function sha_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var o = '';
  for (var i = 0; i < b.length; i++) o += ('0' + (b[i] & 0xff).toString(16)).slice(-2);
  return o;
}

function loadAkses_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('akses');
  if (c) return JSON.parse(c);
  var sh = sheet_(AKSES);
  var last = sh.getLastRow();
  var map = {};
  if (last >= 2) {
    var v = sh.getRange(2, 1, last - 1, 3).getValues();
    for (var i = 0; i < v.length; i++) if (v[i][0]) map[String(v[i][0]).toLowerCase()] = { salt: String(v[i][1]), hash: String(v[i][2]) };
  }
  cache.put('akses', JSON.stringify(map), 600);
  return map;
}

// Identitas = email + PIN. Hash PIN di sheet Akses, percobaan gagal dibatasi per akun.
function authenticate_(actor, pin) {
  actor = String(actor || '').toLowerCase().trim();
  pin = String(pin || '');
  if (!actor || !pin) return { err: 'Email dan PIN wajib diisi.' };
  var cache = CacheService.getScriptCache();
  var fk = 'fail:' + actor;
  var fails = +(cache.get(fk) || 0);
  if (fails >= CFG.MAX_FAIL) return { err: 'Terlalu banyak percobaan gagal. Coba lagi 10 menit lagi.' };
  var rec = loadAkses_()[actor];
  if (!rec || sha_(rec.salt + ':' + pin) !== rec.hash) {
    cache.put(fk, String(fails + 1), 600);
    return { err: 'Email atau PIN salah.' };
  }
  cache.remove(fk);
  var snap = getSnapshot_();
  if (snap) {
    var u = null;
    for (var i = 0; i < snap.st.U.length; i++) if (snap.st.U[i].id === actor) u = snap.st.U[i];
    if (!u) return { err: 'Akun belum terdaftar sebagai pengguna.' };
    if (u.off) return { err: 'Akun nonaktif. Hubungi admin departemen.' };
  }
  return { id: actor };
}

/* ======================= Spreadsheet I/O ======================= */

function ss_() {
  var a = SpreadsheetApp.getActive();
  if (a) return a;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Script bukan container-bound: isi Script Property SHEET_ID.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) throw new Error('Sheet "' + name + '" tidak ada. Jalankan menu SIPRAK > Setup tabel.');
  return s;
}
function nowParts_() {
  var d = new Date();
  return { today: Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd'), now: Utilities.formatDate(d, CFG.TZ, "yyyy-MM-dd'T'HH:mm:ss") };
}
function cellStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
  return v == null ? '' : String(v);
}

// Baca satu tabel. pos[i] = nomor baris sheet dari rows[i]. Baris kosong dilewati.
function readTable_(t) {
  var T = SiprakCore.TABLES[t];
  var sh = sheet_(T.sheet);
  var w = SiprakCore.width(t);
  var last = sh.getLastRow();
  var rows = [], pos = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, w).getValues();
    for (var i = 0; i < vals.length; i++) {
      var a = [];
      for (var j = 0; j < w; j++) a.push(cellStr_(vals[i][j]));
      if (a[0] === '') continue;
      rows.push(SiprakCore.fromRow(t, a));
      pos.push(i + 2);
    }
  }
  return { rows: rows, pos: pos, last: Math.max(last, 1) };
}

function readAll_() {
  var state = {}, pos = {}, last = {};
  Object.keys(SiprakCore.TABLES).forEach(function (t) {
    var r = readTable_(t);
    state[t] = r.rows;
    pos[t] = r.pos;
    last[t] = r.last;
  });
  return { state: state, pos: pos, last: last };
}

function eq_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Idempotent: boleh dipanggil ulang pada perubahan yang sama (dipakai juga untuk pemulihan).
function applyChanges_(changes, read) {
  var byT = {};
  changes.forEach(function (c) {
    (byT[c.t] = byT[c.t] || []).push(c);
  });
  Object.keys(byT).forEach(function (t) {
    var T = SiprakCore.TABLES[t];
    var sh = sheet_(T.sheet);
    var w = SiprakCore.width(t);
    var idx = {};
    read.state[t].forEach(function (r, i) {
      idx[r[T.key]] = i;
    });
    var ups = [], apps = [];
    byT[t].forEach(function (c) {
      var i = idx[c.key];
      if (i !== undefined) {
        var cur = SiprakCore.toRow(t, read.state[t][i]);
        if (eq_(cur, c.row)) return; // sudah terterap
        if (c.kind === 'update' && eq_(cur, c.before)) {
          ups.push({ rowNo: read.pos[t][i], row: c.row });
          return;
        }
        throw new Error('Konflik pada ' + t + ':' + c.key + ' (data berubah di luar sistem)');
      }
      if (c.kind === 'append') apps.push(c.row);
      else throw new Error('Baris ' + t + ':' + c.key + ' tidak ditemukan untuk diubah');
    });

    // update: gabungkan baris berurutan jadi satu setValues
    ups.sort(function (a, b) {
      return a.rowNo - b.rowNo;
    });
    var s = 0;
    while (s < ups.length) {
      var e = s;
      while (e + 1 < ups.length && ups[e + 1].rowNo === ups[e].rowNo + 1) e++;
      var block = [];
      for (var k = s; k <= e; k++) block.push(ups[k].row);
      sh.getRange(ups[s].rowNo, 1, block.length, w).setNumberFormat('@').setValues(block);
      s = e + 1;
    }
    // append: tulis di bawah baris terakhir TERBARU (bukan hasil cache)
    if (apps.length) {
      var start = Math.max(sh.getLastRow(), 1) + 1;
      var need = start + apps.length - 1 - sh.getMaxRows();
      if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 200);
      sh.getRange(start, 1, apps.length, w).setNumberFormat('@').setValues(apps);
    }
  });
}

// Baca ulang dari sheet dan pastikan tiap perubahan benar-benar ada dan isinya sama.
function verify_(changes) {
  var probs = [];
  var seenT = {};
  changes.forEach(function (c) {
    seenT[c.t] = true;
  });
  Object.keys(seenT).forEach(function (t) {
    var key = SiprakCore.TABLES[t].key;
    var tab = readTable_(t);
    var map = {}, dup = {};
    tab.rows.forEach(function (r) {
      var k = r[key];
      if (map[k]) dup[k] = true;
      map[k] = SiprakCore.toRow(t, r);
    });
    changes.forEach(function (c) {
      if (c.t !== t) return;
      if (!map[c.key] || !eq_(map[c.key], c.row)) probs.push(t + ':' + c.key);
      if (dup[c.key]) probs.push(t + ':' + c.key + ' ganda');
    });
  });
  return probs;
}

/* ======================= _Meta & log transaksi ======================= */

function readMeta_() {
  var v = sheet_(META).getRange(1, 1, 3, 2).getValues();
  return { version: +v[0][1] || 0, pendingOp: String(v[1][1] || ''), pendingRow: String(v[2][1] || '') };
}
function setMeta_(o) {
  var sh = sheet_(META);
  var m = readMeta_();
  var n = {
    version: o.version != null ? o.version : m.version,
    pendingOp: o.pendingOp != null ? o.pendingOp : m.pendingOp,
    pendingRow: o.pendingRow != null ? o.pendingRow : m.pendingRow,
  };
  sh.getRange(1, 2, 3, 1).setValues([[String(n.version)], [n.pendingOp], [n.pendingRow]]);
}
function getVersion_() {
  var c = CacheService.getScriptCache().get('ver');
  if (c != null) return +c;
  var v = readMeta_().version;
  CacheService.getScriptCache().put('ver', String(v), CFG.CACHE_TTL);
  return v;
}

function appendOp_(opId, actor, action, payload, ts) {
  var sh = sheet_(OPS);
  var cs = [payload.slice(0, CFG.CHUNK_CELL), payload.slice(CFG.CHUNK_CELL, 2 * CFG.CHUNK_CELL), payload.slice(2 * CFG.CHUNK_CELL)];
  var row = [opId, actor, action, 'PENDING', ts, '', cs[0], cs[1], cs[2], '1'];
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var need = start - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 200);
  sh.getRange(start, 1, 1, OPS_HEAD.length).setNumberFormat('@').setValues([row]);
  return start;
}
function setOpStatus_(rowNo, status, resultJson) {
  var sh = sheet_(OPS);
  sh.getRange(rowNo, 4, 1, 3).setValues([[status, nowParts_().now, resultJson || '']]);
}
function cacheGetOp_(opId) {
  var c = CacheService.getScriptCache().get('op:' + opId);
  return c ? JSON.parse(c) : null;
}

// Cari transaksi terbaru dengan opId ini pada jendela OPS_SCAN baris terakhir.
function findOp_(opId) {
  var hit = cacheGetOp_(opId);
  if (hit && hit.status === 'COMMITTED') return hit;
  var sh = sheet_(OPS);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var from = Math.max(2, last - CFG.OPS_SCAN + 1);
  var ids = sh.getRange(from, 1, last - from + 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) !== opId) continue;
    var rowNo = from + i;
    var v = sh.getRange(rowNo, 1, 1, OPS_HEAD.length).getValues()[0];
    var res = null;
    try {
      res = v[5] ? JSON.parse(v[5]) : null;
    } catch (x) {}
    return { row: rowNo, status: String(v[3]), result: res };
  }
  return null;
}

function commit_(rowNo, opId, res, ts) {
  setOpStatus_(rowNo, 'COMMITTED', JSON.stringify(res));
  var v = readMeta_().version + 1;
  setMeta_({ version: v, pendingOp: '', pendingRow: '' });
  CacheService.getScriptCache().put('op:' + opId, JSON.stringify({ status: 'COMMITTED', result: res }), 21600);
  return v;
}

/* ======================= Pemulihan crash ======================= */

// Selesaikan transaksi PENDING (roll-forward). Setelah MAX_ATTEMPTS gagal -> rollback + FAILED.
// Hanya dipanggil saat memegang lock.
function recover_() {
  var m = readMeta_();
  if (!m.pendingOp) return null;
  var sh = sheet_(OPS);
  var rowNo = +m.pendingRow;
  var row = rowNo >= 2 ? sh.getRange(rowNo, 1, 1, OPS_HEAD.length).getValues()[0] : null;
  if (!row || String(row[0]) !== m.pendingOp) {
    setMeta_({ pendingOp: '', pendingRow: '' }); // penunjuk rusak: tidak ada yang bisa dipulihkan
    return null;
  }
  var status = String(row[3]);
  if (status === 'COMMITTED') {
    // crash terjadi di antara menandai COMMITTED dan mengosongkan pending: naikkan versi saja
    setMeta_({ version: readMeta_().version + 1, pendingOp: '', pendingRow: '' });
    dropCaches_();
    return { done: true };
  }
  if (status !== 'PENDING') {
    setMeta_({ pendingOp: '', pendingRow: '' });
    return null;
  }
  var changes = JSON.parse(String(row[6]) + String(row[7]) + String(row[8]));
  var attempts = (+row[9] || 0) + 1;
  sh.getRange(rowNo, 10).setValue(String(attempts));
  try {
    var read = readAll_();
    applyChanges_(changes, read);
    SpreadsheetApp.flush();
    var probs = verify_(changes);
    if (probs.length) throw new Error('Verifikasi gagal: ' + probs.join(', '));
    var res = { ok: true, msg: 'Tersimpan (dipulihkan otomatis).', ids: ids_(changes) };
    commit_(rowNo, m.pendingOp, res, nowParts_().now);
    dropCaches_();
    return { done: true };
  } catch (e) {
    console.error('pemulihan ' + m.pendingOp + ' percobaan ' + attempts + ': ' + e);
    if (attempts < CFG.MAX_ATTEMPTS) return { retry: true };
    try {
      rollback_(changes);
    } catch (x) {
      console.error('rollback gagal: ' + x);
    }
    setOpStatus_(rowNo, 'FAILED', JSON.stringify({ error: String(e) }));
    setMeta_({ pendingOp: '', pendingRow: '' });
    dropCaches_();
    return { failed: true };
  }
}

function ids_(changes) {
  var o = [];
  changes.forEach(function (c) {
    if (c.kind === 'append') o.push(c.key);
  });
  return o;
}

// Batalkan sisa perubahan transaksi yang gagal: kembalikan baris lama, hapus baris baru milik transaksi ini.
function rollback_(changes) {
  var read = readAll_();
  var del = {};
  changes.forEach(function (c) {
    var T = SiprakCore.TABLES[c.t];
    var sh = sheet_(T.sheet);
    var i = -1;
    read.state[c.t].forEach(function (r, n) {
      if (r[T.key] === c.key) i = n;
    });
    if (i < 0) return;
    var rowNo = read.pos[c.t][i];
    if (c.kind === 'update') {
      if (eq_(SiprakCore.toRow(c.t, read.state[c.t][i]), c.row))
        sh.getRange(rowNo, 1, 1, SiprakCore.width(c.t)).setNumberFormat('@').setValues([c.before]);
    } else if (eq_(SiprakCore.toRow(c.t, read.state[c.t][i]), c.row)) {
      (del[c.t] = del[c.t] || []).push(rowNo);
    }
  });
  Object.keys(del).forEach(function (t) {
    del[t].sort(function (a, b) {
      return b - a;
    });
    del[t].forEach(function (rn) {
      sheet_(SiprakCore.TABLES[t].sheet).deleteRow(rn);
    });
  });
  SpreadsheetApp.flush();
}

/* ======================= Snapshot cache (baca cepat untuk 40 user) ======================= */

function stripSys_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) {
    if (k.charAt(0) !== '_') o[k] = r[k];
  });
  return o;
}
function publicState_(state) {
  var o = {};
  Object.keys(state).forEach(function (t) {
    o[t] = state[t].map(stripSys_);
  });
  return o;
}

function putBig_(key, str) {
  var cache = CacheService.getScriptCache();
  var gz = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(str, 'application/json', 'x.json')).getBytes());
  var parts = {};
  var n = Math.ceil(gz.length / CFG.CACHE_CHUNK);
  for (var i = 0; i < n; i++) parts[key + ':' + i] = gz.slice(i * CFG.CACHE_CHUNK, (i + 1) * CFG.CACHE_CHUNK);
  parts[key + ':n'] = String(n);
  cache.putAll(parts, CFG.CACHE_TTL);
}
function getBig_(key) {
  var cache = CacheService.getScriptCache();
  var n = +cache.get(key + ':n');
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + ':' + i);
  var got = cache.getAll(keys);
  var s = '';
  for (var j = 0; j < n; j++) {
    if (got[keys[j]] == null) return null;
    s += got[keys[j]];
  }
  return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip', 'x.gz')).getDataAsString();
}
function dropCaches_() {
  var c = CacheService.getScriptCache();
  c.remove('ver');
  c.remove('snap:n');
}
function putSnapshot_(snap) {
  try {
    putBig_('snap', JSON.stringify(snap)); // snapshot dulu, versi belakangan
    CacheService.getScriptCache().put('ver', String(snap.v), CFG.CACHE_TTL);
  } catch (e) {
    console.error('cache gagal (diabaikan): ' + e);
    dropCaches_();
  }
}

// Snapshot dari cache; bila kosong, satu pemohon membangun ulang di dalam lock (anti-stampede).
function getSnapshot_() {
  var ver = getVersion_();
  var s = getBig_('snap');
  if (s) {
    var o = JSON.parse(s);
    if (o.v >= ver) return o;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_WAIT_MS)) return null;
  try {
    var again = getBig_('snap');
    if (again) {
      var o2 = JSON.parse(again);
      if (o2.v >= getVersion_()) return o2;
    }
    recover_();
    var read = readAll_();
    var snap = { v: readMeta_().version, today: nowParts_().today, st: publicState_(read.state) };
    putSnapshot_(snap);
    return snap;
  } finally {
    lock.releaseLock();
  }
}

/* ======================= Setup & administrasi (menu SIPRAK di Spreadsheet) ======================= */

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('SIPRAK')
      .addItem('1. Setup tabel', 'setup')
      .addItem('2. Isi data demo (hanya jika kosong)', 'setupDemo')
      .addItem('3. Atur PIN pengguna', 'menuAturPin')
      .addItem('Cek konsistensi data', 'cekKonsistensi')
      .addItem('Rapikan log transaksi', 'rapikanLog')
      .addToUi();
  } catch (e) {}
}

function ensureSheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (cur.join('|') !== headers.join('|')) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getMaxColumns(), headers.length)).setNumberFormat('@'); // semua teks: tidak ada auto-konversi
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sh;
}

function setup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Object.keys(SiprakCore.TABLES).forEach(function (t) {
      var T = SiprakCore.TABLES[t];
      var sh = ensureSheet_(T.sheet, T.cols.concat(SiprakCore.SYS));
      var prot = sh.protect().setDescription('Diubah hanya lewat aplikasi SIPRAK');
      prot.setWarningOnly(true);
    });
    ensureSheet_(OPS, OPS_HEAD);
    var meta = ensureSheet_(META, ['key', 'value']);
    if (!String(meta.getRange(2, 1).getValue())) meta.getRange(1, 1, 3, 2).setValues([['version', '0'], ['pendingOp', ''], ['pendingRow', '']]);
    ensureSheet_(AKSES, ['id', 'salt', 'hash', 'updated']);
    dropCaches_();
    return 'Setup selesai.';
  } finally {
    lock.releaseLock();
  }
}

function setupDemo() {
  setup();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var P = nowParts_();
    var db = SiprakCore.buildSeed(P.today);
    var tables = Object.keys(SiprakCore.TABLES);
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var T = SiprakCore.TABLES[t];
      var sh = sheet_(T.sheet);
      if (sh.getLastRow() >= 2) throw new Error('Sheet ' + T.sheet + ' sudah berisi data. Demo hanya untuk sheet kosong.');
    }
    tables.forEach(function (t) {
      var T = SiprakCore.TABLES[t];
      var rows = db[t].map(function (r) {
        r._cr = P.now;
        r._ts = P.now;
        r._op = 'seed';
        r._by = 'seed';
        return SiprakCore.toRow(t, r);
      });
      if (rows.length) sheet_(T.sheet).getRange(2, 1, rows.length, SiprakCore.width(t)).setNumberFormat('@').setValues(rows);
    });
    db.U.forEach(function (u) {
      setPin_(u.id, '123456');
    });
    dropCaches_();
    return 'Demo terisi. Semua pengguna demo memakai PIN 123456. WAJIB diganti sebelum dipakai sungguhan.';
  } finally {
    lock.releaseLock();
  }
}

function setPin_(email, pin) {
  email = String(email).toLowerCase().trim();
  if (String(pin).length < CFG.PIN_MIN) throw new Error('PIN minimal ' + CFG.PIN_MIN + ' karakter.');
  var sh = sheet_(AKSES);
  var salt = Utilities.getUuid();
  var row = [email, salt, sha_(salt + ':' + pin), nowParts_().now];
  var last = sh.getLastRow();
  var at = 0;
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).toLowerCase() === email) at = i + 2;
  }
  if (!at) at = Math.max(last, 1) + 1;
  sh.getRange(at, 1, 1, 4).setNumberFormat('@').setValues([row]);
  CacheService.getScriptCache().remove('akses');
  CacheService.getScriptCache().remove('fail:' + email);
}

// Bisa dipanggil dari editor: setPin('budi@perusahaan.com', 'rahasia123')
function setPin(email, pin) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    setPin_(email, pin);
  } finally {
    lock.releaseLock();
  }
}

function menuAturPin() {
  var ui = SpreadsheetApp.getUi();
  var e = ui.prompt('Email pengguna (sama dengan kolom id di sheet Users)');
  if (e.getSelectedButton() !== ui.Button.OK) return;
  var p = ui.prompt('PIN baru (minimal ' + CFG.PIN_MIN + ' karakter)');
  if (p.getSelectedButton() !== ui.Button.OK) return;
  setPin(e.getResponseText(), p.getResponseText());
  ui.alert('PIN tersimpan.');
}

function cekKonsistensi() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var read = readAll_();
    var s = read.state, msg = [];
    Object.keys(SiprakCore.TABLES).forEach(function (t) {
      var key = SiprakCore.TABLES[t].key, seen = {};
      s[t].forEach(function (r) {
        if (seen[r[key]]) msg.push('Kunci ganda ' + t + ':' + r[key]);
        seen[r[key]] = 1;
      });
    });
    var has = function (t, k, v) {
      return s[t].some(function (r) {
        return r[k] === v;
      });
    };
    s.I.forEach(function (i) {
      if (!has('R', 'id', i.req)) msg.push('Item ' + i.id + ' mengacu ke request tidak ada: ' + i.req);
      if (!has('M', 'k', i.kode)) msg.push('Item ' + i.id + ' mengacu ke barang tidak ada: ' + i.kode);
      if (i.kon && !has('K', 'id', i.kon)) msg.push('Item ' + i.id + ' mengacu ke konsolidasi tidak ada: ' + i.kon);
    });
    s.KD.forEach(function (d) {
      if (!has('K', 'id', d.kon)) msg.push('Kedatangan ' + d.id + ' mengacu ke konsolidasi tidak ada: ' + d.kon);
    });
    s.SR.forEach(function (d) {
      if (!has('I', 'id', d.item)) msg.push('Serah terima ' + d.id + ' mengacu ke item tidak ada: ' + d.item);
    });
    var m = readMeta_();
    if (m.pendingOp) msg.push('Ada transaksi PENDING: ' + m.pendingOp + ' (akan selesai otomatis pada tulis berikutnya)');
    var out = msg.length ? msg.join('\n') : 'Data konsisten. Tidak ada kunci ganda atau referensi putus.';
    try {
      SpreadsheetApp.getUi().alert(out);
    } catch (e) {}
    return out;
  } finally {
    lock.releaseLock();
  }
}

function rapikanLog() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (readMeta_().pendingOp) return 'Ada transaksi PENDING, rapikan nanti.';
    var sh = sheet_(OPS);
    var last = sh.getLastRow();
    var del = last - 1 - CFG.OPS_KEEP;
    if (del > 0) sh.deleteRows(2, del);
    return del > 0 ? del + ' baris log lama dihapus.' : 'Log masih di bawah batas.';
  } finally {
    lock.releaseLock();
  }
}
