// QA UI/UX: galat form di kolomnya, nama progressbar, baris cetak periode, dan pagar kontras CSS.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { buildSeed } from '../data/seed'
import { makeSel } from '../lib/selectors'
import { lineErrors } from '../lib/actions'
import { SrlHead } from '../components/ui'

let AppProvider, Shell
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', '')
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

const seed = buildSeed()
const userOf = role => seed.U.find(u => u.role === role && !u.off)
const openApp = async id => {
  localStorage.setItem('siprak.me', id)
  const r = render(<AppProvider><Shell /></AppProvider>)
  await waitFor(() => expect(r.container.querySelector('nav button')).toBeTruthy())
  return r
}

describe('lineErrors: aturan baris per kolom (sumber tunggal dengan server)', () => {
  const sel = makeSel(seed)
  const nonBuffer = seed.M.find(m => m.buf == '0')
  const buffer = seed.M.find(m => m.buf == '1')

  it('baris kosong: hanya kolom barang yang ditandai', () => {
    expect(Object.keys(lineErrors(sel, { kode: '', qty: '', datang: '', pakai: '' }))).toEqual(['kode'])
  })
  it('jumlah nol/negatif/bukan angka ditandai', () => {
    for (const q of ['', '0', '-1', 'abc']) {
      expect(lineErrors(sel, { kode: buffer.k, qty: q, datang: '2099-01-01', pakai: '' }).qty, `qty=${q}`).toBeTruthy()
    }
  })
  it('tanggal datang kosong atau terlalu cepat ditandai', () => {
    expect(lineErrors(sel, { kode: buffer.k, qty: '1', datang: '', pakai: '' }).datang).toBeTruthy()
    expect(lineErrors(sel, { kode: buffer.k, qty: '1', datang: '2000-01-01', pakai: '' }).datang).toBeTruthy()
  })
  it('tanggal pakai wajib untuk non buffer, dan tidak boleh sebelum tanggal datang', () => {
    expect(lineErrors(sel, { kode: nonBuffer.k, qty: '1', datang: '2099-01-02', pakai: '' }).pakai).toMatch(/wajib/)
    expect(lineErrors(sel, { kode: nonBuffer.k, qty: '1', datang: '2099-01-02', pakai: '2099-01-01' }).pakai).toMatch(/sebelum/)
  })
  it('baris valid tidak punya galat', () => {
    expect(lineErrors(sel, { kode: buffer.k, qty: '2', datang: '2099-01-02', pakai: '' })).toEqual({})
  })
})

describe('Buat request: galat tampil di kolomnya', () => {
  it('Ajukan dengan form kosong menandai kolom, menautkan pesan, dan memindahkan fokus', async () => {
    const { container } = await openApp(userOf('User').id)
    fireEvent.click([...container.querySelectorAll('nav button')].find(b => /Buat request/.test(b.textContent)))
    const select = container.querySelector('#nr-0-kode')
    expect(select.getAttribute('aria-invalid')).toBeNull() // belum mencoba: tidak menandai
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke atasan' }))
    await waitFor(() => expect(select.getAttribute('aria-invalid')).toBe('true'))
    const desc = document.getElementById(select.getAttribute('aria-describedby'))
    expect(desc.textContent).toMatch(/Pilih barang/)
    expect(document.activeElement).toBe(select)
  })

  it('galat jumlah muncul di kolom jumlah setelah barang dipilih, dan hilang saat diperbaiki', async () => {
    const { container } = await openApp(userOf('User').id)
    fireEvent.click([...container.querySelectorAll('nav button')].find(b => /Buat request/.test(b.textContent)))
    fireEvent.change(container.querySelector('#nr-0-kode'), { target: { value: seed.M.find(m => m.buf == '1').k } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke atasan' }))
    const qty = container.querySelector('#nr-0-qty')
    await waitFor(() => expect(qty.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(qty)
    fireEvent.change(qty, { target: { value: '3' } })
    await waitFor(() => expect(qty.getAttribute('aria-invalid')).toBeNull())
  })

  it('pesan galat tidak ikut menjadi nama <label> kolom', async () => {
    const { container } = await openApp(userOf('User').id)
    fireEvent.click([...container.querySelectorAll('nav button')].find(b => /Buat request/.test(b.textContent)))
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke atasan' }))
    await waitFor(() => expect(container.querySelector('#nr-0-kode').getAttribute('aria-invalid')).toBe('true'))
    expect(container.querySelector('#nr-0-kode-e').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('aksesibilitas dan cetak', () => {
  it('progressbar kepala SRL punya nama', () => {
    const { container } = render(<SrlHead no="SRL-2611-001" s={null} pct={40} />)
    expect(container.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe('Progres SRL-2611-001')
  })

  it('baris tabel dashboard yang bisa diketuk bernama dari isinya (memuat teks yang terlihat)', async () => {
    const { container } = await openApp(userOf('Spv Warehouse').id)
    const rows = [...container.querySelectorAll('tr[role="button"]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.hasAttribute('aria-label'), 'aria-label menimpa teks yang terlihat').toBe(false)
      expect(r.textContent.trim()).not.toBe('')
    }
  })

  it('tabel yang bisa digulir dapat difokus keyboard dan diberi nama', async () => {
    const { container } = await openApp(userOf('Spv Warehouse').id)
    const tws = [...container.querySelectorAll('.tw')]
    expect(tws.length).toBeGreaterThan(0)
    for (const t of tws) {
      expect(t.getAttribute('tabindex')).toBe('0')
      expect(t.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('dashboard punya baris khusus cetak berisi periode dan tanggal cetak', async () => {
    const { container } = await openApp(userOf('Spv Warehouse').id)
    const p = container.querySelector('.print-only')
    expect(p).toBeTruthy()
    expect(p.textContent).toMatch(/Periode: .+ sampai .+/)
    expect(p.textContent).toMatch(/Dicetak/)
  })
})

describe('pagar CSS: kontras dan teks kecil', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8')
  const rule = sel => {
    // cari aturan yang diawali selektor itu di awal baris (bukan ".qrow .btn{" dan sejenisnya)
    const i = css.search(new RegExp('(^|\\n)' + sel.replace(/\./g, '\\.') + '\\{'))
    expect(i, `aturan ${sel} harus ada`).toBeGreaterThanOrEqual(0)
    return css.slice(i, css.indexOf('}', i))
  }
  it('teks tombol terisi tidak memakai --onb (gelap di mode gelap)', () => {
    expect(rule('.btn')).toMatch(/color:#fff/)
  })
  it('lencana dan tombol konfirmasi memakai --onb di atas --bad (terang: putih, gelap: gelap)', () => {
    expect(rule('.bdg')).toMatch(/color:var\(--onb\)/)
    expect(rule('.btn.bad.cfm')).toMatch(/color:var\(--onb\)/)
  })
  it('latar .t-* tidak bocor ke cincin progres dan label tahap', () => {
    expect(css).toMatch(/\.rg\[class\*="t-"\],\.itm-steps li\[class\*="t-"\]\{background:none\}/)
  })
  it('tidak ada font-size di bawah 12px', () => {
    const kecil = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter(m => +m[1] < 12).map(m => m[0])
    expect(kecil).toEqual([])
  })
})
