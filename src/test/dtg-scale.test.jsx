// Kedatangan dengan seribu SRL: daftar bertahap, tidak merender semua, dan tetap cepat.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react'
import { makeSel } from '../lib/selectors'

const N = 1000 // SRL
const PER = 5 // barang per SRL
const db = { U: [], HP: {}, M: [], R: [], I: [], K: [], L: [], KD: [], SR: [], RM: [] }
for (let s = 0; s < N; s++) {
  const no = 'SRL-' + String(s).padStart(4, '0')
  db.L.push({ no, dept: s % 2 ? 'Produksi' : 'Maintenance', est: '2026-12-' + String((s % 28) + 1).padStart(2, '0') })
  for (let j = 0; j < PER; j++) {
    const kode = 'BRG-' + s + '-' + j
    const kid = 'KON-' + s + '-' + j
    db.M.push({ k: kode, n: 'Barang ' + s + '-' + j, sat: 'pcs' })
    db.K.push({ id: kid, dept: 'Produksi', kode, tahap: 'Sudah di ERO', srl: no, ero: '10', tutup: '0', alasan: '' })
    db.I.push({ id: 'ITM-' + s + '-' + j, req: 'RQ', kode, qty: '10', datang: '0', pakai: '2026-12-01', status: 'Sudah di ERO', appr: '2026-11-16', kon: kid, tahan: '', alasan: '' })
  }
}
const sel = makeSel(db, { cache: true })

vi.mock('../store', () => ({ useApp: () => ({ db, sel, me: { id: 'wati.wh' }, act: async () => true }) }))

afterEach(cleanup)

describe('Kedatangan dengan seribu SRL', () => {
  it('hanya merender sebagian SRL dan barang, dan cepat', async () => {
    const { VDtg } = await import('../views/WarehouseViews')
    const t0 = performance.now()
    render(<VDtg />)
    const ms = performance.now() - t0
    const list = screen.getByRole('listbox', { name: 'Daftar SRL' })
    expect(within(list).getAllByRole('option').length).toBeLessThan(20) // jendela, bukan 1000
    expect(screen.getByText(N + ' SRL')).toBeTruthy()
    expect(screen.getAllByRole('progressbar', { name: 'Progres kedatangan' }).length).toBeLessThanOrEqual(PER)
    expect(ms).toBeLessThan(500)
  })

  it('semua SRL bisa digulir (bukan tombol tampilkan lagi) dan hanya baris terlihat yang dirender', async () => {
    const { VDtg } = await import('../views/WarehouseViews')
    render(<VDtg />)
    const list = screen.getByRole('listbox', { name: 'Daftar SRL' })
    const rows = () => within(list).getAllByRole('option')
    expect(rows().length).toBeLessThan(20)
    expect(rows()[0].getAttribute('aria-setsize')).toBe(String(N))
    expect(screen.queryByRole('button', { name: /Tampilkan .* lagi/ })).toBeNull()
    // gulir jauh ke bawah: baris di sekitar posisi itu muncul, yang lama dibuang
    list.scrollTop = 500 * 72
    fireEvent.scroll(list)
    await waitFor(() => expect(rows().some(r => r.getAttribute('aria-posinset') == '501')).toBe(true))
    expect(rows().length).toBeLessThan(20)
  })

  it('navigasi panah memindahkan pilihan; cari SRL menyaring daftar', async () => {
    const { VDtg } = await import('../views/WarehouseViews')
    render(<VDtg />)
    const list = screen.getByRole('listbox', { name: 'Daftar SRL' })
    const sel0 = () => within(list).getAllByRole('option').find(r => r.getAttribute('aria-selected') == 'true')
    const n0 = sel0().getAttribute('aria-posinset')
    fireEvent.keyDown(sel0(), { key: 'ArrowDown' })
    await waitFor(() => expect(sel0().getAttribute('aria-posinset')).toBe(String(+n0 + 1)))
    fireEvent.change(screen.getByLabelText('Cari SRL'), { target: { value: 'SRL-0123' } })
    expect(await screen.findByText('1 dari ' + N + ' SRL')).toBeTruthy()
  })
})
