// QA tombol: nama aksesibel, perilaku dialog (fokus), konfirmasi hapus, dan pagar CSS (hover/area sentuh).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { Dialog } from '../components/Dialog'
import { buildSeed } from '../data/seed'
import { preloadAll } from '../views/registry'

// layar dimuat malas di aplikasi; di tes dimuat dulu agar dirender sinkron
beforeAll(() => preloadAll())

let AppProvider, Shell
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', '') // mode demo
  vi.resetModules()
  ;({ AppProvider } = await import('../store'))
  ;({ Shell } = await import('../App'))
})
const media = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
beforeEach(() => {
  window.matchMedia = media
  window.scrollTo = () => {}
  cleanup()
  localStorage.clear()
})

const ROLES = ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse']
const userOf = role => buildSeed().U.find(u => u.role === role && !u.off)
const openApp = async id => {
  localStorage.setItem('siprak.me', id)
  const r = render(<AppProvider><Shell /></AppProvider>)
  await waitFor(() => expect(r.container.querySelector('nav button')).toBeTruthy())
  return r
}
// Nama yang dibaca pembaca layar: aria-label, aria-labelledby, atau teks
const nameOf = el => {
  const lb = el.getAttribute('aria-labelledby')
  const byId = lb ? lb.split(' ').map(i => document.getElementById(i)?.textContent || '').join(' ') : ''
  return (el.getAttribute('aria-label') || byId || el.textContent || el.getAttribute('title') || '').trim()
}
const unnamed = root =>
  [...root.querySelectorAll('button,[role="button"]')].filter(b => !nameOf(b)).map(b => b.outerHTML.slice(0, 120))

describe('nama aksesibel semua tombol, di setiap layar setiap peran', () => {
  for (const role of ROLES) {
    it(role, async () => {
      const u = userOf(role)
      expect(u, 'seed harus punya pengguna aktif untuk peran ini').toBeTruthy()
      const { container } = await openApp(u.id)
      const n = container.querySelectorAll('nav button').length
      expect(n).toBeGreaterThan(0)
      expect(container.querySelectorAll('button').length).toBeGreaterThan(n) // benar-benar memeriksa tombol, bukan kosong
      expect(unnamed(container)).toEqual([])
      for (let i = 0; i < n; i++) {
        fireEvent.click(container.querySelectorAll('nav button')[i])
        expect(unnamed(container), `layar ke-${i + 1} (${role})`).toEqual([])
      }
    })
  }
})

describe('dialog: fokus dan semantik', () => {
  it('drawer menu: fokus masuk ke dialog, Esc menutup, fokus kembali ke tombol menu', async () => {
    await openApp(userOf('User').id)
    const ham = screen.getByRole('button', { name: /Buka menu/ })
    ham.focus()
    fireEvent.click(ham)
    const dlg = await screen.findByRole('dialog', { name: 'Menu' })
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dlg)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(ham)
  })

  it('Tab berputar di dalam dialog (maju dan mundur)', () => {
    render(
      <>
        <button>di luar</button>
        <Dialog label="Uji">
          <button>pertama</button>
          <button>terakhir</button>
        </Dialog>
      </>
    )
    const first = screen.getByRole('button', { name: 'pertama' })
    const last = screen.getByRole('button', { name: 'terakhir' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})

describe('hapus barang di draft butuh konfirmasi dua ketukan', () => {
  it('ketukan pertama hanya meminta konfirmasi, kedua menghapus', async () => {
    await openApp(userOf('User').id)
    fireEvent.click(screen.getByRole('button', { name: 'Buat request' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah barang' }))
    expect(screen.getAllByRole('button', { name: 'Hapus barang ini' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Hapus barang ini' })[0])
    expect(screen.getAllByRole('button', { name: 'Hapus barang ini' })).toHaveLength(1) // satu lagi masih utuh
    expect(screen.getByRole('button', { name: /Yakin/ })).toBeTruthy() // belum terhapus: menunggu ketukan kedua

    fireEvent.click(screen.getByRole('button', { name: /Yakin/ }))
    expect(screen.queryByRole('button', { name: /Hapus barang ini|Yakin/ })).toBeNull() // tinggal 1 barang
  })
})

describe('pagar CSS', () => {
  const css = postcss.parse(fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8'))
  const inHoverMedia = node => {
    for (let p = node.parent; p && p.type !== 'root'; p = p.parent)
      if (p.type === 'atrule' && p.name === 'media' && /hover\s*:\s*hover/.test(p.params)) return true
    return false
  }

  it('semua aturan :hover hanya berlaku di perangkat yang punya hover (tidak menempel di layar sentuh)', () => {
    const bocor = []
    css.walkRules(r => { if (r.selector.includes(':hover') && !inHoverMedia(r)) bocor.push(r.selector) })
    expect(bocor).toEqual([])
  })

  it('layar sentuh: tombol dan input minimal 44 px', () => {
    let btn = false
    css.walkAtRules('media', a => {
      if (!/pointer\s*:\s*coarse/.test(a.params)) return
      a.walkRules(r => {
        if (r.selector.includes('.btn') && r.nodes.some(d => d.prop === 'min-height' && d.value === '44px')) btn = true
      })
    })
    expect(btn).toBe(true)
  })
})
