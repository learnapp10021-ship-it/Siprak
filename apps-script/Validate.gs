/**
 * Pemeriksaan relasi dan aturan data. Aturan kolom ada di REL (Schema.gs); aturan lintas tabel ada di bawah.
 *
 * Tiap pelanggaran = { m: pesan, c: true bila akibat benturan dengan pengguna lain (klien cukup memuat ulang) }.
 * Dipakai oleh mutate_ (hanya baris yang diubah), writeAll_ (data awal), dan audit() (seluruh database).
 */

var EPS = 1e-9;

/** Peta bantu: kunci -> baris per tabel, anak-anak per induk, dan log per induk. */
function buildState_(tables) {
  var st = { rows: tables, by: {}, kids: {}, kd: {}, sr: {} };
  TABLES.forEach(function (t) {
    var key = SCHEMA[t].key;
    if (!key) return;
    var m = st.by[t] = {};
    (tables[t] || []).forEach(function (r) { m[r[key]] = r; });
  });
  (tables.I || []).forEach(function (i) { if (i.kon) push_(st.kids, i.kon, i); });
  (tables.KD || []).forEach(function (d) { push_(st.kd, d.kon, d); });
  (tables.SR || []).forEach(function (s) { push_(st.sr, s.item, s); });
  return st;
}

function push_(map, k, v) { (map[k] = map[k] || []).push(v); }
function sum_(a, f) { return a.reduce(function (s, x) { return s + (+f(x) || 0); }, 0); }
function isNum_(v) { return PAT.num.test(v); }

/** Periksa satu nilai terhadap aturan kolom. Mengembalikan pesan galat, atau '' bila sah. */
function checkCell_(rule, v, st) {
  var m = /^([a-z0-9]+)(\?)?(?::(.+))?$/.exec(rule), kind = m[1], opt = !!m[2], arg = m[3];
  if (v === '') return opt || kind === 'text' ? '' : 'wajib diisi';
  switch (kind) {
    case 'req': case 'text': return '';
    case 'date':  return PAT.date.test(v) ? '' : 'harus tanggal YYYY-MM-DD';
    case 'dtm':   return PAT.dtm.test(v) ? '' : 'harus tanggal (YYYY-MM-DD) atau tanggal-jam';
    case 'phone': return PAT.phone.test(v) ? '' : 'nomor WA harus berbentuk 628xxxxxxxxx';
    case 'flag':  return PAT.flag.test(v) ? '' : 'harus 0 atau 1';
    case 'yn':    return v === 'Y' ? '' : "harus kosong atau 'Y'";
    case 'pos':   return isNum_(v) && +v > 0 ? '' : 'harus angka lebih dari 0';
    case 'num0':  return isNum_(v) ? '' : 'harus angka 0 atau lebih';
    case 'int0':  return PAT.int.test(v) ? '' : 'harus bilangan bulat 0 atau lebih';
    case 'enum':  return ENUM[arg].indexOf(v) >= 0 ? '' : "'" + v + "' tidak dikenal (pilihan: " + ENUM[arg].join(', ') + ')';
    case 'id':    return new RegExp('^' + arg + '-\\d{3,}$').test(v) ? '' : 'format harus ' + arg + '-001';
    case 'fk':    return st.by[arg] && has_(st.by[arg], v) ? '' : "'" + v + "' tidak ada di sheet " + SCHEMA[arg].sheet;
  }
  return 'aturan tidak dikenal: ' + rule;
}

/** Nama baris untuk pesan galat, mis. "Item ITM-004". */
function label_(t, row) {
  var S = SCHEMA[t];
  return S.sheet + ' ' + (S.key ? row[S.key] : '[' + row[S.cols[0]] + ']');
}

/** Periksa baris-baris yang diubah: aturan kolom + aturan lintas tabel. rows = [{ t, row }] */
function validateRows_(st, rows) {
  var errs = [];
  var add = function (t, row, msg, conflict) { errs.push({ m: label_(t, row) + ': ' + msg, c: !!conflict }); };

  rows.forEach(function (x) {
    var t = x.t, row = x.row, rules = REL[t], before = errs.length;
    Object.keys(rules).forEach(function (col) {
      var msg = checkCell_(rules[col], row[col], st);
      if (msg) add(t, row, 'kolom ' + col + ' ' + msg);
    });
    if (errs.length === before) links_(t, row, st, add);   // aturan lintas tabel hanya bila kolomnya sudah sah
  });
  return errs;
}

/** Aturan lintas tabel untuk satu baris. Dipanggil setelah aturan kolomnya lolos. */
function links_(t, row, st, add) {
  var a = function (msg, conflict) { add(t, row, msg, conflict); };

  if (t === 'U' && row.boss) {
    var boss = st.by.U[row.boss];
    if (row.boss === row.id) a('atasan tidak boleh diri sendiri');
    else if (boss && boss.role !== 'Atasan') a("atasan '" + row.boss + "' harus ber-role Atasan");
  }

  if (t === 'I') {
    var inKon = IN_KON.indexOf(row.status) >= 0;
    if (inKon && !row.kon) a('status ' + row.status + ' wajib terhubung ke Konsolidasi (kolom kon)');
    if (!inKon && row.kon) a("kolom kon harus kosong untuk status '" + row.status + "'");
    var k = row.kon && st.by.K[row.kon];
    if (k && k.kode !== row.kode) a('kode barang ' + row.kode + ' tidak sama dengan Konsolidasi ' + k.id + ' (' + k.kode + ')');
    if (k && inKon && k.tahap !== row.status) a("status '" + row.status + "' tidak sama dengan tahap SRL '" + k.tahap + "'");
  }

  if (t === 'K') {
    var l = st.by.L[row.srl];
    if (l && l.dept !== row.dept) a('departemen ' + row.dept + ' tidak sama dengan SRL ' + l.no + ' (' + l.dept + ')');
    var kids = st.kids[row.id] || [];
    if (row.tahap === 'Dikeluarkan' && kids.length) a("tahap 'Dikeluarkan' tetapi masih ada barang di dalamnya");
    if (row.tahap !== 'Dikeluarkan') kids.forEach(function (i) {
      if (i.status !== row.tahap) a('barang ' + i.id + " berstatus '" + i.status + "' tetapi tahap SRL '" + row.tahap + "'");
    });
    checkArrival_(row, st, a);
  }

  if (t === 'KD') {
    var kk = st.by.K[row.kon];
    if (!(+row.qty > 0) && !(+row.lebih > 0)) a('isi qty datang atau qty lebih');
    if (kk && kk.tahap !== 'Sudah di ERO') a('SRL ' + kk.srl + " belum divalidasi Warehouse (tahap '" + kk.tahap + "')");
    if (kk) checkArrival_(kk, st, a);
  }

  if (t === 'SR') {
    var it = st.by.I[row.item];
    if (!it) return;
    if (it.status !== 'Sudah di ERO') a("barang '" + it.id + "' belum berstatus Sudah di ERO");
    var handed = sum_(st.sr[it.id] || [], function (s) { return s.qty; });
    if (handed > +it.qty + EPS) a('total diserahkan ' + handed + ' melebihi qty request ' + it.qty, true);
    var kon = st.by.K[it.kon];
    if (kon) {
      var out = sum_(st.kids[kon.id] || [], function (i) { return sum_(st.sr[i.id] || [], function (s) { return s.qty; }); });
      var got = sum_(st.kd[kon.id] || [], function (d) { return d.qty; });
      if (out > got + EPS) a('total diserahkan ' + out + ' melebihi barang yang sudah datang ' + got, true);
    }
  }
}

/** Barang datang + sisa yang ditutup tidak boleh melebihi total yang diminta. */
function checkArrival_(k, st, a) {
  var total = sum_((st.kids[k.id] || []).filter(function (i) { return DEAD.indexOf(i.status) < 0; }), function (i) { return i.qty; });
  var got = sum_(st.kd[k.id] || [], function (d) { return d.qty; });
  if (got + (+k.tutup || 0) > total + EPS)
    a('datang ' + got + ' + ditutup ' + (+k.tutup || 0) + ' melebihi total request ' + total, true);
}

/** Periksa seluruh tabel (data awal / audit). */
function validateAll_(tables) {
  var st = buildState_(tables), rows = [], errs = [];
  TABLES.forEach(function (t) {
    var S = SCHEMA[t], seen = {};
    (tables[t] || []).forEach(function (r) {
      if (S.key) {
        if (has_(seen, r[S.key])) errs.push({ m: label_(t, r) + ': kunci ganda', c: false });
        seen[r[S.key]] = true;
      }
      rows.push({ t: t, row: r });
    });
  });
  return errs.concat(validateRows_(st, rows));
}

/**
 * Jalankan dari editor Apps Script untuk memeriksa seluruh database (mis. setelah mengedit sheet manual).
 * Hasil ada di Execution log; tidak mengubah data apa pun.
 */
function audit() {
  var ss = ss_(), tables = {};
  TABLES.forEach(function (t) { tables[t] = readTable_(ss, t); });
  var errs = validateAll_(tables);
  var out = errs.length ? errs.length + ' pelanggaran:\n' + errs.slice(0, 100).map(function (e) { return '- ' + e.m; }).join('\n') : 'Database bersih: semua relasi dan aturan data terpenuhi.';
  Logger.log(out);
  return out;
}
