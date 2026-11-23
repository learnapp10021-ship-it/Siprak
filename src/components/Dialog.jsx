import { useRef } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus'

// Kontainer dialog modal (sheet di tengah/bawah atau drawer menu) dengan semantik dan fokus yang benar.
// Latar gelap (.scrim) tetap dipasang oleh pemakai karena hanya berfungsi untuk ketuk-di-luar.
export function Dialog({ label, as: Tag = 'section', className = 'sheet', children }) {
  const ref = useRef(null)
  useDialogFocus(ref)
  return (
    <Tag ref={ref} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      {children}
    </Tag>
  )
}
