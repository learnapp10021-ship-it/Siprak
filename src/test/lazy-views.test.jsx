// Layar dimuat malas per tab: kerangka hanya saat pertama kali, pindah tab tidak memutihkan layar, preload membuat render sinkron.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AppProvider } from '../store'
import { Shell } from '../App'
import { VIEWS, preloadTabs } from '../views/registry'

beforeEach(() => {
  window.scrollTo = () => {}
  cleanup()
  localStorage.clear()
  localStorage.setItem('siprak.me', 'andi.prod') // User: tab req, new, his
})

describe('Layar dimuat malas', () => {
  it('semua tab terdaftar dan punya preload', () => {
    for (const k of ['dash', 'allr', 'usr', 'req', 'new', 'his', 'appr', 'tim', 'pool', 'kon', 'dtg', 'srh', 'mst', 'val'])
      expect(typeof VIEWS[k]?.preload, k).toBe('function')
  })

  it('layar pertama: kerangka sebentar, lalu isi layar', async () => {
    const { container } = render(<AppProvider><Shell /></AppProvider>)
    await waitFor(() => expect(container.querySelector('main.v-req')).toBeTruthy())
    expect(container.querySelector('.v-load')).toBeNull() // kerangka hilang setelah layar siap
    expect(container.querySelector('nav button[aria-current="true"]')).toBeTruthy()
  })

  it('pindah tab: layar lama tetap sampai layar baru siap, lalu berganti', async () => {
    const { container } = render(<AppProvider><Shell /></AppProvider>)
    await waitFor(() => expect(container.querySelector('main.v-req')).toBeTruthy())
    const btn = [...container.querySelectorAll('nav button')].find(b => /Buat/i.test(b.textContent))
    fireEvent.click(btn)
    // tidak pernah tampil kerangka saat pindah tab (layar lama dipertahankan oleh transisi)
    expect(container.querySelector('.v-load')).toBeNull()
    await waitFor(() => expect(container.querySelector('main.v-new')).toBeTruthy())
    expect(container.querySelector('main.v-req')).toBeNull()
  })

  it('preload memuat kode tanpa merender dan aman dipanggil berulang', async () => {
    await preloadTabs(['his', 'his', 'appr'])
    await preloadTabs(['his'])
    const { container } = render(<AppProvider><Shell /></AppProvider>)
    await waitFor(() => expect(container.querySelector('main')).toBeTruthy())
  })
})
