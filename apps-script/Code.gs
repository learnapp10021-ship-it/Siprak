/**
 * SIPRAK — backend Apps Script, database = Google Sheets.
 *
 * Susunan file (urutan muat tidak penting):
 *   Code.gs      pintu masuk HTTP (file ini)
 *   Schema.gs    skema, relasi, dan nilai yang diperbolehkan
 *   Db.gs        akses sheet, versi, cache, baca/tulis massal
 *   Mutate.gs    penerapan perubahan dari aplikasi (atomik, dengan lock)
 *   Validate.gs  pemeriksaan relasi & aturan data; audit() untuk memeriksa seluruh database
 *   Migrate.gs   migrasi satu kali dari format lama
 *   Seed.gs      data contoh (dihasilkan dari src/data/seed.js)
 *
 * Endpoint (Web App):
 *   GET  ?fn=ver                  -> { ok, ver }
 *   GET  ?fn=all[&ver=N]          -> { ok, ver, same } atau { ok, ver, db }
 *   POST {fn:'mutate', ops:[...]} -> { ok, ver, base }   (body text/plain agar tanpa preflight CORS)
 *     op = { t:'R', op:'add'|'set', row:{...} }
 *
 * Cara pasang: lihat apps-script/README.md
 */

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
