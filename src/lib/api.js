import { API_URL } from '../config'

export const apiOn = !!API_URL

class ApiError extends Error {
  constructor(msg, conflict = false) {
    super(msg)
    this.conflict = conflict
  }
}

async function parse(res) {
  let j
  try {
    j = await res.json()
  } catch {
    throw new ApiError('Respons server tidak valid (cek izin Web App: "Anyone").')
  }
  if (!j.ok) throw new ApiError(j.err || 'Server menolak permintaan.', !!j.conflict)
  return j
}

const get = (fn, extra = '') =>
  fetch(`${API_URL}${API_URL.includes('?') ? '&' : '?'}fn=${fn}${extra}`).then(parse)

export const api = {
  // Murah: hanya nomor versi
  ver: () => get('ver').then(j => j.ver),
  // Kirim versi yang sudah dimiliki; bila sama, server menjawab { same: true } tanpa data
  all: have => get('all', have ? `&ver=${encodeURIComponent(have)}` : ''),
  // text/plain = "simple request": tanpa preflight CORS (Apps Script tidak mendukung OPTIONS)
  mutate: ops =>
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: 'mutate', ops }),
    }).then(parse),
}
