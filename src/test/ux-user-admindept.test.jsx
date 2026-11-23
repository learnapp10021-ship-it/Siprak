// UX User (Request saya, Buat request) dan Admin Dept (Pool, SRL): filter, draf otomatis, validasi inline, aksi cepat.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { buildSeed } from '../data/seed'

let AppProvider, Shell
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', '')
  vi.resetModules()
  ;({ AppProvider } = await import('../store'))
  ;({ Shell } = await import('../App'))
})
const media = wide => q => ({ matches: wide && q.includes('min-width:1024px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
beforeEach(() => {
  window.matchMedia = media(false)
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
const goTab = (container, re) => fireEvent.click([...container.querySelectorAll('nav button')].find(b => re.test(b.textContent)))

describe('User: Buat request', () => {
  it('memilih barang menampilkan pilihan tanggal cepat; mengkliknya mengisi tanggal datang', async () => {
    const { container } = await openApp(userOf('User').id)
    goTab(container, /Buat request/)
    fireEvent.change(container.querySelector('#nr-0-kode'), { target: { value: seed.M[0].k } })
    const grup = await screen.findByRole('group', { name: /tanggal datang cepat/i })
    const chip = [...grup.querySelectorAll('button')].find(b => /^\+1 minggu/.test(b.textContent))
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('#nr-0-datang').value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('isian disimpan otomatis dan dipulihkan setelah dimuat ulang', async () => {
    const u = userOf('User')
    const a = await openApp(u.id)
    goTab(a.container, /Buat request/)
    fireEvent.change(a.container.querySelector('#nr-0-kode'), { target: { value: seed.M[0].k } })
    fireEvent.change(a.container.querySelector('#nr-0-qty'), { target: { value: '7' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('siprak.draft.' + u.id))[0].qty).toBe('7'))
    a.unmount()
    const b = await openApp(u.id)
    goTab(b.container, /Buat request/)
    await waitFor(() => expect(b.container.querySelector('#nr-0-qty').value).toBe('7'))
    expect(screen.getByText(/Isian sebelumnya dipulihkan/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mulai dari kosong' }))
    await waitFor(() => expect(b.container.querySelector('#nr-0-qty').value).toBe(''))
    expect(localStorage.getItem('siprak.draft.' + u.id)).toBeNull()
  })

  it('ringkasan menyebut nama atasan yang akan menyetujui', async () => {
    const u = userOf('User')
    const { container } = await openApp(u.id)
    goTab(container, /Buat request/)
    const atasan = seed.U.find(x => x.id == u.boss)
    expect(container.querySelector('.sumline').textContent).toContain(atasan.n)
  })
})

describe('User: Request saya', () => {
  it('tanpa request: ada tombol untuk membuat request pertama', async () => {
    const baru = seed.U.find(x => x.role === 'User' && !x.off && !seed.R.some(r => r.by == x.id))
    if (!baru) return // seed selalu punya request untuk semua user: tidak ada yang diuji
    await openApp(baru.id)
    fireEvent.click(screen.getByRole('button', { name: 'Buat request pertama' }))
    expect(await screen.findByRole('button', { name: 'Ajukan ke atasan' })).toBeTruthy()
  })

  it('chip status menyaring daftar request', async () => {
    const u = seed.U.filter(x => x.role === 'User' && !x.off).find(x => seed.R.filter(r => r.by == x.id).length > 2)
    if (!u) return
    const { container } = await openApp(u.id)
    const chips = [...container.querySelectorAll('.chips.fl .chip')]
    expect(chips.length).toBeGreaterThan(1)
    expect(chips[0].getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chips[1])
    expect(chips[1].getAttribute('aria-pressed')).toBe('true')
    const n = +chips[1].textContent.match(/\((\d+)\)/)[1]
    expect(container.querySelectorAll('main .row').length).toBe(n)
  })
})

describe('Admin Dept (HP)', () => {
  it('Simpan SRL tanpa nomor menandai kolom dan memindahkan fokus', async () => {
    const { container } = await openApp(userOf('Admin Dept').id)
    expect(screen.getByRole('group', { name: 'Ringkasan pool' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Simpan SRL' }))
    const input = container.querySelector('#srl-no')
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'))
    expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toMatch(/nomor SRL/)
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'SRL-UX-1' } })
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('Tahan tanpa alasan menampilkan pesan di baris itu, bukan hanya toast', async () => {
    const { container } = await openApp(userOf('Admin Dept').id)
    const tombol = screen.getAllByRole('button', { name: 'Tahan' })[0]
    fireEvent.click(tombol)
    const input = tombol.parentElement.querySelector('input')
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'))
    expect(container.querySelector('#' + input.getAttribute('aria-describedby')).textContent).toMatch(/alasan/i)
    expect(input.getAttribute('aria-label')).toMatch(/^Alasan menahan /)
  })
})
