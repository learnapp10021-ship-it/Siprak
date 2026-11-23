// Tema tampilan: "" = biru (bawaan), "smoke" = White Smoke Premium. Disimpan per perangkat.
const KEY = 'siprak.tema'
export const TEMA = [['', 'Biru'], ['smoke', 'White smoke']]
const WARNA = { '': '#25507C', smoke: '#FBFAF8' }

export const getTema = () => {
  try { return localStorage.getItem(KEY) == 'smoke' ? 'smoke' : '' } catch { return '' }
}
export const applyTema = t => {
  const el = document.documentElement
  if (t) el.setAttribute('data-theme', t)
  else if (el.getAttribute('data-theme') == 'smoke') el.removeAttribute('data-theme')
  // warna bilah browser HP (hanya untuk mode terang)
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    if (!m.media || m.media.includes('light')) m.setAttribute('content', WARNA[t])
  })
}
export const setTema = t => {
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch { /* penyimpanan dinonaktifkan: tema berlaku sesi ini saja */ }
  applyTema(t)
}
