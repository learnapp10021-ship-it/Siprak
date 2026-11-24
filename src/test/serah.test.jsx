// Serah terima per penerima: cari, pilih penerima, centang/ubah jumlah, serahkan lintas SRL dengan dua ketukan.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
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
const media = wide => q => ({ matches: wide && q.includes('min-width:1024px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() {}, onchange: null })
beforeEach(() => {
  window.matchMedia = media(true)
  cleanup()
  localStorage.clear()
  localStorage.setItem('siprak.me', 'wati.wh')
})

const bukaSerah = async () => {
  render(<AppProvider><Shell /></AppProvider>)
  fireEvent.click((await screen.findAllByRole('button', { name: /^Serah terima/ }))[0])
  return within(await screen.findByRole('listbox', { name: 'Daftar penerima' }))
}

describe('Serah terima per penerima', () => {
  it('daftar penerima tampil, bisa dicari, dan pencarian kosong memberi pesan', async () => {
    const list = await bukaSerah()
    expect(list.getAllByRole('option').length).toBeGreaterThan(1)
    const box = screen.getByLabelText('Cari penerima')
    fireEvent.change(box, { target: { value: 'zzzxxx' } })
    expect(await screen.findByText(/Tidak ada penerima yang cocok/)).toBeTruthy()
    fireEvent.change(box, { target: { value: '' } })
    await waitFor(() => expect(list.getAllByRole('option').length).toBeGreaterThan(1))
  })

  it('serahkan semua barang satu penerima sekaligus; penerima itu hilang dari daftar', async () => {
    const list = await bukaSerah()
    const n0 = list.getAllByRole('option').length
    const opt = list.getAllByRole('option')[0]
    const nama = within(opt).getByText((_, el) => el.tagName == 'B').textContent
    fireEvent.click(opt)
    const btn = await screen.findByRole('button', { name: /^Serahkan \d+ barang ke / })
    expect(btn.textContent).toContain(nama.split(' ')[0])
    fireEvent.click(btn) // ketukan pertama: minta konfirmasi
    fireEvent.click(await screen.findByRole('button', { name: /Yakin\? Ketuk lagi/ }))
    await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Daftar penerima' })).getAllByRole('option').length).toBe(n0 - 1), { timeout: 3000 })
    expect(within(screen.getByRole('listbox', { name: 'Daftar penerima' })).queryByText(nama)).toBeNull()
  })

  it('barang yang tidak dicentang tidak ikut; jumlah tidak valid mengunci tombol', async () => {
    const list = await bukaSerah()
    // pilih penerima dengan barang paling banyak agar ada yang bisa dilepas
    const sel = screen.getByLabelText('Urutkan')
    fireEvent.change(sel, { target: { value: 'many' } })
    fireEvent.click(list.getAllByRole('option')[0])
    const btn = await screen.findByRole('button', { name: /^Serahkan \d+ barang ke / })
    const n = +btn.textContent.match(/Serahkan (\d+)/)[1]
    expect(n).toBeGreaterThan(1)
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Serahkan / })[0])
    expect((await screen.findByRole('button', { name: new RegExp(`^Serahkan ${n - 1} barang ke `) }))).toBeTruthy()
    // jumlah melebihi yang siap -> tombol terkunci dan ada peringatan
    const qty = screen.getAllByRole('spinbutton', { name: /^Jumlah / }).find(e => !e.disabled)
    fireEvent.change(qty, { target: { value: String(+qty.max + 5) } })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pilih barang yang diserahkan/ }).disabled).toBe(true)
  })

  it('mode Per SRL tetap tersedia dan pilihan mode diingat', async () => {
    await bukaSerah()
    fireEvent.click(screen.getByRole('button', { name: 'Per SRL' }))
    expect(await screen.findByRole('listbox', { name: 'Daftar SRL' })).toBeTruthy()
    expect(localStorage.getItem('siprak.srhMode')).toBe('srl')
  })

  it('grup SRL bisa dilipat; kotak centang SRL memilih/melepas semua barangnya', async () => {
    const list = await bukaSerah()
    fireEvent.change(screen.getByLabelText('Urutkan'), { target: { value: 'many' } })
    fireEvent.click(list.getAllByRole('option')[0])
    const head = (await screen.findAllByRole('button', { expanded: true }))[0]
    const items = () => screen.queryAllByRole('checkbox', { name: /^Serahkan / }).length
    const n0 = items()
    expect(n0).toBeGreaterThan(0)
    fireEvent.click(head) // lipat
    expect(items()).toBeLessThan(n0)
    fireEvent.click(head) // buka lagi
    expect(items()).toBe(n0)
    // kotak centang SRL melepas semua barang di grupnya
    const g = screen.getAllByRole('checkbox', { name: /^Pilih semua barang di / })[0]
    fireEvent.click(g)
    expect(screen.getAllByRole('checkbox', { name: /^Serahkan / }).some(c => !c.checked)).toBe(true)
  })
})

describe('grupSrl', () => {
  const mk = (srl, est) => ({ srl, est })
  it('mengelompokkan per SRL dan mengurutkan estimasi paling awal di atas', async () => {
    const { grupSrl } = await import('../views/SerahView')
    const g = grupSrl([mk('B', '2026-12-02'), mk('A', '2026-12-01'), mk('B', '2026-12-02'), mk('C', '')])
    expect(g.map(x => x.no)).toEqual(['A', 'B', 'C'])
    expect(g.find(x => x.no == 'B').a.length).toBe(2)
  })
})
