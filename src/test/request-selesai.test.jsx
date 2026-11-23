// Request saya: Aktif dan Selesai (closed) dipisah; riwayat besar tidak membuat layar berat.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { addDays, TODAY } from '../lib/utils'

const USER = 'andi.prod'
const CLOSED = 1500
// +1500 request selesai (selang-seling: 2/3 ditolak atau dibatalkan, 1/3 disetujui dan sudah diambil semua) untuk satu user
const big = db => {
  const kode = db.M[0].k
  for (let n = 0; n < CLOSED; n++) {
    const id = 'RQ-H' + String(n).padStart(4, '0')
    const tgl = addDays(TODAY, -(30 + (n % 300)))
    const st = n % 3 == 0 ? 'Disetujui' : n % 3 == 1 ? 'Ditolak' : 'Dibatalkan'
    db.R.push({ id, by: USER, tgl, st, cat: '' })
    if (st == 'Disetujui') {
      db.K.push({ id: 'KON-' + id, dept: 'Produksi', kode, tahap: 'Sudah di ERO', srl: 'SRL-H', ero: '5', tutup: '0', alasan: '', by: 'dewi.admin' })
      db.I.push({ id: 'ITM-' + id, req: id, kode, qty: '5', datang: tgl, pakai: '', status: 'Sudah di ERO', appr: tgl, kon: 'KON-' + id, tahan: '', alasan: '' })
      db.KD.push({ kon: 'KON-' + id, qty: '5', lebih: '0', by: 'wati.wh', cat: '', tgl })
      db.SR.push({ item: 'ITM-' + id, qty: '5', to: 'andi.prod', tgl })
    } else {
      db.I.push({ id: 'ITM-' + id, req: id, kode, qty: '5', datang: tgl, pakai: '', status: st, appr: '', kon: '', tahan: '', alasan: '' })
    }
  }
  db.L.push({ no: 'SRL-H', dept: 'Produksi', est: TODAY })
  return db
}

let AppProvider, Shell
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', '')
  vi.resetModules()
  vi.doMock('../data/seed', async () => {
    const real = await vi.importActual('../data/seed')
    return { ...real, buildSeed: () => big(real.buildSeed()) }
  })
  ;({ AppProvider } = await import('../store'))
  ;({ Shell } = await import('../App'))
})
beforeEach(() => {
  window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  window.scrollTo = () => {}
  cleanup()
  localStorage.clear()
})

const openApp = async () => {
  localStorage.setItem('siprak.me', USER)
  const r = render(<AppProvider><Shell /></AppProvider>)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Request saya' })).toBeTruthy())
  return r
}
const seg = n => screen.getByRole('button', { name: new RegExp('^' + n + ' \\(\\d+\\)$') })
const num = el => +el.textContent.match(/\((\d+)\)/)[1]

describe('Request saya: Aktif dan Selesai', () => {
  it('membuka di Aktif; 1.500 riwayat tidak digambar dan hitungannya benar', async () => {
    const t0 = performance.now()
    const { container } = await openApp()
    expect(performance.now() - t0).toBeLessThan(6000)
    expect(seg('Aktif').getAttribute('aria-pressed')).toBe('true')
    expect(num(seg('Selesai'))).toBeGreaterThanOrEqual(CLOSED)
    // yang digambar hanya request aktif, tidak ada request selesai
    expect(container.querySelectorAll('.row.closed')).toHaveLength(0)
    expect(container.textContent).not.toContain('RQ-H0001')
    expect(container.querySelectorAll('main .row').length).toBeLessThan(60)
  })

  it('Selesai: tampil ringkas 20 per halaman, rincian baru digambar saat dibuka', async () => {
    const { container } = await openApp()
    fireEvent.click(seg('Selesai'))
    expect(seg('Selesai').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.row.closed')).toHaveLength(20)
    expect(container.querySelectorAll('.row.closed .row')).toHaveLength(0) // belum ada kartu barang
    const kepala = container.querySelector('.row.closed .cl-hd')
    fireEvent.click(kepala)
    expect(kepala.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('.row.closed .row').length).toBeGreaterThan(0) // rincian muncul
    fireEvent.click(kepala)
    expect(container.querySelectorAll('.row.closed .row')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /^Tampilkan 20 lagi/ }))
    expect(container.querySelectorAll('.row.closed')).toHaveLength(40)
  })

  it('Selesai: cari riwayat berdasarkan nomor request; hasil kosong ada pesannya', async () => {
    const { container } = await openApp()
    fireEvent.click(seg('Selesai'))
    const cari = screen.getByLabelText('Cari riwayat')
    fireEvent.change(cari, { target: { value: 'RQ-H0300' } })
    const rows = container.querySelectorAll('.row.closed')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('RQ-H0300')
    fireEvent.change(cari, { target: { value: 'tidak-ada-ini' } })
    expect(screen.getByText(/Tidak ada riwayat yang cocok/)).toBeTruthy()
  })

  it('request disetujui yang sudah diambil semua berlabel Selesai; ditolak tetap berlabel Ditolak', async () => {
    const { container } = await openApp()
    fireEvent.click(seg('Selesai'))
    fireEvent.change(screen.getByLabelText('Cari riwayat'), { target: { value: 'RQ-H0001' } }) // n=1 -> Ditolak
    expect(within(container.querySelector('.row.closed')).getByText('Ditolak')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cari riwayat'), { target: { value: 'RQ-H0003' } }) // n=3 -> Disetujui, diambil semua
    expect(within(container.querySelector('.row.closed')).getByText('Selesai')).toBeTruthy()
  })

  it('kembali ke Aktif menutup riwayat dan mengosongkan pencarian', async () => {
    const { container } = await openApp()
    fireEvent.click(seg('Selesai'))
    fireEvent.change(screen.getByLabelText('Cari riwayat'), { target: { value: 'RQ-H0300' } })
    fireEvent.click(seg('Aktif'))
    expect(container.querySelectorAll('.row.closed')).toHaveLength(0)
    fireEvent.click(seg('Selesai'))
    expect(screen.getByLabelText('Cari riwayat').value).toBe('')
  })
})
