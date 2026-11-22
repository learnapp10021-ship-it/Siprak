/**
 * SIPRAK — pengingat WhatsApp lewat Fonnte, pengaturan, dan fasilitas go live.
 *
 * Prinsip:
 *  - Tiap departemen punya perangkat Fonnte sendiri (nomor WA Admin Dept). Token disimpan di Script Properties
 *    (tidak ada di sheet, tidak pernah dikirim ke aplikasi/klien, tidak tampil di ?fn=all).
 *  - Pengingat berjalan otomatis tiap hari (trigger) dan juga bisa dijalankan dari menu SIPRAK.
 *  - Mode SIMULASI (bawaan) tidak mengirim apa pun: hanya mencatat di sheet LogWA apa yang AKAN dikirim.
 *    Ganti ke LIVE setelah tes kirim berhasil.
 *
 * Siapa mengirim ke siapa (perangkat pengirim, urutan prioritas; perangkat yang nomornya sama dengan penerima dilewati):
 *  - Barang siap diambil   -> PIC pemohon          : perangkat dept PIC, lalu Warehouse, lalu dept lain
 *  - Request menunggu      -> Atasan               : perangkat dept atasan, lalu Warehouse, lalu dept lain
 *  - Pool belum dibuat ERO -> Admin Dept           : perangkat Warehouse, lalu dept lain, lalu dept sendiri
 *  - SRL menunggu validasi -> Admin Warehouse      : perangkat dept pemilik SRL, lalu dept lain, lalu Warehouse
 *
 * Endpoint web (doGet/doPost) tidak punya jalur apa pun ke fungsi di file ini.
 */

var FONNTE_URL = 'https://api.fonnte.com/send';
var LOG_SHEET = 'LogWA';
var LOG_COLS = ['waktu', 'jenis', 'kunci', 'penerima', 'nomor', 'pengirim', 'status', 'detail', 'pesan'];
var BY_AUTO = 'WA Otomatis';           // nilai kolom "by" di sheet Pengingat untuk pengingat otomatis
var TABEL_TRANSAKSI = ['R', 'I', 'K', 'L', 'KD', 'SR', 'RM'];
var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

var CFG_DEFAULT = {
  mode: 'simulasi',        // 'simulasi' | 'live'
  jam: 8,                  // jam kirim harian (WIB)
  hari: [1, 2, 3, 4, 5, 6],// hari kirim: 1=Senin ... 7=Minggu
  minHariSiap: 1,          // barang baru diingatkan setelah sekian hari di gudang
  ulangHari: 2,            // jarak antar pengingat barang yang sama (hari)
  maksIngat: 5,            // batas jumlah pengingat per barang
  minHariApproval: 1,      // request baru diingatkan ke atasan setelah sekian hari
  minHariPool: 1,          // barang disetujui baru diingatkan ke Admin Dept setelah sekian hari
  ulangAdmin: 1,           // jarak pengingat ke atasan/admin (hari)
  jedaMin: 2,              // jeda antar pesan (detik), acak antara min-max
  jedaMax: 5,
  maksKirim: 60,           // batas pesan per sekali jalan
  appUrl: ''               // tautan aplikasi yang ditambahkan di pesan (opsional)
};

/* ------------------------------------------------------------- Properti */

function props_() { return PropertiesService.getScriptProperties(); }
function jget_(k, def) {
  try { var s = props_().getProperty(k); return s ? JSON.parse(s) : def; } catch (e) { return def; }
}
function jset_(k, v) { props_().setProperty(k, JSON.stringify(v)); }

function cfg_() {
  var c = jget_('WA_CFG', {}), o = {};
  Object.keys(CFG_DEFAULT).forEach(function (k) { o[k] = c[k] !== undefined ? c[k] : CFG_DEFAULT[k]; });
  return o;
}

function cleanCfg_(c) {
  function n(v, min, max, def) { v = parseInt(v, 10); return isFinite(v) ? Math.min(max, Math.max(min, v)) : def; }
  var d = CFG_DEFAULT, o = {};
  o.mode = c.mode === 'live' ? 'live' : 'simulasi';
  o.jam = n(c.jam, 0, 23, d.jam);
  var h = (c.hari || []).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x >= 1 && x <= 7; });
  o.hari = h.length ? h.filter(function (x, i) { return h.indexOf(x) === i; }).sort() : d.hari;
  o.minHariSiap = n(c.minHariSiap, 0, 30, d.minHariSiap);
  o.ulangHari = n(c.ulangHari, 1, 30, d.ulangHari);
  o.maksIngat = n(c.maksIngat, 1, 50, d.maksIngat);
  o.minHariApproval = n(c.minHariApproval, 0, 30, d.minHariApproval);
  o.minHariPool = n(c.minHariPool, 0, 30, d.minHariPool);
  o.ulangAdmin = n(c.ulangAdmin, 1, 30, d.ulangAdmin);
  o.jedaMin = n(c.jedaMin, 0, 60, d.jedaMin);
  o.jedaMax = Math.max(o.jedaMin, n(c.jedaMax, 0, 120, d.jedaMax));
  o.maksKirim = n(c.maksKirim, 1, 200, d.maksKirim);
  var u = String(c.appUrl || '').trim();
  if (u && !/^https?:\/\/\S+$/i.test(u)) throw new Error('Tautan aplikasi harus diawali http:// atau https://');
  o.appUrl = u;
  return o;
}

/* --------------------------------------------------------------- Helper */

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm"); }
function dow_() { return +Utilities.formatDate(new Date(), TZ, 'u'); }   // 1=Senin ... 7=Minggu
// Cap waktu untuk log: sekarang, atau sekarang dikurangi msAgo milidetik.
function stamp_(msAgo) { return Utilities.formatDate(new Date(Date.now() - (msAgo || 0)), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function dayDiff_(a, b) { return Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 864e5); }
function daysSince_(d, today) { return d ? Math.max(0, dayDiff_(d, today)) : 0; }
function fmtTgl_(d) {
  var p = String(d || '').slice(0, 10).split('-');
  return p.length === 3 ? (+p[2]) + ' ' + BULAN[+p[1] - 1] : '-';
}
function fmtQty_(x) { return String(Math.round(+x * 100) / 100).replace('.', ','); }

// Nomor WhatsApp: normalisasi ke 628xxxxxxxxx; kosong bila tidak valid (sama dengan src/lib/utils.js).
function waNorm_(s) {
  var d = String(s || '').replace(/\D/g, '');
  if (d.indexOf('0') === 0) d = '62' + d.slice(1);
  return /^628\d{8,11}$/.test(d) ? d : '';
}

function maskToken_(t) {
  t = String(t || '');
  return t.length <= 8 ? '••••' : t.slice(0, 3) + '••••••' + t.slice(-3);
}

/* ------------------------------------------------------------ Perangkat */

function devices_() { return jget_('WA_DEV', {}); }

/** Daftar departemen dari data pengguna, lengkap dengan admin dan status perangkat (tanpa token). */
function infoPerangkat_() {
  var tb = readAll_().tables, devs = devices_(), by = {};
  tb.U.forEach(function (u) {
    if (!u.dept) return;
    var d = by[u.dept] = by[u.dept] || { dept: u.dept, admins: [] };
    if ((u.role === 'Admin Dept' || u.role === 'Admin Warehouse') && !u.off) d.admins.push(u.n);
  });
  Object.keys(devs).forEach(function (k) { by[k] = by[k] || { dept: k, admins: [] }; });
  return Object.keys(by).sort().map(function (k) {
    var v = devs[k];
    return { dept: k, admins: by[k].admins, ada: !!(v && v.token), mask: v && v.token ? maskToken_(v.token) : '', nomor: v ? v.nomor || '' : '', diubah: v ? v.diubah || '' : '' };
  });
}

/** Dipanggil dari dialog Pengaturan. Token kosong = pertahankan token lama, hanya ubah nomor. */
function simpanPerangkat(dept, token, nomor) {
  dept = String(dept || '').trim();
  if (!dept) throw new Error('Departemen kosong.');
  token = String(token || '').trim();
  var no = String(nomor || '').trim() ? waNorm_(nomor) : '';
  if (String(nomor || '').trim() && !no) throw new Error('Nomor WA pengirim tidak valid. Contoh: 081234567890.');
  var devs = devices_(), cur = devs[dept] || {};
  if (token && (token.length < 8 || /\s/.test(token))) throw new Error('Token tidak valid. Salin token perangkat dari Fonnte (tanpa spasi).');
  if (!token && !cur.token) throw new Error('Isi token Fonnte untuk departemen ' + dept + '.');
  devs[dept] = { token: token || cur.token, nomor: no, diubah: nowStr_() };
  jset_('WA_DEV', devs);
  return 'Perangkat ' + dept + ' disimpan. Lanjutkan dengan Tes kirim.';
}

function hapusPerangkat(dept) {
  var devs = devices_();
  delete devs[String(dept || '')];
  jset_('WA_DEV', devs);
  return 'Perangkat ' + dept + ' dihapus.';
}

function pilihPerangkat_(devs, pref, nomorPenerima, rusak) {
  for (var i = 0; i < pref.length; i++) {
    var d = devs[pref[i]];
    if (!d || !d.token || rusak[pref[i]]) continue;
    if (d.nomor && d.nomor === nomorPenerima) continue;   // jangan kirim ke nomor sendiri
    return { dept: pref[i], token: d.token };
  }
  return null;
}

/* ---------------------------------------------------------------- Fonnte */

/** Kirim satu pesan. Tidak pernah melempar galat: hasilnya { ok, detail, tokenBad }. */
function kirimFonnte_(token, nomor, text) {
  try {
    var res = UrlFetchApp.fetch(FONNTE_URL, {
      method: 'post',
      headers: { Authorization: token },
      payload: { target: nomor, message: text, countryCode: '62' },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode(), body = res.getContentText(), j = null;
    try { j = JSON.parse(body); } catch (e) { /* bukan JSON */ }
    var ok = !!(j && (String(j.status) === 'true' || String(j.Status) === 'true'));
    var detail = j ? (j.reason || j.detail || body) : 'HTTP ' + code + ': ' + body;
    detail = String(detail).slice(0, 200);
    return { ok: ok, detail: ok ? 'diterima Fonnte' : detail, tokenBad: !ok && /token invalid/i.test(detail) };
  } catch (e) {
    return { ok: false, detail: 'Gagal menghubungi Fonnte: ' + String((e && e.message) || e).slice(0, 150), tokenBad: false };
  }
}

/** Tes dari dialog: kirim pesan nyata walau mode masih SIMULASI. */
function tesKirimPerangkat(dept, tujuan) {
  var dev = devices_()[dept];
  if (!dev || !dev.token) throw new Error('Simpan token departemen ' + dept + ' dulu.');
  var no = waNorm_(tujuan);
  if (!no) throw new Error('Nomor tujuan tidak valid. Contoh: 081234567890.');
  var r = kirimFonnte_(dev.token, no, 'Tes SIPRAK: WhatsApp departemen ' + dept + ' sudah terhubung lewat Fonnte (' + nowStr_().replace('T', ' ') + ').');
  logWA_([{ jenis: 'TES', kunci: 'TES|' + dept, penerima: '', nomor: no, pengirim: dept, status: r.ok ? 'TERKIRIM' : 'GAGAL', detail: r.detail, pesan: '' }]);
  if (!r.ok) throw new Error('Fonnte menolak: ' + r.detail + (r.tokenBad ? ' (cek token perangkat di fonnte.com)' : ''));
  return 'Pesan tes dikirim ke ' + tujuan + '. Cek WhatsApp di nomor itu.';
}

/* ------------------------------------------------------------------ Log */

function logSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    var w = LOG_COLS.length;
    if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), w).setNumberFormat('@');
    sh.getRange(1, 1, 1, w).setValues([LOG_COLS]).setFontWeight('bold').setBackground('#E8F0FE');
    sh.setFrozenRows(1);
  }
  return sh;
}

function logWA_(rows) {
  if (!rows.length) return;
  var sh = logSheet_(), w = LOG_COLS.length, ts = stamp_();
  var vals = rows.map(function (r) {
    return [ts, r.jenis || '', r.kunci || '', r.penerima || '', r.nomor || '', r.pengirim || '', r.status || '', r.detail || '', String(r.pesan || '').slice(0, 500)];
  });
  var start = sh.getLastRow() + 1;
  if (start + vals.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), vals.length + 200);
  sh.getRange(start, 1, vals.length, w).setNumberFormat('@').setValues(vals);
  if (sh.getLastRow() > 6000) sh.deleteRows(2, 2000);   // simpan log terbaru saja
}

/** kunci -> tanggal (yyyy-MM-dd) terakhir yang BERHASIL terkirim. Simulasi tidak dihitung. */
function lastSent_() {
  var sh = logSheet_(), last = sh.getLastRow(), map = {};
  if (last < 2) return map;
  var from = Math.max(2, last - 2999);
  var vals = sh.getRange(from, 1, last - from + 1, LOG_COLS.length).getValues();
  vals.forEach(function (r) {
    if (r[6] === 'TERKIRIM' && r[2]) map[r[2]] = String(r[0]).slice(0, 10);
  });
  return map;
}

/* -------------------------------------------------------- Susun pengingat */

/**
 * Murni (tanpa IO): dari data tabel -> daftar pesan yang layak dikirim hari ini.
 * Tiap pesan: { jenis, kunci, to:{id,n,dept,nomor}, pref:[dept...], text, itemIds, gap }
 */
function bangunPengingat_(tb, c, today) {
  var sel = makeSel_(tb), out = [];
  var tail = c.appUrl ? '\nBuka SIPRAK: ' + c.appUrl : '';
  function who(u) { return { id: u.id, n: u.n, dept: u.dept, nomor: waNorm_(u.hp) }; }
  function aktif(u) { return u && !u.off; }
  function names(rows, max, f) {
    var s = rows.slice(0, max).map(f).join('\n');
    return rows.length > max ? s + '\n• dan ' + (rows.length - max) + ' lainnya' : s;
  }

  // 1) Barang sudah di gudang, belum diambil -> PIC pemohon
  var rmBy = {}, perPic = {};
  tb.RM.forEach(function (x) { (rmBy[x.item] = rmBy[x.item] || []).push(x); });
  tb.I.forEach(function (it) {
    if (it.status !== 'Sudah di ERO') return;
    var b = sel.siap(it);
    if (!(b > 0)) return;
    var r = sel.R[it.req], u = r && sel.U[r.by];
    if (!aktif(u)) return;
    var w = daysSince_(sel.lastArrival(it.kon) || today, today);
    if (w < c.minHariSiap) return;
    var rms = rmBy[it.id] || [];
    if (rms.length >= c.maksIngat) return;
    if (rms.length) {
      var lastAt = rms.map(function (x) { return x.at; }).sort().pop();
      if (daysSince_(lastAt, today) < c.ulangHari) return;
    }
    (perPic[u.id] = perPic[u.id] || []).push({ it: it, b: b, w: w, m: sel.M[it.kode] || { n: it.kode, sat: '' } });
  });
  Object.keys(perPic).forEach(function (id) {
    var u = sel.U[id], a = perPic[id].sort(function (x, y) { return y.w - x.w; });
    out.push({
      jenis: 'AMBIL', kunci: 'AMBIL|' + id, to: who(u), gap: 0,
      pref: [u.dept, '@WH', '@ANY'], itemIds: a.map(function (x) { return x.it.id; }),
      text: 'Halo ' + u.n + ', pengingat dari SIPRAK.\nBarang request Anda sudah siap diambil di Warehouse:\n' +
        names(a, 8, function (x) { return '• ' + x.m.n + ': ' + fmtQty_(x.b) + ' ' + x.m.sat + ' (di gudang ' + x.w + ' hari)'; }) +
        '\nMohon segera diambil. Terima kasih.' + tail
    });
  });

  // 2) Request menunggu persetujuan -> Atasan
  var perBoss = {};
  tb.R.forEach(function (r) {
    if (r.st !== 'Menunggu Approval') return;
    var u = sel.U[r.by];
    if (!u || !u.boss || !aktif(sel.U[u.boss])) return;
    var age = daysSince_(r.tgl, today);
    if (age < c.minHariApproval) return;
    var n = tb.I.filter(function (i) { return i.req === r.id && sel.live(i); }).length;
    (perBoss[u.boss] = perBoss[u.boss] || []).push({ r: r, u: u, age: age, n: n });
  });
  Object.keys(perBoss).forEach(function (id) {
    var boss = sel.U[id], a = perBoss[id].sort(function (x, y) { return y.age - x.age; });
    out.push({
      jenis: 'SETUJU', kunci: 'SETUJU|' + id, to: who(boss), gap: c.ulangAdmin,
      pref: [boss.dept, '@WH', '@ANY'], itemIds: [],
      text: 'Halo ' + boss.n + ', ada ' + a.length + ' request menunggu persetujuan Anda di SIPRAK:\n' +
        names(a, 8, function (x) { return '• ' + x.r.id + ' ' + x.u.n + ': ' + x.n + ' barang (sejak ' + fmtTgl_(x.r.tgl) + ')'; }) +
        '\nMohon ditinjau. Terima kasih.' + tail
    });
  });

  // 3) Barang disetujui belum dibuat di ERO -> Admin Dept
  tb.U.filter(function (u) { return u.role === 'Admin Dept' && aktif(u); }).forEach(function (ad) {
    var p = sel.poolOf(ad.dept);
    if (!p.length) return;
    var oldest = Math.max.apply(null, p.map(function (i) { return daysSince_(i.appr || today, today); }));
    if (oldest < c.minHariPool) return;
    var reqs = {};
    p.forEach(function (i) { reqs[i.req] = 1; });
    out.push({
      jenis: 'POOL', kunci: 'POOL|' + ad.id, to: who(ad), gap: c.ulangAdmin,
      pref: ['@WH', '@ANY', ad.dept], itemIds: [],
      text: 'Halo ' + ad.n + ', di Pool ' + ad.dept + ' ada ' + p.length + ' barang dari ' + Object.keys(reqs).length +
        ' request yang sudah disetujui dan siap dibuat di ERO (terlama menunggu ' + oldest + ' hari).\nBuka SIPRAK > Buat ERO untuk memprosesnya. Terima kasih.' + tail
    });
  });

  // 4) SRL menunggu validasi -> Admin Warehouse (satu pesan per admin per departemen pemilik SRL)
  var pend = {};
  tb.K.forEach(function (k) {
    if (k.tahap !== 'Validasi Warehouse') return;
    var d = pend[k.dept] = pend[k.dept] || {};
    var s = d[k.srl] = d[k.srl] || { srl: k.srl, n: 0 };
    s.n += tb.I.filter(function (i) { return i.kon === k.id && i.status === 'Validasi Warehouse'; }).length;
  });
  tb.U.filter(function (u) { return u.role === 'Admin Warehouse' && aktif(u); }).forEach(function (wh) {
    Object.keys(pend).sort().forEach(function (dept) {
      var a = Object.keys(pend[dept]).sort().map(function (s) { return pend[dept][s]; });
      out.push({
        jenis: 'VALIDASI', kunci: 'VALIDASI|' + wh.id + '|' + dept, to: who(wh), gap: c.ulangAdmin,
        pref: [dept, '@ANY', '@WH'], itemIds: [],
        text: 'Halo ' + wh.n + ', ada ' + a.length + ' SRL dari ' + dept + ' menunggu validasi Warehouse di SIPRAK:\n' +
          names(a, 8, function (x) { return '• ' + x.srl + ': ' + x.n + ' barang'; }) +
          '\nMohon divalidasi. Terima kasih.' + tail
      });
    });
  });
  return out;
}

/** Urutan departemen pengirim: '@WH' = dept Admin Warehouse, '@ANY' = semua dept lain yang punya perangkat. */
function urutPengirim_(pref, whDepts, devs) {
  var seen = {}, res = [];
  function add(d) { if (!seen[d]) { seen[d] = 1; res.push(d); } }
  var any = Object.keys(devs).sort();
  pref.forEach(function (p) {
    if (p === '@WH') whDepts.forEach(add);
    else if (p === '@ANY') any.filter(function (d) { return whDepts.indexOf(d) < 0; }).forEach(add);
    else add(p);
  });
  any.forEach(add);
  return res;
}

/* ------------------------------------------------------------- Pengiriman */

/**
 * Jalankan pengingat. opt.paksa = abaikan pemeriksaan hari kerja (dipakai tombol manual).
 * Mengembalikan ringkasan { mode, terkirim, gagal, simulasi, dilewati, tanpa, nomor, ket }.
 */
function kirimPengingat_(opt) {
  opt = opt || {};
  var c = cfg_(), today = today_(), sum = { mode: c.mode, terkirim: 0, gagal: 0, simulasi: 0, dilewati: 0, tanpa: 0, nomor: 0, ket: '' };
  if (!opt.paksa && c.hari.indexOf(dow_()) < 0) { sum.ket = 'Hari ini bukan hari kirim.'; return sum; }

  var run = +props_().getProperty('WA_RUN') || 0;
  if (Date.now() - run < 10 * 60000) { sum.ket = 'Pengiriman lain sedang berjalan.'; return sum; }
  props_().setProperty('WA_RUN', String(Date.now()));
  var started = Date.now();
  try {
    var tb = readAll_().tables, devs = devices_(), sent = lastSent_(), rusak = {}, sentCount = 0;
    var whDepts = [];
    tb.U.forEach(function (u) { if (u.role === 'Admin Warehouse' && u.dept && whDepts.indexOf(u.dept) < 0) whDepts.push(u.dept); });
    var msgs = bangunPengingat_(tb, c, today), logs = [];
    var live = c.mode === 'live';

    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i], base = { jenis: m.jenis, kunci: m.kunci, penerima: m.to.id, nomor: m.to.nomor, pesan: m.text };
      if (m.gap && sent[m.kunci] && daysSince_(sent[m.kunci], today) < m.gap) { sum.dilewati++; continue; }
      if (!m.to.nomor) { sum.nomor++; logs.push(Object.assign(base, { status: 'NOMOR TIDAK VALID', detail: 'Isi nomor WA di sheet Users / menu Pengguna' })); continue; }
      var dev = null, order = urutPengirim_(m.pref, whDepts, devs);
      for (var j = 0; j < order.length && !dev; j++) dev = pilihPerangkat_(devs, [order[j]], m.to.nomor, rusak);
      if (!dev) { sum.tanpa++; logs.push(Object.assign(base, { status: 'TANPA PERANGKAT', detail: 'Belum ada perangkat Fonnte yang bisa dipakai' })); continue; }
      base.pengirim = dev.dept;
      if (!live) { sum.simulasi++; logs.push(Object.assign(base, { status: 'SIMULASI', detail: 'tidak dikirim (mode simulasi)' })); continue; }
      if (sentCount >= c.maksKirim || Date.now() - started > 270000) { sum.ket = 'Dihentikan: batas jumlah/waktu. Sisanya dikirim pada jadwal berikutnya.'; break; }

      var r = kirimFonnte_(dev.token, m.to.nomor, m.text);
      sentCount++;
      if (r.ok) {
        sum.terkirim++;
        logs.push(Object.assign(base, { status: 'TERKIRIM', detail: r.detail }));
        if (m.itemIds.length) {
          try {
            mutate_(m.itemIds.map(function (id) { return { t: 'RM', op: 'add', row: { item: id, by: BY_AUTO, at: nowStr_() } }; }));
          } catch (e) {
            logs.push({ jenis: m.jenis, kunci: m.kunci, penerima: m.to.id, nomor: m.to.nomor, pengirim: dev.dept, status: 'CATATAN GAGAL', detail: 'Pesan terkirim tapi gagal dicatat di Pengingat: ' + String((e && e.message) || e) });
          }
        }
      } else {
        sum.gagal++;
        if (r.tokenBad) rusak[dev.dept] = 1;
        logs.push(Object.assign(base, { status: 'GAGAL', detail: r.detail }));
      }
      if (i < msgs.length - 1 && c.jedaMax > 0) Utilities.sleep((c.jedaMin + Math.random() * (c.jedaMax - c.jedaMin)) * 1000);
    }
    logWA_(logs);
    return sum;
  } finally {
    props_().deleteProperty('WA_RUN');
  }
}

function ringkasText_(s) {
  var t = 'Mode ' + s.mode.toUpperCase() + ': ' + (s.mode === 'live' ? s.terkirim + ' terkirim' : s.simulasi + ' pesan disimulasikan (tidak dikirim)') +
    ', ' + s.gagal + ' gagal, ' + s.dilewati + ' dilewati (sudah diingatkan baru-baru ini), ' + s.nomor + ' nomor tidak valid, ' + s.tanpa + ' tanpa perangkat.';
  return s.ket ? s.ket + ' ' + t : t;
}

/** Dipanggil trigger harian. */
function jalankanPengingat() {
  var s = kirimPengingat_({ paksa: false });
  Logger.log(ringkasText_(s));
  return s;
}

/** Dipanggil dari dialog / menu. */
function kirimPengingatSekarang() {
  return ringkasText_(kirimPengingat_({ paksa: true }));
}

/* ---------------------------------------------------------------- Jadwal */

function jadwalAktif_() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'jalankanPengingat'; }).length > 0;
}

function hapusJadwal() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'jalankanPengingat') ScriptApp.deleteTrigger(t);
  });
  return 'Jadwal harian dihapus.';
}

function pasangJadwal() {
  hapusJadwal();
  var c = cfg_();
  ScriptApp.newTrigger('jalankanPengingat').timeBased().everyDays(1).atHour(c.jam).nearMinute(0).inTimezone(TZ).create();
  return 'Jadwal harian dipasang: setiap hari sekitar jam ' + (c.jam < 10 ? '0' : '') + c.jam + ':00 WIB (hanya pada hari kirim yang dipilih).';
}

/* ---------------------------------------------------------- Dialog & menu */

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('SIPRAK')
      .addItem('Pengaturan WA dan Go Live', 'tampilPengaturan')
      .addItem('Kirim pengingat sekarang', 'menuKirimSekarang')
      .addSeparator()
      .addItem('Kosongkan data transaksi (sebelum go live)', 'menuResetTransaksi')
      .addToUi();
  } catch (e) { /* bukan konteks spreadsheet */ }
}

function tampilPengaturan() {
  var html = HtmlService.createHtmlOutputFromFile('Settings').setWidth(780).setHeight(660);
  SpreadsheetApp.getUi().showModelessDialog(html, 'SIPRAK: Pengaturan WA dan Go Live');
}

function menuKirimSekarang() {
  var ui = SpreadsheetApp.getUi(), c = cfg_();
  var q = c.mode === 'live'
    ? 'Mode LIVE: pesan WhatsApp akan benar-benar dikirim ke penerima sekarang. Lanjutkan?'
    : 'Mode SIMULASI: tidak ada pesan yang dikirim, hanya dicatat di sheet LogWA. Lanjutkan?';
  if (ui.alert('Kirim pengingat', q, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert('Hasil', kirimPengingatSekarang(), ui.ButtonSet.OK);
}

function menuResetTransaksi() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Kosongkan data transaksi',
    'Menghapus SEMUA Request, Item, Konsolidasi, SRL, Kedatangan, Serah terima, dan Pengingat. ' +
    'Pengguna dan Master item TIDAK dihapus. Tidak bisa dibatalkan. Ketik RESET untuk melanjutkan.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || r.getResponseText().trim() !== 'RESET') { ui.alert('Dibatalkan, tidak ada yang dihapus.'); return; }
  ui.alert(resetTransaksi_());
}

function resetTransaksi_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = ss_();
    TABEL_TRANSAKSI.forEach(function (t) {
      var sh = sheet_(ss, t), last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, SCHEMA[t].cols.length).clearContent();
    });
    SpreadsheetApp.flush();
    bump_(TABEL_TRANSAKSI);
    return 'Data transaksi dikosongkan. Pengguna dan Master item tetap ada.';
  } finally {
    lock.releaseLock();
  }
}

/* ----- API untuk dialog Settings.html (google.script.run) ----- */

function getPengaturan() {
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* belum di-deploy */ }
  return { cfg: cfg_(), perangkat: infoPerangkat_(), jadwal: jadwalAktif_(), url: url, versi: VERSION, tz: TZ };
}

function simpanAturan(c) {
  var cur = cfg_(), n = cleanCfg_(c);
  jset_('WA_CFG', n);
  var msg = 'Pengaturan disimpan.';
  if (jadwalAktif_() && n.jam !== cur.jam) msg += ' ' + pasangJadwal();
  return msg;
}

/* --------------------------------------------------------- Kesiapan go live */

/** Daftar pemeriksaan: [{ lvl: 'ok'|'warn'|'err', t }]. "err" harus beres sebelum go live. */
function cekKesiapan() {
  var out = [];
  function add(lvl, t) { out.push({ lvl: lvl, t: t }); }
  function sample(a, n) { return a.slice(0, n).join(', ') + (a.length > n ? ' dan ' + (a.length - n) + ' lainnya' : ''); }

  // 1. Sheet dan header
  var ss = ss_(), bad = [];
  TABLES.forEach(function (t) {
    var S = SCHEMA[t], sh = ss.getSheetByName(S.sheet);
    if (!sh) { bad.push(S.sheet + ' (tidak ada)'); return; }
    var h = sh.getRange(1, 1, 1, S.cols.length).getValues()[0].map(String);
    if (h.join('|') !== S.cols.join('|')) bad.push(S.sheet + ' (header salah)');
  });
  if (bad.length) add('err', 'Sheet bermasalah: ' + bad.join(', ') + '. Jalankan fungsi setup() sekali.');
  else add('ok', 'Semua ' + TABLES.length + ' sheet dan header sesuai.');
  if (bad.length) return { siap: false, hasil: out };

  var tb = readAll_().tables, sel = makeSel_(tb), U = tb.U;
  var act = U.filter(function (u) { return !u.off; });

  // 2. Pengguna dan peran
  if (!U.length) add('err', 'Sheet Users masih kosong.');
  else add('ok', U.length + ' pengguna terdaftar (' + act.length + ' aktif).');
  var depts = {};
  act.forEach(function (u) { if (u.dept && (u.role === 'User' || u.role === 'Atasan')) depts[u.dept] = 1; });
  var tanpaAdmin = Object.keys(depts).filter(function (d) {
    return !act.some(function (u) { return u.role === 'Admin Dept' && u.dept === d; });
  });
  if (tanpaAdmin.length) add('err', 'Departemen tanpa Admin Dept aktif: ' + tanpaAdmin.join(', ') + '. Request disetujui akan menggantung.');
  else if (Object.keys(depts).length) add('ok', 'Setiap departemen punya Admin Dept aktif.');
  if (!act.some(function (u) { return u.role === 'Admin Warehouse'; })) add('err', 'Belum ada Admin Warehouse aktif.');
  else add('ok', 'Admin Warehouse tersedia.');
  if (!act.some(function (u) { return u.role === 'Spv Warehouse'; })) add('warn', 'Belum ada Spv Warehouse (dashboard tidak punya penanggung jawab).');
  var tanpaAtasan = act.filter(function (u) {
    var b = sel.U[u.boss];
    return u.role === 'User' && !(b && !b.off && b.role === 'Atasan');
  }).map(function (u) { return u.n; });
  if (tanpaAtasan.length) add('err', 'User tanpa atasan yang valid (peran Atasan, aktif): ' + sample(tanpaAtasan, 6) + '.');
  else add('ok', 'Semua User punya atasan yang valid.');

  // 3. Nomor WhatsApp
  var tanpaHp = act.filter(function (u) { return !waNorm_(u.hp); }).map(function (u) { return u.n; });
  if (tanpaHp.length) add('warn', 'Nomor WA kosong/tidak valid: ' + sample(tanpaHp, 6) + '. Mereka tidak akan menerima pengingat.');
  else if (act.length) add('ok', 'Semua pengguna aktif punya nomor WA valid.');
  var seen = {}, dup = [];
  act.forEach(function (u) { var n = waNorm_(u.hp); if (!n) return; if (seen[n]) dup.push(u.n + ' = ' + seen[n]); else seen[n] = u.n; });
  if (dup.length) add('warn', 'Nomor WA ganda: ' + sample(dup, 4) + '.');
  var demo = U.filter(function (u) { return /^62812345600\d\d$/.test(waNorm_(u.hp)) || /^(hendra\.mgr|budi\.spv|andi\.prod|dewi\.admin|wati\.wh)$/.test(u.id); });
  if (demo.length) add('err', 'Masih ada pengguna/nomor data contoh (' + sample(demo.map(function (u) { return u.id; }), 4) + '). Ganti dengan data sungguhan.');

  // 4. Master item dan data transaksi
  if (!tb.M.length) add('err', 'Master item masih kosong.');
  else {
    var lt = tb.M.filter(function (m) { return !/^\d+$/.test(String(m.lead)); }).map(function (m) { return m.k; });
    if (lt.length) add('warn', 'Lead time bukan angka pada: ' + sample(lt, 5) + '.');
    else add('ok', tb.M.length + ' item master.');
  }
  var orphan = [], nonNum = [];
  tb.I.forEach(function (i) {
    if (!sel.R[i.req] || !sel.M[i.kode] || (i.kon && !sel.K[i.kon])) orphan.push(i.id);
    if (!isNum_(i.qty)) nonNum.push(i.id);
  });
  tb.KD.forEach(function (d) { if (!sel.K[d.kon] || !isNum_(d.qty)) orphan.push('KD:' + d.kon); });
  tb.SR.forEach(function (s) { if (!sel.I[s.item] || !isNum_(s.qty)) orphan.push('SR:' + s.item); });
  if (orphan.length) add('err', 'Data tidak konsisten (rujukan/qty rusak): ' + sample(orphan, 5) + '.');
  if (nonNum.length) add('err', 'Qty bukan angka pada item: ' + sample(nonNum, 5) + ' (gunakan titik untuk desimal).');
  var over = tb.K.filter(function (k) { return k.tahap === 'Sudah di ERO' && sel.raw(k) < -1e-9; }).map(function (k) { return k.id; });
  if (over.length) add('err', 'Kedatangan melebihi jumlah di ERO pada: ' + sample(over, 5) + '.');
  if (!orphan.length && !nonNum.length && !over.length) add('ok', 'Data transaksi konsisten.');
  if (tb.R.length) add('warn', 'Sheet Request berisi ' + tb.R.length + ' request. Jika itu data uji, kosongkan lewat menu SIPRAK > Kosongkan data transaksi.');

  // 5. WhatsApp Fonnte
  var c = cfg_(), devs = devices_(), nDev = Object.keys(devs).filter(function (k) { return devs[k].token; }).length;
  if (!nDev) add('err', 'Belum ada perangkat Fonnte tersimpan. Isi token per departemen di bagian Perangkat WA.');
  else add('ok', nDev + ' perangkat Fonnte tersimpan.');
  var adminDepts = {};
  act.forEach(function (u) { if (u.role === 'Admin Dept' || u.role === 'Admin Warehouse') adminDepts[u.dept] = 1; });
  var tanpaDev = Object.keys(adminDepts).filter(function (d) { return !(devs[d] && devs[d].token); });
  if (nDev && tanpaDev.length) add('warn', 'Departemen belum punya perangkat WA sendiri: ' + tanpaDev.join(', ') + '. Pesannya memakai perangkat departemen lain.');
  var sh = ss.getSheetByName(LOG_SHEET), tes = false, gagal = 0;
  if (sh && sh.getLastRow() > 1) {
    var from = Math.max(2, sh.getLastRow() - 999);
    var lg = sh.getRange(from, 1, sh.getLastRow() - from + 1, LOG_COLS.length).getValues();
    var batas = stamp_(864e5);
    lg.forEach(function (r) {
      if (r[1] === 'TES' && r[6] === 'TERKIRIM') tes = true;
      if (r[6] === 'GAGAL' && String(r[0]) >= batas) gagal++;
    });
  }
  if (nDev && !tes) add('warn', 'Belum ada tes kirim yang berhasil. Gunakan tombol Tes kirim per departemen.');
  else if (tes) add('ok', 'Tes kirim WhatsApp pernah berhasil.');
  if (gagal) add('warn', gagal + ' pesan GAGAL dalam 24 jam terakhir. Lihat sheet LogWA kolom detail.');
  if (c.mode !== 'live') add('warn', 'Mode masih SIMULASI: belum ada WhatsApp yang benar-benar terkirim. Ganti ke LIVE saat siap.');
  else add('ok', 'Mode LIVE aktif.');
  if (!jadwalAktif_()) add('warn', 'Jadwal harian belum dipasang (tombol Pasang jadwal).');
  else add('ok', 'Jadwal harian aktif (jam ' + c.jam + ':00 WIB).');

  // 6. Lingkungan
  var tz = Session.getScriptTimeZone();
  if (tz !== TZ) add('warn', 'Zona waktu proyek ' + tz + ', bukan ' + TZ + '. Pasang appsscript.json (Project Settings > Show "appsscript.json").');
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* abaikan */ }
  if (!url) add('warn', 'Web App belum terdeteksi sebagai ter-deploy. Deploy > New deployment > Web app.');
  else if (/\/dev$/.test(url)) add('warn', 'Yang terdeteksi URL uji (/dev). Pakai URL /exec dari Deploy > Manage deployments.');
  else add('ok', 'Web App ter-deploy.');
  add('warn', 'Web App berakses "Anyone": siapa pun yang tahu URL /exec bisa membaca/menulis data. Rahasiakan URL, dan rencanakan login sebelum dipakai luas.');

  return { siap: !out.some(function (x) { return x.lvl === 'err'; }), hasil: out };
}
