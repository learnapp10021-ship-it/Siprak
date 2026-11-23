// Kedatangan barang dengan ratusan SRL: cari, filter, keyboard, entri cepat, dan lanjut otomatis.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { addDays, TODAY } from '../lib/utils'

const N = 320
// Data besar: tiap SRL punya 2 barang (jumlah 10 per barang). Tanggal estimasi:
// kelipatan 10 = terlambat, sisa 1 = hari ini, sisa 2 = 3 hari lagi, selebihnya jauh. Sisa 3 pada mod 5 = sebagian datang.
const big = db => {
  const depts = [...new Set(db.U.map(u => u.dept))]
  const req = db.R[0].id
  const add = (no, dept, est, kons) => {
    db.L.push({ no, dept, est })
    kons.forEach(([id, kode, datang]) => {
      db.K.push({ id, dept, kode, tahap: 'Sudah di ERO', srl: no, ero: '10', tutup: '0', alasan: '', by: 'dewi.admin' })
      db.I.push({ id: 'ITM-' + id, req, kode, qty: '10', datang: est, pakai: '', status: 'Sudah di ERO', appr: TODAY, kon: id, tahan: '', alasan: '' })
      if (datang) db.KD.push({ kon: id, qty: String(datang), lebih: '0', by: 'wati.wh', cat: '', tgl: TODAY })
    })
  }
  for (let n = 0; n < N; n++) {
    const est = n % 10 == 0 ? addDays(TODAY, -(1 + (n % 5))) : n % 10 == 1 ? TODAY : n % 10 == 2 ? addDays(TODAY, 3) : addDays(TODAY, 10 + (n % 50))
    const k = j => db.M[(n * 2 + j) % db.M.length].k
    add('SRL-BIG-' + String(n).padStart(4, '0'), depts[n % depts.length], est, [
      ['KON-B' + n + 'a', k(0), n % 5 == 3 ? 4 : 0],
      ['KON-B' + n + 'b', k(1), 0],
    ])
  }
  // satu SRL dengan 12 barang (5 sudah sebagian datang) untuk uji filter dalam SRL
  add('SRL-BIG-MANY', depts[0], addDays(TODAY, 20), Array.from({ length: 12 }, (_, j) => ['KON-M' + String(j + 1).padStart(2, '0'), db.M[j % db.M.length].k, j < 5 ? 3 : 0]))
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
const media = wide => q => ({ matches: wide && q.includes('min-width:1024px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
beforeEach(() => {
  window.matchMedia = media(true)
  window.scrollTo = () => {}
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

const openApp = async () => {
  localStorage.setItem('siprak.me', 'wati.wh') // Admin Warehouse: layar awal = Kedatangan
  const r = render(<AppProvider><Shell /></AppProvider>)
  await waitFor(() => expect(screen.getByText('Kedatangan barang')).toBeTruthy())
  return r
}
const rowsOf = () => within(screen.getByRole('listbox', { name: 'Daftar SRL' })).getAllByRole('option')
const cari = v => fireEvent.change(screen.getByLabelText('Cari SRL'), { target: { value: v } })

describe('Kedatangan: ratusan SRL (desktop)', () => {
  it('menampilkan ringkasan, daftar bertahap 20, dan "Tampilkan semua"', async () => {
    const t0 = performance.now()
    await openApp()
    expect(performance.now() - t0).toBeLessThan(6000) // pagar kasar: 320+ SRL tidak boleh membuat layar macet
    const m = screen.getByText(/^\d+ SRL dengan \d+ barang menunggu kedatangan\.$/).textContent.match(/^(\d+) SRL/)
    const total = +m[1]
    expect(total).toBeGreaterThanOrEqual(N)
    expect(rowsOf()).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan semua' }))
    expect(rowsOf()).toHaveLength(total)
  })

  it('mencari nomor SRL langsung memilihnya', async () => {
    const { container } = await openApp()
    cari('SRL-BIG-0123')
    await waitFor(() => expect(rowsOf()).toHaveLength(1))
    expect(container.querySelector('#srl-detail').textContent).toContain('SRL-BIG-0123')
  })

  it('chip Terlambat menyaring, jumlahnya benar, dan pilihan diingat selama sesi', async () => {
    await openApp()
    const chip = screen.getByRole('button', { name: /^Terlambat \(\d+\)$/ })
    const n = +chip.textContent.match(/\((\d+)\)/)[1]
    expect(n).toBeGreaterThanOrEqual(N / 10)
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    // daftar bertahap: klik "Tampilkan ... lagi" sampai habis
    for (let i = 0; i < 30; i++) {
      const lagi = screen.queryByRole('button', { name: /^Tampilkan (semua|\d+ lagi)/ })
      if (!lagi) break
      fireEvent.click(lagi)
    }
    expect(rowsOf()).toHaveLength(n)
    expect(rowsOf().every(o => /Terlambat/.test(o.textContent))).toBe(true)
    expect(JSON.parse(sessionStorage.getItem('siprak.pk.dtg')).when).toBe('late')
    fireEvent.click(screen.getByRole('button', { name: 'Hapus filter' }))
    expect(chip.getAttribute('aria-pressed')).toBe('false')
  })

  it('chip progres memisahkan "Belum mulai" dan "Sebagian"', async () => {
    await openApp()
    const sebagian = screen.getByRole('button', { name: /^Sebagian \(\d+\)$/ })
    expect(+sebagian.textContent.match(/\((\d+)\)/)[1]).toBeGreaterThanOrEqual(N / 5)
    fireEvent.click(sebagian)
    expect(rowsOf().every(o => /20% datang/.test(o.textContent) || /\d+% datang/.test(o.textContent))).toBe(true)
    expect(rowsOf().every(o => !/\b0% datang/.test(o.textContent))).toBe(true)
  })

  it('keyboard: "/" memfokuskan cari, panah memindah SRL, Enter melompat ke isian pertama', async () => {
    await openApp()
    fireEvent.keyDown(document.body, { key: '/' })
    const input = screen.getByLabelText('Cari SRL')
    expect(document.activeElement).toBe(input)
    const terpilih = () => rowsOf().find(o => o.getAttribute('aria-selected') == 'true').textContent
    const a = terpilih()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(terpilih()).not.toBe(a)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(terpilih()).toBe(a)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(document.activeElement.hasAttribute('data-first-input')).toBe(true))
  })

  it('entri cepat: isi, galat bila melebihi sisa, lalu catat sekaligus dan banner SRL selesai', async () => {
    const { container } = await openApp()
    cari('SRL-BIG-0007')
    await waitFor(() => expect(rowsOf()).toHaveLength(1))
    const semua = screen.getAllByRole('button', { name: /^Isi semua sisa / })
    expect(semua).toHaveLength(2)
    const inputs = container.querySelectorAll('input.qin[data-r]')
    fireEvent.click(semua[0])
    expect(inputs[0].value).toBe('10')
    fireEvent.change(inputs[1], { target: { value: '99' } })
    const catat = screen.getByRole('button', { name: /^Catat 2 kedatangan/ })
    expect(catat.disabled).toBe(true)
    expect(container.querySelector('tr.err')).toBeTruthy()
    expect(inputs[1].getAttribute('aria-invalid')).toBe('true')
    fireEvent.click(semua[1])
    expect(catat.disabled).toBe(false)
    // Enter di baris pertama pindah ke baris kedua
    inputs[0].focus()
    fireEvent.keyDown(inputs[0], { key: 'Enter' })
    expect(document.activeElement).toBe(inputs[1])
    fireEvent.click(catat)
    await waitFor(() => expect(screen.getByText(/SRL-BIG-0007 selesai/)).toBeTruthy())
  })

  it('SRL berisi banyak barang: filter status dalam SRL dan penanda isian yang tersembunyi', async () => {
    const { container } = await openApp()
    cari('SRL-BIG-MANY')
    await waitFor(() => expect(rowsOf()).toHaveLength(1))
    const grup = screen.getByRole('group', { name: 'Filter barang di SRL ini' })
    expect(within(grup).getByRole('button', { name: 'Sebagian datang (5)' })).toBeTruthy()
    expect(container.querySelectorAll('input.qin[data-r]')).toHaveLength(12)
    fireEvent.click(screen.getAllByRole('button', { name: /^Isi semua sisa / })[0]) // baris pertama (sebagian datang) terisi
    fireEvent.click(within(grup).getByRole('button', { name: 'Belum ada yang datang (7)' }))
    expect(container.querySelectorAll('input.qin[data-r]')).toHaveLength(7)
    expect(screen.getByText('1 barang terisi')).toBeTruthy()
    expect(screen.getByText(/1 tidak tampil/)).toBeTruthy() // isian di baris yang tersaring tetap ikut dicatat
  })
})

describe('Kedatangan: ratusan SRL (HP)', () => {
  it('mengetik di kolom cari membuka daftar dan memilih hasil pertama; kartu barang tetap dipakai', async () => {
    window.matchMedia = media(false)
    const { container } = await openApp()
    const body = () => container.querySelector('.pk-body')
    expect(body().classList.contains('pk-hide')).toBe(true) // daftar terlipat; hanya kartu SRL aktif
    cari('SRL-BIG-0200')
    expect(body().classList.contains('pk-hide')).toBe(false)
    expect(rowsOf()).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Semua sisa/ })).toHaveLength(2) // kartu per barang
    expect(container.querySelector('input.qin')).toBeNull() // tabel entri cepat hanya di desktop
  })
})
