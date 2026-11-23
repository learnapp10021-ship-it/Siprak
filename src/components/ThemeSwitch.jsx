import { useEffect, useState } from 'react'
import { TEMA, getTema, setTema } from '../lib/theme'

// Pilihan tema: dua tombol berdampingan, yang aktif langsung terlihat. Dipakai di header (desktop) dan menu (HP).
export function ThemeSwitch({ inline }) {
  const [t, setT] = useState(getTema)
  useEffect(() => {
    const h = () => setT(getTema())
    window.addEventListener('siprak-tema', h)
    return () => window.removeEventListener('siprak-tema', h)
  }, [])
  return (
    <div className={'tsw' + (inline ? ' in' : '')} role="group" aria-label="Tema tampilan">
      {TEMA.map(([k, n]) => (
        <button key={k || 'biru'} type="button" aria-pressed={t == k} onClick={() => setTema(k)}>{n}</button>
      ))}
    </div>
  )
}
