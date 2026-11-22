// Klien untuk backend Google Apps Script (lihat backend/).
// Tanpa VITE_API_URL aplikasi berjalan dalam mode demo lokal (data di memori), seperti sebelumnya.
const URL_ = import.meta.env.VITE_API_URL || ''
const KEY = import.meta.env.VITE_API_KEY || ''
export const REMOTE = !!URL_

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function req(url, opts, timeoutMs) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal, redirect: 'follow' })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('Respons server tidak valid (HTTP ' + res.status + ')')
    }
  } finally {
    clearTimeout(t)
  }
}

// Ambil snapshot data. `since` = versi yang sudah dimiliki; jika sama, server menjawab { same: true }.
export function sync(since) {
  const q = new URLSearchParams({ action: 'sync', since: since || '', key: KEY, _: Date.now() })
  return req(URL_ + '?' + q, {}, 30000)
}

// Kirim satu transaksi. Mengembalikan salah satu:
//   { ok: true, verified: true, msg, snap, replay? }   tersimpan DAN terverifikasi di spreadsheet
//   { ok: false, rejected: true, err, snap? }          ditolak aturan bisnis (tidak ada yang tertulis)
//   { ok: false, retry: true, err, unknown? }          belum pasti: aman dikirim ulang dengan tx yang sama
export async function write({ tx, name, args, me }) {
  let attempt = 0
  for (;;) {
    let r
    try {
      // text/plain menghindari preflight CORS (Apps Script tidak melayani OPTIONS)
      r = await req(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: KEY, tx, name, args, me }) }, 70000)
    } catch (e) {
      return {
        ok: false, retry: true, unknown: true,
        err: 'Koneksi ke server terputus atau terlalu lama. Data mungkin sudah tersimpan atau belum.',
      }
    }
    // Antrean penuh: coba otomatis lagi (aman, tx sama) sebelum menyerahkan ke pengguna
    if (r && r.busy && attempt < 2) {
      attempt++
      await sleep(1500 * attempt + Math.random() * 1500)
      continue
    }
    if (r && r.ok && r.verified) return r
    if (r && r.rejected) return r
    return { ok: false, retry: true, err: (r && r.err) || 'Respons server tidak dikenali.' }
  }
}

// ID transaksi unik per niat pengguna (dibuat sekali, dipakai ulang saat retry)
export const newTx = () => {
  const rnd = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/-/g, '')
  return 'TX-' + Date.now().toString(36) + '-' + rnd.slice(0, 16)
}
