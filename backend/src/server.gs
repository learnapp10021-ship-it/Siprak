// =====================================================================================
// SIPRAK server (Google Apps Script) -- Google Spreadsheet sebagai database
// -------------------------------------------------------------------------------------
// Jaminan yang dibangun di sini:
//  1. Semua penulisan diserialkan oleh LockService (satu penulis pada satu waktu = antrean).
//  2. Setiap submit membawa ID transaksi (tx). Tx yang sama TIDAK PERNAH ditulis dua kali:
//     kirim ulang (retry) hanya mengembalikan hasil sebelumnya.
//  3. Aksi dijalankan atas data TERBARU yang dibaca di dalam lock, dengan kode yang sama dengan
//     browser (src/lib/actions.js). Status dicek ulang sehingga tidak menimpa keputusan orang lain.
//  4. Write-ahead: baris Tx berstatus PENDING + Journal (nilai lama) ditulis sebelum data.
//     Jika eksekusi mati di tengah jalan, percobaan berikutnya mengembalikan keadaan semula (rollback)
//     lalu menjalankan ulang dari awal.
//  5. Setelah menulis, data DIBACA ULANG dari spreadsheet dan dibandingkan. Hanya jika identik,
//     tx ditandai OK dan klien diberi tahu "berhasil". Jika tidak, di-rollback dan klien diberi tahu gagal.
//  6. Pembacaan (sync) dilayani dari cache tanpa lock; cache diperbarui penulis di dalam lock.
//
// File ini digabung otomatis dengan src/lib/*.js oleh scripts/build-backend.mjs -> backend/dist/Code.gs
// =====================================================================================

// Nama sheet dan urutan kolom mengikuti backend sebelumnya (data lama tetap terbaca); kolom baru
// (id, at, _v, tx) ada di AKHIR. Sheet lama dilengkapi dengan migrate().
//   key = kolom kunci unik; _v = nomor versi baris; tx = ID transaksi terakhir yang menyentuh baris.
const SCHEMA = {
  U: { sheet: 'Users', key: 'id', cols: ['id', 'n', 'dept', 'role', 'boss', 'hp', 'off', '_v', 'tx'] },
  M: { sheet: 'Master', key: 'k', cols: ['k', 'n', 'sat', 'buf', 'kons', 'lead', '_v', 'tx'] },
  R: { sheet: 'Request', key: 'id', cols: ['id', 'by', 'tgl', 'st', 'cat', 'at', '_v', 'tx'] },
  I: { sheet: 'Item', key: 'id', cols: ['id', 'req', 'kode', 'qty', 'datang', 'pakai', 'status', 'appr', 'kon', 'tahan', 'alasan', '_v', 'tx'] },
  K: { sheet: 'Konsolidasi', key: 'id', cols: ['id', 'dept', 'by', 'kode', 'tahap', 'srl', 'ero', 'tutup', 'alasan', '_v', 'tx'] },
  L: { sheet: 'SRL', key: 'no', cols: ['no', 'dept', 'est', 'tx'] },
  KD: { sheet: 'Kedatangan', key: 'id', cols: ['kon', 'qty', 'lebih', 'by', 'cat', 'tgl', 'id', 'at', 'tx'] },
  SR: { sheet: 'SerahTerima', key: 'id', cols: ['item', 'qty', 'to', 'tgl', 'id', 'at', 'tx'] },
  RM: { sheet: 'Pengingat', key: 'id', cols: ['item', 'by', 'at', 'id', 'tx'] },
}
const TABLES = Object.keys(SCHEMA)
const TX_SHEET = 'Tx'
const TX_COLS = ['tx', 'action', 'actor', 'at', 'status', 'msg', 'ms']
const JR_SHEET = 'Journal'
const JR_COLS = ['tx', 'tabel', 'key', 'lama', 'at']

const LOCK_WAIT_MS = 20000 // maksimal menunggu giliran; lewat ini klien diminta mencoba lagi
const CACHE_TTL = 21600 // 6 jam
const CHUNK = 32000 // karakter per potongan cache (batas CacheService 100 KB per kunci)
const MAX_BODY = 600000

// ---------- util ----------
let _ss = null
function ss_() {
  if (_ss) return _ss
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID')
  _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet()
  return _ss
}
function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k)
}
function out_(s) {
  return ContentService.createTextOutput(typeof s === 'string' ? s : JSON.stringify(s)).setMimeType(ContentService.MimeType.JSON)
}
function cell_(v, col) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone()
    v = Utilities.formatDate(v, tz, v.getHours() || v.getMinutes() ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd')
  } else if (typeof v === 'boolean') v = v ? 'Y' : ''
  v = v == null ? '' : String(v)
  if (col === 'off') return v === 'Y' || v.toUpperCase() === 'TRUE'
  return v
}
// Bentuk teks baku sebuah baris (untuk menulis dan membandingkan)
function ser_(row, def) {
  return def.cols.map(c => (c === 'off' ? (row.off ? 'Y' : '') : row[c] == null ? '' : String(row[c])))
}
function serRaw_(vals, def) {
  return def.cols.map((c, i) => (c === 'off' ? (cell_(vals[i], c) ? 'Y' : '') : cell_(vals[i], c)))
}
function same_(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// ---------- membaca tabel ----------
function readTable_(t) {
  const def = SCHEMA[t]
  const sh = ss_().getSheetByName(def.sheet)
  if (!sh) throw new Error('Sheet "' + def.sheet + '" tidak ada. Jalankan setup() sekali.')
  const n = def.cols.length
  const last = sh.getLastRow()
  const vals = sh.getRange(1, 1, Math.max(last, 1), n).getValues()
  def.cols.forEach((c, i) => {
    if (String(vals[0][i]) === '' && i >= def.cols.length - 4)
      throw new Error('Sheet "' + def.sheet + '" belum dimigrasi ke versi baru. Jalankan migrate() sekali di editor Apps Script.')
    if (String(vals[0][i]) !== c)
      throw new Error('Header sheet "' + def.sheet + '" kolom ' + (i + 1) + ' harus "' + c + '" (jangan ubah/urut ulang kolom).')
  })
  const ki = def.cols.indexOf(def.key)
  const rows = []
  const seen = {}
  for (let i = 1; i < vals.length; i++) {
    const key = cell_(vals[i][ki])
    if (key === '') continue
    if (seen[key])
      throw new Error('Data ganda di sheet "' + def.sheet + '": kunci ' + key + ' muncul lebih dari sekali. Perbaiki manual (lihat auditData()).')
    seen[key] = 1
    const o = {}
    def.cols.forEach((c, j) => (o[c] = cell_(vals[i][j], c)))
    o._row = i + 1
    rows.push(o)
  }
  return rows
}
function readAll_() {
  const all = {}
  TABLES.forEach(t => (all[t] = readTable_(t)))
  return all
}

// ---------- snapshot untuk klien + cache ----------
function snapJson_(all, ver) {
  const HP = {}
  const o = { ver: ver }
  TABLES.forEach(t => {
    const keep = SCHEMA[t].cols.filter(c => c !== 'tx' && !(t === 'U' && c === 'hp'))
    o[t] = all[t].map(r => {
      const x = {}
      keep.forEach(c => (x[c] = r[c]))
      if (t === 'U' && r.hp) HP[r.id] = r.hp
      return x
    })
  })
  o.HP = HP
  return JSON.stringify(o)
}
function bumpVer_() {
  const p = PropertiesService.getScriptProperties()
  const v = (+p.getProperty('ver') || 0) + 1
  p.setProperty('ver', String(v))
  return v
}
function cachePut_(ver, json) {
  const c = CacheService.getScriptCache()
  const o = {}
  let n = 0
  for (let i = 0; i < json.length; i += CHUNK) o['snap:' + ver + ':' + n++] = json.slice(i, i + CHUNK)
  o['snapmeta'] = JSON.stringify({ ver: ver, n: n })
  c.putAll(o, CACHE_TTL)
}
function cacheGet_() {
  const c = CacheService.getScriptCache()
  const m = c.get('snapmeta')
  if (!m) return null
  const meta = JSON.parse(m)
  const keys = []
  for (let i = 0; i < meta.n; i++) keys.push('snap:' + meta.ver + ':' + i)
  const got = c.getAll(keys)
  let json = ''
  for (let i = 0; i < keys.length; i++) {
    if (got[keys[i]] == null) return null
    json += got[keys[i]]
  }
  return { ver: meta.ver, json: json }
}
// Dipanggil di dalam lock
function currentSnap_(all) {
  const c = cacheGet_()
  if (c) return c
  const ver = bumpVer_()
  const json = snapJson_(typeof all === 'function' ? all() : all, ver)
  cachePut_(ver, json)
  return { ver: ver, json: json }
}
function withSnap_(head, snap) {
  const h = JSON.stringify(head)
  return h.slice(0, -1) + ',"snap":' + snap.json + '}'
}

// ---------- Tx log / Journal ----------
function findTx_(txId) {
  const sh = ss_().getSheetByName(TX_SHEET)
  const last = sh.getLastRow()
  if (last < 2) return null
  const f = sh.getRange(2, 1, last - 1, 1).createTextFinder(txId).matchEntireCell(true).matchCase(true).findNext()
  if (!f) return null
  const row = f.getRow()
  const v = sh.getRange(row, 1, 1, TX_COLS.length).getValues()[0]
  return { row: row, status: String(v[4]), msg: String(v[5]) }
}
function putTx_(row, vals) {
  const sh = ss_().getSheetByName(TX_SHEET)
  if (row) {
    sh.getRange(row, 1, 1, TX_COLS.length).setValues([vals])
    return row
  }
  const r = sh.getLastRow() + 1
  if (sh.getMaxRows() < r) sh.insertRowsAfter(sh.getMaxRows(), 200)
  const rg = sh.getRange(r, 1, 1, TX_COLS.length)
  rg.setNumberFormat('@')
  rg.setValues([vals])
  return r
}
function writeJournal_(txId, rows) {
  if (!rows.length) return
  const sh = ss_().getSheetByName(JR_SHEET)
  const r = sh.getLastRow() + 1
  const need = r + rows.length - 1
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200)
  const rg = sh.getRange(r, 1, rows.length, JR_COLS.length)
  rg.setNumberFormat('@')
  rg.setValues(rows)
}

// Kembalikan keadaan data seperti sebelum tx dijalankan (dipakai saat verifikasi gagal atau eksekusi mati)
function rollbackTx_(txId) {
  const ss = ss_()
  const jr = ss.getSheetByName(JR_SHEET)
  const old = {}
  const jl = jr.getLastRow()
  if (jl >= 2) {
    const hits = jr.getRange(2, 1, jl - 1, 1).createTextFinder(txId).matchEntireCell(true).matchCase(true).findAll()
    hits.forEach(h => {
      const v = jr.getRange(h.getRow(), 1, 1, JR_COLS.length).getValues()[0]
      ;(old[v[1]] = old[v[1]] || {})[String(v[2])] = JSON.parse(v[3])
    })
  }
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    if (def.cols[def.cols.length - 1] !== 'tx') return
    const sh = ss.getSheetByName(def.sheet)
    const n = def.cols.length
    const last = sh.getLastRow()
    if (last < 2) return
    const data = sh.getRange(2, 1, last - 1, n).getValues()
    const ki = def.cols.indexOf(def.key)
    const del = []
    data.forEach((v, i) => {
      if (String(v[n - 1]) !== txId) return
      const key = String(v[ki])
      if (old[t] && old[t][key]) sh.getRange(i + 2, 1, 1, n).setValues([old[t][key]])
      else del.push(i + 2)
    })
    del.sort((a, b) => b - a).forEach(r => sh.deleteRow(r))
  })
  SpreadsheetApp.flush()
}

// ---------- menghitung perubahan ----------
function diff_(before, after, txId) {
  const ch = {}
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const key = def.key
    const bMap = {}
    before[t].forEach(r => (bMap[r[key]] = r))
    const seen = {}
    const add = []
    const upd = []
    after[t].forEach(r => {
      const k = String(r[key])
      if (!k) throw new Error('Aksi menghasilkan baris tanpa ID di ' + t)
      if (seen[k]) throw new Error('Aksi menghasilkan ID ganda ' + k + ' di ' + t)
      seen[k] = 1
      const b = bMap[k]
      if (!b) add.push(r)
      else if (!same_(ser_(b, def), ser_(r, def))) upd.push({ row: b._row, before: b, after: r })
    })
    before[t].forEach(r => {
      if (!seen[String(r[key])]) throw new Error('Aksi mencoba menghapus data di ' + t)
    })
    const hasV = def.cols.indexOf('_v') >= 0
    add.forEach(r => {
      if (hasV) r._v = '1'
      r.tx = txId
    })
    upd.forEach(u => {
      if (hasV) u.after._v = String((+u.before._v || 0) + 1)
      u.after.tx = txId
    })
    ch[t] = { add: add, upd: upd }
  })
  return ch
}
function runs_(sorted) {
  const res = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1].row === sorted[j].row + 1) j++
    res.push(sorted.slice(i, j + 1))
    i = j + 1
  }
  return res
}
function applyChanges_(ch) {
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const c = ch[t]
    if (!c.add.length && !c.upd.length) return
    const sh = ss_().getSheetByName(def.sheet)
    const n = def.cols.length
    runs_(c.upd.slice().sort((a, b) => a.row - b.row)).forEach(run => {
      sh.getRange(run[0].row, 1, run.length, n).setValues(run.map(u => ser_(u.after, def)))
    })
    if (c.add.length) {
      const start = sh.getLastRow() + 1
      const need = start + c.add.length - 1
      if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200)
      const rg = sh.getRange(start, 1, c.add.length, n)
      rg.setNumberFormat('@')
      rg.setValues(c.add.map(r => ser_(r, def)))
      c.addAt = start
    }
  })
  SpreadsheetApp.flush()
}
// Baca ulang dari spreadsheet dan bandingkan dengan yang seharusnya tersimpan
function verify_(ch) {
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const c = ch[t]
    if (!c.add.length && !c.upd.length) return
    const sh = ss_().getSheetByName(def.sheet)
    const n = def.cols.length
    runs_(c.upd.slice().sort((a, b) => a.row - b.row)).forEach(run => {
      const got = sh.getRange(run[0].row, 1, run.length, n).getValues()
      run.forEach((u, i) => {
        if (!same_(serRaw_(got[i], def), ser_(u.after, def))) throw new Error('Verifikasi gagal: baris ' + u.row + ' di ' + def.sheet + ' tidak sesuai.')
      })
    })
    if (c.add.length) {
      const got = sh.getRange(c.addAt, 1, c.add.length, n).getValues()
      c.add.forEach((r, i) => {
        if (!same_(serRaw_(got[i], def), ser_(r, def))) throw new Error('Verifikasi gagal: baris baru di ' + def.sheet + ' tidak sesuai.')
      })
      // setiap ID baru harus muncul tepat satu kali di seluruh sheet
      const last = sh.getLastRow()
      const kc = def.cols.indexOf(def.key) + 1
      const keys = sh.getRange(2, kc, Math.max(last - 1, 1), 1).getValues().map(x => cell_(x[0]))
      const cnt = {}
      keys.forEach(k => (cnt[k] = (cnt[k] || 0) + 1))
      c.add.forEach(r => {
        if (cnt[String(r[def.key])] !== 1) throw new Error('Verifikasi gagal: ID ' + r[def.key] + ' ganda di ' + def.sheet + '.')
      })
    }
  })
}

// ---------- hak akses (server tidak percaya peran/identitas dari klien) ----------
const ADMIN_ROLES = ['Admin Dept', 'Admin Warehouse']
const WH_ROLES = ['Admin Warehouse', 'Spv Warehouse']
function deptOfItem_(d, sel, id) {
  const i = d.I.find(x => x.id === id)
  if (!i) return null
  const r = sel.RQ(i.req)
  return r ? sel.user(r.by) && sel.user(r.by).dept : null
}
const PERM = {
  saveUser(a, args, d, sel) {
    const f = args[0] || {}
    if (f.mode === 'new') {
      if (!ADMIN_ROLES.includes(a.role)) return 'Hanya admin yang boleh menambah pengguna.'
      if (a.role === 'Admin Dept' && WH_ROLES.includes(f.role)) return 'Role tersebut tidak diizinkan untuk Anda.'
      return ''
    }
    if (f.self) return f.id === a.id ? '' : 'Anda hanya boleh mengubah profil sendiri.'
    if (!ADMIN_ROLES.includes(a.role)) return 'Hanya admin yang boleh mengubah pengguna.'
    const u = sel.user(f.id)
    if (!u) return 'Pengguna tidak ditemukan.'
    if (a.role === 'Admin Dept' && (u.dept !== a.dept || WH_ROLES.includes(f.role))) return 'Anda hanya boleh mengubah pengguna di departemen Anda.'
    return ''
  },
  saveRequest: a => (a.role === 'User' ? '' : 'Hanya user yang boleh membuat request.'),
  ajukan(a, args, d, sel) {
    const r = sel.RQ(args[0])
    return !r ? 'Request tidak ditemukan.' : r.by === a.id ? '' : 'Ini bukan request Anda.'
  },
  batal(a, args, d, sel) {
    const r = sel.RQ(args[0])
    return !r ? 'Request tidak ditemukan.' : r.by === a.id ? '' : 'Ini bukan request Anda.'
  },
  setuju(a, args, d, sel) {
    const r = sel.RQ(args[0])
    if (!r) return 'Request tidak ditemukan.'
    const u = sel.user(r.by)
    return u && u.boss === a.id ? '' : 'Anda bukan atasan pemilik request ini.'
  },
  tolak(a, args, d, sel) {
    return PERM.setuju(a, args, d, sel)
  },
  setujuAll: a => (a.role === 'Atasan' ? '' : 'Hanya atasan yang boleh menyetujui.'),
  tahan(a, args, d, sel) {
    return a.role === 'Admin Dept' && deptOfItem_(d, sel, args[0]) === a.dept ? '' : 'Barang ini bukan di departemen Anda.'
  },
  lepas(a, args, d, sel) {
    return PERM.tahan(a, args, d, sel)
  },
  simpanSrl: a => (a.role === 'Admin Dept' ? '' : 'Hanya Admin Dept yang boleh membuat SRL.'),
  tutup(a, args, d, sel) {
    const k = sel.KN(args[0])
    return a.role === 'Admin Dept' && k && k.dept === a.dept ? '' : 'Konsolidasi ini bukan di departemen Anda.'
  },
  datang: a => (a.role === 'Admin Warehouse' ? '' : 'Hanya Admin Warehouse yang boleh mencatat kedatangan.'),
  saveMaster: a => (a.role === 'Admin Warehouse' ? '' : 'Hanya Admin Warehouse yang boleh mengubah master item.'),
  importMaster: a => PERM.saveMaster(a),
  keluarkan: a => PERM.saveMaster(a),
  validasiSrl: a => PERM.saveMaster(a),
  serahAll: a => PERM.saveMaster(a),
  datangAll: a => PERM.datang(a),
  serah: a => PERM.datang(a),
  ingat: a => PERM.datang(a),
}
// Identitas pelaku selalu diambil dari server, bukan dari argumen klien
const BIND = {
  // departemen hanya boleh ditentukan Admin Warehouse
  saveUser: (a, x) => [Object.assign({}, x[0], { me: a, dept: a.role === 'Admin Warehouse' ? x[0].dept : undefined })],
  saveRequest: (a, x) => [{ status: x[0].status, lines: x[0].lines, me: a }],
  simpanSrl: (a, x) => [Object.assign({}, x[0], { me: a })],
  datang: (a, x) => [Object.assign({}, x[0], { by: a.n })],
  datangAll: (a, x) => [x[0], a.n],
  keluarkan: (a, x) => [Object.assign({}, x[0], { by: a.n })],
  ingat: (a, x) => [x[0], a.n],
  setujuAll: (a, x) => [a.id, x[1]],
}

// ---------- hasil ----------
function reject_(msg, all) {
  return withSnap_({ ok: false, rejected: true, err: msg }, currentSnap_(all))
}
function retry_(msg, extra) {
  return JSON.stringify(Object.assign({ ok: false, retry: true, err: msg }, extra || {}))
}

// ---------- tulis (inti) ----------
function write_(req) {
  const t0 = Date.now()
  const txId = String(req.tx || '')
  if (!/^TX-[A-Za-z0-9_-]{8,80}$/.test(txId)) return JSON.stringify({ ok: false, rejected: true, err: 'ID transaksi tidak valid.' })
  const name = String(req.name || '')
  if (!Object.prototype.hasOwnProperty.call(actions, name) || !PERM[name])
    return JSON.stringify({ ok: false, rejected: true, err: 'Aksi tidak dikenal.' })
  const args = Array.isArray(req.args) ? req.args : []

  // jalur cepat: tx ini sudah sukses sebelumnya
  const hit = CacheService.getScriptCache().get('tx:' + txId)
  if (hit) {
    const c = cacheGet_()
    const head = { ok: true, verified: true, replay: true, msg: JSON.parse(hit).msg }
    return c ? withSnap_(head, c) : JSON.stringify(head)
  }

  const lock = LockService.getScriptLock()
  if (!lock.tryLock(LOCK_WAIT_MS))
    return retry_('Server sedang melayani banyak pengguna. Coba lagi sebentar lagi.', { busy: true })
  try {
    return locked_(txId, name, args, String(req.me || ''), t0)
  } catch (e) {
    return retry_('Terjadi kesalahan di server: ' + (e && e.message ? e.message : e))
  } finally {
    try {
      SpreadsheetApp.flush()
    } catch (e2) {}
    lock.releaseLock()
  }
}

function locked_(txId, name, args, actorId, t0) {
  const prior = findTx_(txId)
  if (prior && prior.status === 'OK') {
    return withSnap_({ ok: true, verified: true, replay: true, msg: prior.msg }, currentSnap_(readAll_))
  }
  if (prior && prior.status === 'PENDING') {
    // eksekusi sebelumnya mati di tengah jalan: kembalikan keadaan lalu jalankan ulang dengan bersih
    rollbackTx_(txId)
    putTx_(prior.row, [txId, name, actorId, nowStr(), 'ROLLED_BACK', 'dipulihkan otomatis', ''])
  }

  const before = readAll_()
  const actor = before.U.find(u => u.id === actorId)
  if (!actor || actor.off) return reject_('Akun tidak ditemukan atau nonaktif.', before)

  // salinan kerja untuk aksi (tanpa _row), plus peta HP yang dipakai aksi
  const d = {}
  TABLES.forEach(t =>
    (d[t] = before[t].map(r => {
      const c = Object.assign({}, r)
      delete c._row
      return c
    }))
  )
  d.HP = {}
  d.U.forEach(u => {
    if (u.hp) d.HP[u.id] = u.hp
  })
  const sel = makeSel(d)

  let res
  try {
    const pe = PERM[name](actor, args, d, sel)
    if (pe) return reject_(pe, before)
    const bound = (BIND[name] || ((a, x) => x))(actor, args)
    res = actions[name](sel, d, ...bound)
  } catch (e) {
    return reject_('Permintaan tidak valid.', before)
  }
  if (res && res.err) return reject_(res.err, before)

  d.U.forEach(u => (u.hp = d.HP[u.id] || ''))
  delete d.HP
  const ch = diff_(before, d, txId)

  const nChanged = TABLES.reduce((s, t) => s + ch[t].add.length + ch[t].upd.length, 0)
  if (!nChanged) return withSnap_({ ok: true, verified: true, noop: true, msg: (res && res.ok) || '' }, currentSnap_(before))

  // --- write-ahead: Journal (nilai lama) + Tx PENDING ---
  const jr = []
  TABLES.forEach(t =>
    ch[t].upd.forEach(u => jr.push([txId, t, String(u.before[SCHEMA[t].key]), JSON.stringify(ser_(u.before, SCHEMA[t])), nowStr()]))
  )
  writeJournal_(txId, jr)
  const txRow = putTx_(prior ? prior.row : 0, [txId, name, actorId, nowStr(), 'PENDING', '', ''])

  try {
    applyChanges_(ch)
    verify_(ch)
  } catch (e) {
    try {
      rollbackTx_(txId)
      putTx_(txRow, [txId, name, actorId, nowStr(), 'FAILED', String(e.message || e).slice(0, 400), String(Date.now() - t0)])
      cacheDrop_()
    } catch (e2) {
      // rollback gagal: biarkan PENDING; percobaan berikutnya memulihkan lebih dulu
    }
    return retry_('Data gagal diverifikasi setelah disimpan, perubahan dibatalkan otomatis. Tekan Coba lagi. Tidak akan ada data ganda.')
  }

  const msg = (res && res.ok) || ''
  putTx_(txRow, [txId, name, actorId, nowStr(), 'OK', msg, String(Date.now() - t0)])
  SpreadsheetApp.flush()

  const ver = bumpVer_()
  const json = snapJson_(d, ver)
  cachePut_(ver, json)
  CacheService.getScriptCache().put('tx:' + txId, JSON.stringify({ msg: msg }), CACHE_TTL)
  return withSnap_({ ok: true, verified: true, msg: msg }, { ver: ver, json: json })
}
function cacheDrop_() {
  CacheService.getScriptCache().remove('snapmeta')
}

// ---------- baca (sync) ----------
function sync_(since) {
  let c = cacheGet_()
  if (!c) {
    const lock = LockService.getScriptLock()
    if (!lock.tryLock(LOCK_WAIT_MS)) return retry_('Server sibuk, coba lagi.', { busy: true })
    try {
      c = cacheGet_()
      if (!c) {
        const all = readAll_()
        const ver = bumpVer_()
        const json = snapJson_(all, ver)
        cachePut_(ver, json)
        c = { ver: ver, json: json }
      }
    } finally {
      lock.releaseLock()
    }
  }
  if (since && String(since) === String(c.ver)) return JSON.stringify({ ok: true, same: true, ver: c.ver })
  return withSnap_({ ok: true }, c)
}

// ---------- pintu masuk web app ----------
function authOk_(key) {
  const k = prop_('API_KEY')
  return !k || key === k
}
function doGet(e) {
  try {
    const p = (e && e.parameter) || {}
    if (!authOk_(p.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
    if (p.action === 'ping') return out_({ ok: true, time: nowStr() })
    return out_(sync_(p.since))
  } catch (err) {
    return out_(retry_('Gagal membaca data: ' + (err && err.message ? err.message : err)))
  }
}
function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || ''
    if (raw.length > MAX_BODY) return out_({ ok: false, rejected: true, err: 'Permintaan terlalu besar.' })
    const req = JSON.parse(raw)
    if (!authOk_(req.key)) return out_({ ok: false, rejected: true, err: 'Akses ditolak.' })
    return out_(write_(req))
  } catch (err) {
    return out_(retry_('Permintaan tidak dapat diproses: ' + (err && err.message ? err.message : err)))
  }
}
// Edit manual di spreadsheet harus terlihat oleh semua pengguna aplikasi
function onEdit() {
  cacheDrop_()
}

// =====================================================================================
// Administrasi (jalankan manual dari editor Apps Script)
// =====================================================================================
function setup() {
  const ss = ss_()
  const make = (name, cols, protect) => {
    let sh = ss.getSheetByName(name)
    if (!sh) sh = ss.insertSheet(name)
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns())
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, cols.length).setValues([cols])
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@')
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
    sh.setFrozenRows(1)
    if (protect && sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0) sh.protect().setWarningOnly(true) // peringatan jika diedit manual
  }
  TABLES.forEach(t => make(SCHEMA[t].sheet, SCHEMA[t].cols, t !== 'M'))
  make(TX_SHEET, TX_COLS, true)
  make(JR_SHEET, JR_COLS, true)
  const def = ss.getSheetByName('Sheet1')
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def)
  cacheDrop_()
  return 'Sheet siap. Isi sheet Users dan Master, atau jalankan seedDemo() untuk data contoh.'
}

// Meningkatkan spreadsheet dari backend lama (tanpa kolom id/_v/tx) ke versi ini TANPA kehilangan data.
// Aman dijalankan berulang. Mengisi: header kolom baru, id untuk Kedatangan/SerahTerima/Pengingat,
// _v = 1 dan tx = LEGACY untuk baris lama. Data yang sudah ada tidak diubah.
function migrate() {
  const lock = LockService.getScriptLock()
  lock.waitLock(60000)
  try {
    setup()
    const ss = ss_()
    const log = []
    TABLES.forEach(t => {
      const def = SCHEMA[t]
      const sh = ss.getSheetByName(def.sheet)
      const n = def.cols.length
      const last = Math.max(sh.getLastRow(), 1)
      const vals = sh.getRange(1, 1, last, n).getValues()
      def.cols.forEach((c, i) => {
        if (String(vals[0][i]) === '') vals[0][i] = c
        else if (String(vals[0][i]) !== c) throw new Error('Header "' + def.sheet + '" kolom ' + (i + 1) + ' berisi "' + vals[0][i] + '", seharusnya "' + c + '". Perbaiki manual lalu ulangi.')
      })
      const idC = def.cols.indexOf('id')
      const vC = def.cols.indexOf('_v')
      const txC = def.cols.indexOf('tx')
      const pre = { KD: 'KD-', SR: 'SR-', RM: 'RM-' }[t]
      let maxN = 0
      if (pre) for (let i = 1; i < vals.length; i++) maxN = Math.max(maxN, parseInt(String(vals[i][idC]).slice(3), 10) || 0)
      let touched = 0
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][0]) === '') continue
        let ch = false
        if (pre && String(vals[i][idC]) === '') { vals[i][idC] = pre + String(++maxN).padStart(3, '0'); ch = true }
        if (vC >= 0 && String(vals[i][vC]) === '') { vals[i][vC] = '1'; ch = true }
        if (String(vals[i][txC]) === '') { vals[i][txC] = 'LEGACY'; ch = true }
        if (ch) touched++
      }
      const rg = sh.getRange(1, 1, last, n)
      rg.setNumberFormat('@')
      rg.setValues(vals.map(r => r.map(v => (v == null ? '' : String(v)))))
      log.push(def.sheet + ': ' + touched + ' baris dilengkapi')
    })
    SpreadsheetApp.flush()
    cacheDrop_()
    return log.join('\n') + '\nSelesai. Jalankan auditData() untuk memeriksa.'
  } finally {
    lock.releaseLock()
  }
}

function seedDemo() {
  const empty = TABLES.every(t => readTable_(t).length === 0)
  if (!empty) throw new Error('seedDemo hanya boleh dijalankan saat semua sheet masih kosong.')
  const s = buildSeed()
  s.U.forEach(u => (u.hp = s.HP[u.id] || ''))
  ;['KD', 'SR', 'RM'].forEach(t => {
    const pre = { KD: 'KD-', SR: 'SR-', RM: 'RM-' }[t]
    s[t].forEach((r, i) => {
      r.id = pre + String(i + 1).padStart(3, '0')
      r.at = r.at || (r.tgl ? r.tgl + 'T09:00' : '')
    })
  })
  s.R.forEach(r => (r.at = r.at || r.tgl + 'T08:00'))
  TABLES.forEach(t => {
    const def = SCHEMA[t]
    const rows = s[t].map(r => {
      const o = Object.assign({}, r)
      if (def.cols.indexOf('_v') >= 0) o._v = '1'
      o.tx = 'SEED'
      return ser_(o, def)
    })
    if (!rows.length) return
    const sh = ss_().getSheetByName(def.sheet)
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 100)
    const rg = sh.getRange(2, 1, rows.length, def.cols.length)
    rg.setNumberFormat('@')
    rg.setValues(rows)
  })
  SpreadsheetApp.flush()
  cacheDrop_()
  return 'Data contoh dimuat.'
}

// Memeriksa kesehatan data: ID ganda, referensi yatim, transaksi menggantung
function auditData() {
  const lines = []
  let all
  try {
    all = readAll_()
  } catch (e) {
    return 'GAGAL BACA: ' + e.message
  }
  const ids = t => new Set(all[t].map(r => r[SCHEMA[t].key]))
  const R = ids('R'), I = ids('I'), K = ids('K'), U = ids('U'), M = ids('M')
  all.R.forEach(r => { if (!U.has(r.by)) lines.push('Request ' + r.id + ': pemilik ' + r.by + ' tidak ada di Users') })
  all.I.forEach(i => {
    if (!R.has(i.req)) lines.push('Item ' + i.id + ': request ' + i.req + ' tidak ada')
    if (!M.has(i.kode)) lines.push('Item ' + i.id + ': barang ' + i.kode + ' tidak ada di Master')
    if (i.kon && !K.has(i.kon)) lines.push('Item ' + i.id + ': konsolidasi ' + i.kon + ' tidak ada')
  })
  all.KD.forEach(x => { if (!K.has(x.kon)) lines.push('Kedatangan ' + x.id + ': konsolidasi ' + x.kon + ' tidak ada') })
  all.SR.forEach(x => { if (!I.has(x.item)) lines.push('Serah terima ' + x.id + ': item ' + x.item + ' tidak ada') })
  all.K.forEach(k => {
    if (+k.tutup < 0) lines.push('Konsolidasi ' + k.id + ': nilai tutup negatif')
  })
  const tx = ss_().getSheetByName(TX_SHEET)
  if (tx.getLastRow() > 1) {
    tx.getRange(2, 1, tx.getLastRow() - 1, TX_COLS.length).getValues().forEach(v => {
      if (String(v[4]) === 'PENDING') lines.push('Transaksi ' + v[0] + ' masih PENDING (akan dipulihkan otomatis saat dikirim ulang)')
    })
  }
  return lines.length ? lines.join('\n') : 'OK: tidak ada masalah ditemukan.'
}

// Bersihkan Journal > 14 hari dan Tx > 120 hari. Pasang sebagai trigger mingguan lewat installTriggers().
function housekeeping() {
  const prune = (name, atCol, days) => {
    const sh = ss_().getSheetByName(name)
    const last = sh.getLastRow()
    if (last < 2) return 0
    const lim = Date.now() - days * 864e5
    const v = sh.getRange(2, atCol, last - 1, 1).getValues()
    const del = []
    v.forEach((x, i) => {
      const t = Date.parse(String(x[0]))
      if (!isNaN(t) && t < lim) del.push(i + 2)
    })
    del.reverse().forEach(r => sh.deleteRow(r))
    return del.length
  }
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) return 'sibuk'
  try {
    return 'Journal dihapus: ' + prune(JR_SHEET, 5, 14) + ', Tx dihapus: ' + prune(TX_SHEET, 4, 120)
  } finally {
    lock.releaseLock()
  }
}
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'housekeeping') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('housekeeping').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create()
  return 'Trigger mingguan housekeeping terpasang.'
}
