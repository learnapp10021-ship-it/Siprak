import { TABLES, toRow, fromRow } from './schema.js'
import { makeSel } from './selectors.js'
import { ACTIONS } from './actions.js'

const clone = o => JSON.parse(JSON.stringify(o))
const nCols = t => TABLES[t].cols.length

function nextId(d, t, prefix, pad) {
  const key = TABLES[t].key
  let m = 0
  for (const r of d[t]) {
    const x = /(\d+)$/.exec(r[key])
    if (x && String(r[key]).startsWith(prefix + '-')) m = Math.max(m, +x[1])
  }
  return prefix + '-' + String(m + 1).padStart(pad, '0')
}

// Jalankan satu aksi atas SALINAN state, lalu hitung perubahan baris (append/update).
// ctx = { actor, today, now, opId }
// Hasil: { err } | { ok, ids, changes, state, touched }
//   changes[i] = { t, kind:'append'|'update', key, row:[...], before?:[...] }
export function runAction(state, name, args, ctx) {
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null
  if (!fn) return { err: 'Aksi tidak dikenal.' }
  if (!ctx.actor) return { err: 'Pengguna tidak dikenali.' }
  if (ctx.actor.off) return { err: 'Akun Anda nonaktif. Hubungi admin departemen.' }

  const d = clone(state)
  const c = { ...ctx, d, sel: makeSel(d), newId: (t, p, pad = 6) => nextId(d, t, p, pad) }
  const res = fn(c, args || {}) || {}
  if (res.err) return { err: res.err }

  const changes = []
  const touched = []
  try {
  for (const t of Object.keys(TABLES)) {
    const key = TABLES[t].key
    const prev = new Map(state[t].map(r => [r[key], r]))
    const seen = new Set()
    let touchedT = false
    d[t] = d[t].map(r => {
      const k = r[key]
      if (k == null || k === '') throw new Error(`Baris ${t} tanpa kunci`)
      if (seen.has(k)) throw Object.assign(new Error(`Kunci duplikat ${t}:${k}`), { business: true })
      seen.add(k)
      const b = prev.get(k)
      if (!b) {
        r._cr = ctx.now
        r._ts = ctx.now
        r._op = ctx.opId
        r._by = ctx.actor.id
        const n = fromRow(t, toRow(t, r))
        changes.push({ t, kind: 'append', key: k, row: toRow(t, n) })
        touchedT = true
        return n
      }
      const a = toRow(t, b).slice(0, nCols(t))
      const z = toRow(t, r).slice(0, nCols(t))
      if (JSON.stringify(a) === JSON.stringify(z)) return b
      r._cr = b._cr
      r._ts = ctx.now
      r._op = ctx.opId
      r._by = ctx.actor.id
      const n = fromRow(t, toRow(t, r))
      changes.push({ t, kind: 'update', key: k, row: toRow(t, n), before: toRow(t, b) })
      touchedT = true
      return n
    })
    for (const k of prev.keys()) if (!seen.has(k)) throw new Error(`Penghapusan data tidak diizinkan (${t}:${k})`)
    if (touchedT) touched.push(t)
  }
  } catch (e) {
    if (e.business) return { err: 'Data ganda terdeteksi dan ditolak (' + e.message + ').' }
    throw e
  }
  if (!changes.length) return { ok: res.ok, ids: res.ids || [], changes, state, touched }
  return { ok: res.ok, ids: res.ids || [], changes, state: d, touched }
}

export { makeSel }
