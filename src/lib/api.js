// Klien untuk backend Google Apps Script (lihat backend/).
// Tanpa VITE_API_URL aplikasi berjalan dalam mode demo lokal (data di memori), seperti sebelumnya.
import { createClient } from '@supabase/supabase-js'
import { API_URL as URL_, SUPABASE_URL, SUPABASE_KEY, DEMO_OK } from '../config'
import { createSupaApi, newTx as newTxSupa } from './supa'
const KEY = import.meta.env.VITE_API_KEY || ''

// Backend yang dipakai: Supabase (utama) > Apps Script (lama) > demo lokal (hanya jika diizinkan).
export const SUPA = !!(SUPABASE_URL && SUPABASE_KEY)
export const REMOTE = SUPA || !!URL_
export const apiOn = REMOTE
// Build produksi tanpa database dikonfigurasi: tampilkan galat konfigurasi, jangan diam-diam masuk mode demo.
export const MISCONFIGURED = !REMOTE && !DEMO_OK

const jwtRole = t => {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { return undefined }
}
// Pengaman: kunci rahasia tidak boleh pernah ada di browser.
const unsafeKey = SUPA && (SUPABASE_KEY.startsWith('sb_secret_') || jwtRole(SUPABASE_KEY) === 'service_role')
export const CONFIG_ERROR = unsafeKey
  ? 'Kunci Supabase yang terpasang adalah Secret/Service Role Key. Ganti dengan Publishable Key (sb_publishable_...) lalu build ulang.'
  : MISCONFIGURED
    ? 'Database belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY saat build.'
    : ''
const supa = SUPA && !unsafeKey
  ? createSupaApi(createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } }))
  : null
// Pengguna wajib login (Supabase Auth) bila memakai Supabase.
export const AUTH = supa

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
function syncAS(since) {
  const q = new URLSearchParams({ action: 'sync', since: since || '', key: KEY, _: Date.now() })
  return req(URL_ + '?' + q, {}, 30000)
}

// Kirim satu transaksi. Mengembalikan salah satu:
//   { ok: true, verified: true, msg, snap, replay? }   tersimpan DAN terverifikasi di spreadsheet
//   { ok: false, rejected: true, err, snap? }          ditolak aturan bisnis (tidak ada yang tertulis)
//   { ok: false, retry: true, err, unknown? }          belum pasti: aman dikirim ulang dengan tx yang sama
async function writeAS({ tx, name, args, me }, onWait) {
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
      if (onWait) onWait(attempt, 3)
      await sleep(1500 * attempt + Math.random() * 1500)
      continue
    }
    if (r && r.ok && r.verified) return r
    if (r && r.rejected) return r
    return { ok: false, retry: true, err: (r && r.err) || 'Respons server tidak dikenali.' }
  }
}

// ID transaksi unik per niat pengguna (dibuat sekali, dipakai ulang saat retry)
const newTxAS = () => {
  const rnd = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/-/g, '')
  return 'TX-' + Date.now().toString(36) + '-' + rnd.slice(0, 16)
}

export const sync = supa ? supa.sync : syncAS
export const write = supa ? supa.write : writeAS
export const newTx = supa ? newTxSupa : newTxAS
