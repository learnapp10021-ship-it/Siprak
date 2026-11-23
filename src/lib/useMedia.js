import { useEffect, useState } from 'react'

// true bila media query cocok. Tanpa matchMedia (mis. jsdom saat tes) hasilnya false = tampilan HP/standar.
const has = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

export function useMedia(query) {
  const [on, setOn] = useState(() => (has() ? window.matchMedia(query).matches : false))
  useEffect(() => {
    if (!has()) return
    const mq = window.matchMedia(query)
    const h = () => setOn(mq.matches)
    h()
    if (mq.addEventListener) mq.addEventListener('change', h)
    else mq.addListener(h)
    return () => (mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h))
  }, [query])
  return on
}
