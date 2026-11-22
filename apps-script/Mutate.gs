/**
 * Penerapan perubahan dari aplikasi.
 *
 * Satu panggilan = satu lock = satu setValues per tabel, dan atomik: semua operasi diperiksa dulu di memori
 * (kunci, relasi, nilai, jumlah), baru ditulis. Bila ada yang ditolak, tidak ada yang berubah.
 *
 *   'add' pada tabel berkunci gagal bila kunci sudah ada (mis. dua orang membuat RQ-013 bersamaan);
 *   'set' gagal bila barisnya sudah tidak ada. Klien lalu memuat ulang data.
 */

var MAX_OPS = 1000;

function conflict_(msg) { return { conflict: true, message: msg }; }

function mutate_(ops) {
  if (!ops || !ops.length) return { ok: true, ver: getVer_(), base: getVer_() };
  if (ops.length > MAX_OPS) throw new Error('Terlalu banyak operasi sekaligus.');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_();
    var byT = groupOps_(ops);
    var plan = plan_(ss, byT);       // tahap 1: susun hasil di memori
    checkPlan_(plan);                // tahap 1b: relasi dan aturan data
    var base = getVer_();
    commit_(ss, plan);               // tahap 2: tulis ke sheet
    return { ok: true, ver: bump_(plan.map(function (p) { return p.t; })), base: base };
  } finally {
    lock.releaseLock();
  }
}

/** Kelompokkan operasi per tabel (urutan dipertahankan) setelah memastikan bentuknya benar. */
function groupOps_(ops) {
  var byT = {};
  ops.forEach(function (o) {
    if (!o || !SCHEMA[o.t]) throw new Error('Tabel tidak dikenal: ' + (o && o.t));
    if (o.op !== 'add' && o.op !== 'set') throw new Error('Operasi tidak dikenal: ' + o.op);
    if (!o.row || typeof o.row !== 'object') throw new Error('Baris kosong pada tabel ' + o.t);
    (byT[o.t] = byT[o.t] || []).push(o);
  });
  return byT;
}

/** Hasil akhir tiap tabel yang disentuh (array baris) + daftar baris yang diubah. Belum ada yang ditulis. */
function plan_(ss, byT) {
  var plan = [];
  Object.keys(byT).forEach(function (t) {
    var S = SCHEMA[t], kIdx = S.key ? S.cols.indexOf(S.key) : -1;
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
        if (kIdx >= 0 && has_(index, row[kIdx]))
          throw conflict_(S.sheet + ': ' + row[kIdx] + ' sudah ada (dibuat pengguna lain).');
        rows.push(row);
        if (kIdx >= 0) index[row[kIdx]] = rows.length - 1;
      } else {
        if (kIdx < 0) throw new Error('Tabel ' + t + ' hanya mendukung add.');
        if (!has_(index, row[kIdx])) throw conflict_(S.sheet + ': ' + row[kIdx] + ' tidak ditemukan.');
        rows[index[row[kIdx]]] = row;
        rewrite = true;
      }
      touched.push(row);
    });
    plan.push({ t: t, w: S.cols.length, rows: rows, base: base, rewrite: rewrite, physical: physical, touched: touched });
  });
  return plan;
}

/** Periksa relasi & aturan data pada keadaan sesudah perubahan; lempar galat bila ada pelanggaran. */
function checkPlan_(plan) {
  var tables = readAll_().tables, touched = [];
  plan.forEach(function (p) {
    tables[p.t] = rowsToObjs_(p.t, p.rows);
    p.touched.forEach(function (r) { touched.push({ t: p.t, row: rowToObj_(p.t, r) }); });
  });
  var errs = validateRows_(buildState_(tables), touched);
  if (!errs.length) return;
  var msg = errs.slice(0, 3).map(function (e) { return e.m; }).join(' | ');
  if (errs.some(function (e) { return e.c; })) throw conflict_(msg);
  throw new Error('Data tidak valid: ' + msg);
}

/** Hanya-tambah => tulis ekor saja; ada perubahan => tulis ulang tabel (kecil, 1 panggilan). */
function commit_(ss, plan) {
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
}

function has_(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

function rowToObj_(t, arr) {
  var o = {};
  SCHEMA[t].cols.forEach(function (c, i) { o[c] = arr[i]; });
  return o;
}

function rowsToObjs_(t, rows) {
  return rows.map(function (r) { return rowToObj_(t, r); });
}
