import { useEffect } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Perilaku dialog modal yang benar untuk keyboard dan pembaca layar:
//  - saat dibuka, fokus pindah ke dialog (kontainernya, bukan input pertama, agar keyboard HP tidak langsung muncul)
//  - Tab / Shift+Tab berputar di dalam dialog, tidak lari ke halaman di belakangnya
//  - saat ditutup, fokus kembali ke elemen yang membukanya
export function useDialogFocus(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const opener = document.activeElement
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })

    const onKey = e => {
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll(FOCUSABLE)]
      if (!items.length) {
        e.preventDefault()
        el.focus({ preventScroll: true })
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const cur = document.activeElement
      if (e.shiftKey && (cur === first || cur === el)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      // kembalikan fokus hanya jika pembukanya masih ada di halaman
      if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true })
      }
    }
  }, [ref])
}
