// Buat ERO (Admin Dept): pilih request dengan checkbox, simpan SRL hanya untuk yang dipilih, lalu muncul konfirmasi.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

let AppProvider, Shell
beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', '') // mode demo
  vi.resetModules()
  ;({ AppProvider } = await import('../store'))
  ;({ Shell } = await import('../App'))
})
const media = wide => q => ({ matches: wide && q.includes('min-width:1024px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
beforeEach(() => {
  window.matchMedia = media(true)
  cleanup()
  localStorage.clear()
  localStorage.setItem('siprak.me', 'dewi.admin')
})

describe('Buat ERO Admin Dept', () => {
  it('request yang tidak dicentang tidak ikut SRL; setelah simpan muncul konfirmasi', async () => {
    render(<AppProvider><Shell /></AppProvider>)
    await waitFor(() => expect(screen.getByText(/^Pool /)).toBeTruthy())
    // Jumlah request di pool mengikuti data seed, jadi tidak memakai angka atau nama tetap.
    const boxes = screen.getAllByRole('checkbox', { name: /Ikut SRL:/ })
    const dipilih = boxes.filter(b => b.checked)
    expect(dipilih.length).toBeGreaterThan(0)
    dipilih.forEach(b => fireEvent.click(b))
    expect(screen.getByText(/^0 dipilih dari \d+ request/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Simpan SRL/ }).disabled).toBe(true)
    fireEvent.click(dipilih[0]) // hanya satu request yang ikut SRL
    expect(screen.getByText(/^1 dipilih dari \d+ request/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('SRL-2611-003'), { target: { value: 'SRL-TES-001' } })
    fireEvent.click(screen.getByRole('button', { name: /Simpan SRL/ }))
    await waitFor(() => expect(screen.getByText(/SRL-TES-001 tersimpan/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Lihat di SRL' })).toBeTruthy()
  })
})
