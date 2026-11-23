// Request 100% pindah ke Histori; daftar aktif hanya memuat yang belum selesai dan tetap ringan untuk data besar.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { buildSeed } from '../data/seed'
import { makeSel } from '../lib/selectors'

const db = (over = {}) => ({ U: [], M: [], R: [], I: [], K: [], L: [], KD: [], SR: [], RM: [], ...over })

describe('reqEnd: kapan request dianggap selesai', () => {
  for (const cache of [false, true]) {
    const mk = d => makeSel(d, { cache })
    const tag = cache ? ' (selector ber-indeks)' : ''

    it('Ditolak dan Dibatalkan langsung masuk riwayat' + tag, () => {
      const sel = mk(db())
      expect(sel.reqEnd({ id: 'R1', st: 'Ditolak' })).toBe('Ditolak')
      expect(sel.reqEnd({ id: 'R2', st: 'Dibatalkan' })).toBe('Dibatalkan')
    })

    it('Draft dan Menunggu Approval tidak pernah selesai' + tag, () => {
      const sel = mk(db({ I: [{ id: 'I1', req: 'R1', qty: '1', status: 'Draft' }] }))
      expect(sel.reqEnd({ id: 'R1', st: 'Draft' })).toBe('')
      expect(sel.reqEnd({ id: 'R1', st: 'Menunggu Approval' })).toBe('')
    })

    it('Selesai hanya bila SEMUA barang sudah diambil penuh' + tag, () => {
      const I = [
        { id: 'I1', req: 'R1', qty: '5', status: 'Sudah di ERO', kon: '' },
        { id: 'I2', req: 'R1', qty: '3', status: 'Sudah di ERO', kon: '' },
      ]
      const R = { id: 'R1', st: 'Disetujui' }
      expect(mk(db({ I, SR: [{ item: 'I1', qty: '5' }] })).reqEnd(R)).toBe('')
      expect(mk(db({ I, SR: [{ item: 'I1', qty: '5' }, { item: 'I2', qty: '2' }] })).reqEnd(R)).toBe('')
      expect(mk(db({ I, SR: [{ item: 'I1', qty: '5' }, { item: 'I2', qty: '3' }] })).reqEnd(R)).toBe('Selesai')
    })

    it('barang belum masuk ERO (Approved) menahan request di daftar aktif' + tag, () => {
      const I = [
        { id: 'I1', req: 'R1', qty: '1', status: 'Sudah di ERO', kon: '' },
        { id: 'I2', req: 'R1', qty: '1', status: 'Approved', kon: '' },
      ]
      expect(mk(db({ I, SR: [{ item: 'I1', qty: '1' }] })).reqEnd({ id: 'R1', st: 'Disetujui' })).toBe('')
    })

    it('request tanpa barang sama sekali tidak dianggap selesai' + tag, () => {
      expect(mk(db()).reqEnd({ id: 'R9', st: 'Disetujui' })).toBe('')
    })

    it('sisa ditutup: selesai begitu semua yang datang sudah diambil' + tag, () => {
      const base = {
        K: [{ id: 'K1', tutup: '2', srl: 'S1' }],
        KD: [{ kon: 'K1', qty: '4' }],
        I: [{ id: 'I1', req: 'R1', qty: '6', status: 'Sudah di ERO', kon: 'K1', appr: '2026-11-01', pakai: '' }],
      }
      const R = { id: 'R1', st: 'Disetujui' }
      expect(mk(db({ ...base, SR: [] })).reqEnd(R)).toBe('')
      expect(mk(db({ ...base, SR: [{ item: 'I1', qty: '4' }] })).reqEnd(R)).toBe('Selesai')
    })

    it('barang tunggal yang ditolak/dibatalkan tidak menahan request lain di aktif' + tag, () => {
      const I = [
        { id: 'I1', req: 'R1', qty: '2', status: 'Sudah di ERO', kon: '' },
        { id: 'I2', req: 'R1', qty: '2', status: 'Dibatalkan', kon: '' },
      ]
      expect(mk(db({ I, SR: [{ item: 'I1', qty: '2' }] })).reqEnd({ id: 'R1', st: 'Disetujui' })).toBe('Selesai')
    })
  }
})

// ---------- UI ----------
const media = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
const base = buildSeed()
const mine = 'siti.prod'

// 3000 request selesai + data contoh bawaan: menguji bahwa histori yang membengkak tidak ikut digambar
const BESAR = 3000
const bigSeed = () => {
  const s = buildSeed()
  for (let n = 1; n <= BESAR; n++) {
    const id = 'RH-' + String(n).padStart(4, '0')
    const tgl = `2026-${String(1 + (n % 9)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`
    s.R.push({ id, by: mine, tgl, st: 'Disetujui', cat: '' })
    s.I.push({ id: 'IH-' + n, req: id, kode: 'SRG-001', qty: '2', datang: tgl, pakai: '', status: 'Sudah di ERO', appr: tgl, kon: '', tahan: '', alasan: '' })
    s.SR.push({ item: 'IH-' + n, qty: '2', to: mine })
  }
  return s
}

let AppProvider, Shell
const load = async seedFn => {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', '')
  if (seedFn) {
    vi.doMock('../data/seed', async orig => ({ ...(await orig()), buildSeed: seedFn }))
  } else {
    vi.doUnmock('../data/seed')
  }
  ;({ AppProvider } = await import('../store'))
  ;({ Shell } = await import('../App'))
}
const open = async id => {
  localStorage.setItem('siprak.me', id)
  const r = render(<AppProvider><Shell /></AppProvider>)
  await waitFor(() => expect(r.container.querySelector('nav button')).toBeTruthy())
  return r
}
const tab = name => fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name) }))

beforeEach(() => {
  window.matchMedia = media
  window.scrollTo = () => {}
  cleanup()
  localStorage.clear()
})

describe('Request saya vs Histori (data contoh)', () => {
  beforeAll(() => load())

  it('Request saya hanya memuat yang belum selesai; yang selesai ada di Histori', async () => {
    const sel = makeSel(base)
    const own = base.R.filter(r => r.by == mine)
    const aktif = own.filter(r => !sel.reqEnd(r)).map(r => r.id)
    const selesai = own.filter(r => sel.reqEnd(r)).map(r => r.id)
    expect(selesai).toContain('RQ-002') // diambil penuh di data contoh
    expect(aktif.length).toBeGreaterThan(0)

    const { container } = await open(mine)
    const ids = () => [...container.querySelectorAll('main .row > .between b')].map(e => e.textContent)
    expect(ids().sort()).toEqual(aktif.sort())
    expect(ids()).not.toContain('RQ-002')

    tab('Histori')
    await waitFor(() => expect(screen.getByRole('list', { name: /histori/i })).toBeTruthy())
    const rows = within(screen.getByRole('list', { name: /histori/i })).getAllByRole('listitem')
    expect(rows.map(r => r.querySelector('b').textContent).sort()).toEqual(selesai.sort())
  })

  it('Histori: rincian barang baru muncul saat baris dibuka; ditolak/dibatalkan punya lencana sendiri', async () => {
    await open('rudi.prod') // RQ-010 Ditolak dengan catatan atasan
    tab('Histori')
    const row = (await screen.findByText('RQ-010')).closest('li')
    expect(within(row).getByText('Ditolak')).toBeTruthy()
    expect(row.querySelector('.itm')).toBeNull() // belum dibuka: tidak digambar
    fireEvent.click(within(row).getByRole('button'))
    expect(row.querySelector('.itm')).toBeTruthy()
    expect(row.textContent).toContain('Stok helm masih cukup, tunda dulu')
  })

  it('Histori: pencarian dan filter status bekerja, ada tombol hapus filter', async () => {
    await open('andi.prod') // RQ-011 Dibatalkan
    tab('Histori')
    const list = await screen.findByRole('list', { name: /histori/i })
    const before = within(list).getAllByRole('listitem').length
    fireEvent.change(screen.getByLabelText('Cari request'), { target: { value: 'RQ-011' } })
    await waitFor(() => expect(within(screen.getByRole('list', { name: /histori/i })).getAllByRole('listitem')).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('Cari request'), { target: { value: 'tidak-ada-yang-cocok' } })
    await waitFor(() => expect(screen.getByText(/tidak ada request yang cocok/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Hapus filter' }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: /histori/i })).getAllByRole('listitem')).toHaveLength(before))
  })

  it('Request saya menampilkan tautan ke Histori dengan jumlahnya', async () => {
    await open(mine)
    fireEvent.click(screen.getByRole('button', { name: /Lihat Histori \(\d+ request\)/ }))
    await waitFor(() => expect(screen.getByRole('list', { name: /histori/i })).toBeTruthy())
  })
})

describe('skala besar: 3000 request selesai', () => {
  beforeAll(() => load(bigSeed))

  it('Request saya hanya menggambar satu halaman kartu aktif; Histori satu halaman baris', async () => {
    const { container } = await open(mine)
    // tidak satu pun dari 3000 request selesai ikut digambar di daftar kerja
    expect(container.querySelectorAll('main .row').length).toBeLessThanOrEqual(10)
    expect(container.textContent).not.toContain('RH-0001')

    expect(screen.getByRole('button', { name: new RegExp(`Lihat Histori \\(\\d+ request\\)`) }).textContent).toMatch(/\(30\d\d request\)/)
    tab('Histori')
    const list = await screen.findByRole('list', { name: /histori/i })
    expect(within(list).getAllByRole('listitem')).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: /^Tampilkan 20 lagi/ }))
    expect(within(screen.getByRole('list', { name: /histori/i })).getAllByRole('listitem')).toHaveLength(40)
    // rincian barang belum digambar untuk baris yang belum dibuka
    expect(container.querySelectorAll('.itm').length).toBe(0)
  })
})
