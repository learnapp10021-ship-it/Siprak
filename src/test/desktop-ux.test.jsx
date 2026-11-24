// UI/UX desktop: tabel persetujuan Atasan (pilih banyak, aksi massal/per baris).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { buildSeed } from '../data/seed'

let AppProvider, Shell
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', '')
  vi.resetModules()
  ;({ AppProvider } = await import('../store'))
  ;({ Shell } = await import('../App'))
  await (await import('../views/registry')).preloadAll() // layar dimuat malas di aplikasi; di tes dimuat dulu agar dirender sinkron
})
const media = wide => q => ({ matches: wide && /min-width:\s*1024px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
beforeEach(() => {
  window.scrollTo = () => {}
  cleanup()
  localStorage.clear()
})

const seed = buildSeed()
const pend = seed.R.filter(r => r.st == 'Menunggu Approval')
const bossOf = r => seed.U.find(u => u.id == seed.U.find(x => x.id == r.by).boss)
const boss = bossOf(pend[0])
const nPend = pend.filter(r => bossOf(r)?.id == boss.id).length

const openApp = async (id, wide) => {
  window.matchMedia = media(wide)
  localStorage.setItem('siprak.me', id)
  const r = render(<AppProvider><Shell /></AppProvider>)
  await waitFor(() => expect(r.container.querySelector('nav button')).toBeTruthy())
  return r
}
const tapConfirm = async btn => { fireEvent.click(btn); const again = await screen.findByRole('button', { name: /Yakin/ }); fireEvent.click(again) }

describe('Atasan desktop: tabel persetujuan', () => {
  it('request menunggu tampil sebagai baris tabel (bukan kartu tinggi), lengkap dengan bahan keputusan', async () => {
    const { container } = await openApp(boss.id, true)
    const rows = container.querySelectorAll('table.egrid tbody tr')
    expect(rows.length).toBe(nPend)
    expect(container.querySelectorAll('main .row').length).toBe(0)
    expect(rows[0].textContent).toMatch(/butuh datang/)
    expect(rows[0].textContent).toMatch(/\d+ hr/)
  })

  it('menolak tanpa catatan ditolak dan fokus pindah ke kolom catatan', async () => {
    const { container } = await openApp(boss.id, true)
    fireEvent.click(within(container.querySelector('table.egrid tbody tr')).getByRole('button', { name: 'Tolak' }))
    await waitFor(() => expect(document.getElementById('toast').textContent).toMatch(/catatan/i))
    expect(document.activeElement.id).toBe('appr-note')
    expect(container.querySelectorAll('table.egrid tbody tr').length).toBe(nPend)
  })

  it('pilih semua lalu Setujui terpilih menyetujui semuanya', async () => {
    const { container } = await openApp(boss.id, true)
    fireEvent.click(screen.getByLabelText('Pilih semua yang tampil'))
    expect(container.textContent).toMatch(new RegExp(`${nPend} dipilih`))
    await tapConfirm(screen.getByRole('button', { name: new RegExp(`Setujui terpilih \\(${nPend}\\)`) }))
    await waitFor(() => expect(container.querySelectorAll('table.egrid tbody tr').length).toBe(0))
    expect(container.textContent).toMatch(/Semua request sudah Anda putuskan/)
  })

  it('Setujui per baris hanya memproses baris itu', async () => {
    if (nPend < 2) return
    const { container } = await openApp(boss.id, true)
    fireEvent.click(within(container.querySelector('table.egrid tbody tr')).getByRole('button', { name: 'Setujui' }))
    await waitFor(() => expect(container.querySelectorAll('table.egrid tbody tr').length).toBe(nPend - 1))
  })

  it('layar sempit (HP) tetap memakai kartu, bukan tabel', async () => {
    const { container } = await openApp(boss.id, false)
    expect(container.querySelector('table.egrid')).toBeNull()
    expect(container.querySelectorAll('main .row').length).toBe(nPend)
  })
})
