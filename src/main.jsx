import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'
import { applyTema, getTema } from './lib/theme'

applyTema(getTema())

// Pilih fokus input angka saat diklik (perilaku sama dengan versi HTML)
document.addEventListener('focusin', e => {
  if (e.target.type === 'number') e.target.select()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

// Service worker (hanya build produksi): pemuatan ulang nyaris instan dan kerangka aplikasi tersedia tanpa jaringan.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
