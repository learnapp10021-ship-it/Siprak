// Request saya (User): ringkasan tahap, kartu siap diambil, urutan, filter, dan pencarian.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { buildSeed } from '../data/seed'
import { makeSel } from '../lib/selectors'
import { itemCat, reqSummary, reqStage } from '../lib/reqStage'

let AppProvider, Shell
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', '')
  vi.resetModules()
  ;({ AppProvider } = await import('../store'))
  ;({ Shell } = await import('../App'))
})
beforeEach(() => {
  window.matchMedia = q => ({ matches: q.includes('min-width:1024px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() {}, onchange: null })
  cleanup()
  localStorage.clear()
  localStorage.setItem('siprak.me', 'andi.prod')
})

const cards = () => [...document.querySelectorAll('.row')]
const head = c => c.querySelector('.between .pill')?.textContent || ''
const chipN = name => +screen.getByRole('button', { name: new RegExp('^' + name + ' \\(') }).textContent.match(/\((\d+)\)/)[1]
const buka = async () => {
  render(<AppProvider><Shell /></AppProvider>)
  await screen.findByRole('group', { name: 'Saring menurut tahap' })
}

describe('tahap barang (logika)', () => {
  const db = buildSeed()
  const sel = makeSel(db)
  const mine = db.R.filter(r => r.by == 'andi.prod')
  it('tiap barang belum tuntas masuk tepat satu tahap, dan jumlahnya cocok', () => {
    mine.forEach(r => {
      const s = reqSummary(r, sel)
      expect(s.c.siap + s.c.approval + s.c.proses + s.c.tahan + s.c.draft).toBe(s.n)
    })
  })
  it('siap diambil hanya bila ada jatah yang sudah tiba dan belum diambil', () => {
    db.I.filter(i => i.status == 'Sudah di ERO').forEach(i => {
      expect(itemCat(i, sel) == 'siap').toBe(sel.siap(i) > 0)
    })
    expect(itemCat({ status: 'Approved', tahan: 'Y' }, sel)).toBe('tahan')
    expect(itemCat({ status: 'Menunggu Approval' }, sel)).toBe('approval')
    expect(itemCat({ status: 'Draft' }, sel)).toBe('draft')
  })
  it('label kepala kartu mengutamakan yang butuh tindakan', () => {
    expect(reqStage({ c: { siap: 2, approval: 1, proses: 1, tahan: 0, draft: 0 } })).toEqual({ l: '2 siap diambil', t: 't-ok' })
    expect(reqStage({ c: { siap: 0, approval: 1, proses: 1, tahan: 0, draft: 0 } }).l).toBe('Menunggu persetujuan')
    expect(reqStage({ c: { siap: 0, approval: 0, proses: 0, tahan: 0, draft: 0 } })).toBeNull()
  })
})

describe('layar Request saya', () => {
  it('kartu "siap diambil" tampil di atas dengan jumlah dan daftar barang', async () => {
    await buka()
    const h = screen.getByRole('heading', { name: /barang siap diambil di Warehouse/ })
    const n = +h.textContent.match(/^(\d+)/)[1]
    expect(n).toBeGreaterThan(0)
    const items = within(h.closest('section')).getAllByRole('listitem')
    expect(items.length).toBe(Math.min(3, n))
    if (n > 3) expect(screen.getByRole('button', { name: /Lihat semua/ })).toBeTruthy()
  })

  it('ringkasan tahap: jumlah per tahap sama dengan jumlah Semua', async () => {
    await buka()
    const semua = chipN('Semua')
    const tahap = ['Siap diambil', 'Menunggu persetujuan', 'Diproses', 'Ditahan', 'Draft']
      .filter(t => screen.queryByRole('button', { name: new RegExp('^' + t + ' \\(') }))
      .reduce((a, t) => a + chipN(t), 0)
    expect(tahap).toBe(semua)
  })

  it('request dengan barang siap diambil diurutkan paling atas', async () => {
    await buka()
    const heads = cards().map(head)
    const iSiap = heads.map(h => /siap diambil/.test(h))
    const last = iSiap.lastIndexOf(true)
    expect(iSiap.indexOf(false)).toBeGreaterThan(last) // semua yang siap berada sebelum yang tidak
    expect(iSiap[0]).toBe(true)
  })

  it('filter "Siap diambil" hanya menampilkan request yang punya barang siap; ketuk lagi untuk reset', async () => {
    await buka()
    const semua = cards().length
    fireEvent.click(screen.getByRole('button', { name: /^Siap diambil \(/ }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: /barang siap diambil di Warehouse/ })).toBeNull())
    expect(cards().length).toBeGreaterThan(0)
    expect(cards().length).toBeLessThanOrEqual(semua)
    cards().forEach(c => expect(head(c)).toMatch(/siap diambil/))
    fireEvent.click(screen.getByRole('button', { name: /^Siap diambil \(/ }))
    await waitFor(() => expect(cards().length).toBe(semua))
  })

  it('pencarian menurut nama barang atau nomor; hasil kosong punya jalan keluar', async () => {
    await buka()
    const box = screen.getByRole('searchbox', { name: 'Cari request' })
    const semua = cards().length
    fireEvent.change(box, { target: { value: 'zzzxxx' } })
    expect(await screen.findByText(/Tidak ada request yang cocok/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hapus filter' }))
    await waitFor(() => expect(cards().length).toBe(semua))
    const nomor = document.querySelector('.row b').textContent
    fireEvent.change(box, { target: { value: nomor } })
    await waitFor(() => expect(cards().length).toBe(1))
  })

  it('tautan Histori tetap ada', async () => {
    await buka()
    expect(screen.getByRole('button', { name: /^Lihat Histori/ })).toBeTruthy()
  })
})
