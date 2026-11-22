import { API_URL } from '../config'

export const apiOn = !!API_URL

/* ---- Sesi login: token ditandatangani server, disimpan di perangkat ---- */
const SKEY = 'siprak.session.v1'
let session = null
try {
  session = JSON.parse(localStorage.getItem(SKEY))
} catch {
  /* tanpa localStorage / data rusak */
}
if (!session?.token || !session?.uid) session = null

export const getSession = () => session
export const saveSession = s => {
  session = s
  try {
    localStorage.setItem(SKEY, JSON.stringify(s))
  } catch {
    /* mode privat: sesi hanya berlaku selama tab terbuka */
  }
}
export const clearSession = () => {
  session = null
  try {
    localStorage.removeItem(SKEY)
  } catch {
    /* abaikan */
  }
}

class ApiError extends Error {
  constructor(msg, conflict = false, auth = false) {
    super(msg)
    this.conflict = conflict
    this.auth = auth // sesi tidak sah / berakhir: aplikasi kembali ke layar login
  }
}

async function parse(res) {
  let j
  try {
    j = await res.json()
  } catch {
    throw new ApiError('Respons server tidak valid (cek izin Web App: "Anyone").')
  }
  if (!j.ok) throw new ApiError(j.err || 'Server menolak permintaan.', !!j.conflict, !!j.auth)
  return j
}

const get = (fn, extra = '') =>
  fetch(
    `${API_URL}${API_URL.includes('?') ? '&' : '?'}fn=${fn}` +
      (session ? `&t=${encodeURIComponent(session.token)}` : '') +
      extra
  ).then(parse)

// text/plain = "simple request": tanpa preflight CORS (Apps Script tidak mendukung OPTIONS)
const post = body =>
  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, t: session?.token }),
  }).then(parse)

export const api = {
  // Murah: hanya nomor versi
  ver: () => get('ver').then(j => j.ver),
  // Kirim versi yang sudah dimiliki; bila sama, server menjawab { same: true } tanpa data
  all: have => get('all', have ? `&ver=${encodeURIComponent(have)}` : ''),
  mutate: ops => post({ fn: 'mutate', ops }),
  // Password dikirim lewat POST (tidak masuk URL/riwayat) dan hanya diperiksa di server
  login: (u, p) => post({ fn: 'login', u, p }),
  chpw: (o, n) => post({ fn: 'chpw', o, n }),
}
