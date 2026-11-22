/**
 * Migrasi satu kali dari format lama.
 *
 * Dulu kolom pengguna di Konsolidasi.by, Kedatangan.by, SerahTerima.to, dan Pengingat.by berisi NAMA.
 * Sekarang semua kolom relasi berisi ID pengguna. Jalankan migrate() SEKALI dari editor setelah memperbarui kode;
 * aman diulang (nilai yang sudah berupa ID dilewati). Lanjutkan dengan audit() untuk memastikan hasilnya bersih.
 */

var MIGRATE_COLS = [['K', 'by'], ['KD', 'by'], ['SR', 'to'], ['RM', 'by']];

function migrate() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_(), byId = {}, byName = {}, changed = 0, touched = [], report = [];
    readTable_(ss, 'U').forEach(function (u) {
      byId[u.id] = true;
      var k = u.n.toLowerCase().trim();
      byName[k] = has_(byName, k) ? null : u.id;   // null = nama ganda, tidak bisa dipastikan
    });

    MIGRATE_COLS.forEach(function (tc) {
      var t = tc[0], col = tc[1], S = SCHEMA[t], sh = sheet_(ss, t), last = sh.getLastRow();
      if (last < 2) return;
      var rng = sh.getRange(2, S.cols.indexOf(col) + 1, last - 1, 1), vals = rng.getValues(), dirty = false;
      vals.forEach(function (row, i) {
        var v = String(row[0] == null ? '' : row[0]).trim(), key = v.toLowerCase();
        if (!v || has_(byId, v)) return;
        if (byName[key]) { row[0] = byName[key]; dirty = true; changed++; }
        else report.push(S.sheet + ' baris ' + (i + 2) + ': "' + v + '" ' + (byName[key] === null ? 'cocok dengan lebih dari satu pengguna' : 'tidak cocok dengan pengguna mana pun'));
      });
      if (dirty) { rng.setValues(vals); touched.push(t); }
    });

    if (touched.length) { SpreadsheetApp.flush(); bump_(touched); }
    var out = changed + ' sel diubah dari nama menjadi ID.' + (report.length ? '\nPerlu dibetulkan manual:\n- ' + report.join('\n- ') : '');
    Logger.log(out);
    return out;
  } finally {
    lock.releaseLock();
  }
}
