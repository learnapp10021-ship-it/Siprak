import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSel } from '../lib/selectors'
import { TODAY, refreshToday, days } from '../lib/utils'

const db = (over = {}) => ({ U: [], M: [], R: [], I: [], K: [], L: [], KD: [], SR: [], RM: [], ...over })

describe('urutan jatah barang (ord)', () => {
  it('mengembalikan 0 untuk dua barang yang setara, dan konsisten di kedua arah', () => {
    const { ord } = makeSel(db())
    const a = { id: 'A', pakai: '2026-12-01', appr: '2026-11-20' }
    const b = { id: 'B', pakai: '2026-12-01', appr: '2026-11-20' }
    expect(ord(a, b)).toBe(0)
    expect(ord(b, a)).toBe(0)
  })

  it('mengurutkan menurut tanggal pakai, lalu tanggal approve; tanpa tanggal pakai dianggap paling akhir', () => {
    const { ord } = makeSel(db())
    const lama = { id: 'L', pakai: '2026-12-01', appr: '2026-11-01' }
    const baru = { id: 'N', pakai: '2026-12-01', appr: '2026-11-05' }
    const awal = { id: 'W', pakai: '2026-11-30', appr: '2026-11-09' }
    const kosong = { id: 'K', pakai: '', appr: '2026-11-01' }
    const urut = [kosong, baru, lama, awal].sort(ord).map(x => x.id)
    expect(urut).toEqual(['W', 'L', 'N', 'K'])
  })

  it('barang setara tetap dalam urutan masuk (sort stabil), jatah tidak berubah-ubah', () => {
    const items = ['I1', 'I2', 'I3', 'I4'].map(id => ({ id, pakai: '2026-12-01', appr: '2026-11-20' }))
    const { ord } = makeSel(db())
    expect([...items].sort(ord).map(x => x.id)).toEqual(['I1', 'I2', 'I3', 'I4'])
  })
})

describe('status barang saat data tidak konsisten', () => {
  it('kode barang tidak ada di master: tidak melempar galat', () => {
    const barang = { id: 'I1', req: 'R1', kode: 'TYPO-1', qty: '5', status: 'Draft' }
    const sel = makeSel(db({ I: [barang] }))
    expect(() => sel.st(barang)).not.toThrow()
    expect(sel.st(barang)[0]).toBe(0)
  })

  it('sudah di ERO tetapi konsolidasi hilang: tidak melempar galat', () => {
    const it1 = { id: 'I1', req: 'R1', kode: 'SRG-001', qty: '5', status: 'Sudah di ERO', kon: 'K-404' }
    const sel = makeSel(db({ M: [{ k: 'SRG-001', n: 'Sarung', sat: 'pcs' }], I: [it1] }))
    const [tahap, , label] = sel.st(it1)
    expect(tahap).toBe(3)
    expect(label).toContain('Sudah di ERO')
  })

  it('deptOf tidak melempar galat jika request atau pemohon tidak ditemukan', () => {
    const sel = makeSel(db())
    expect(sel.deptOf({ req: 'R-404' })).toBeUndefined()
  })
})

describe('pergantian hari (TODAY)', () => {
  afterEach(() => {
    vi.useRealTimers()
    refreshToday()
  })

  it('refreshToday memperbarui TODAY hanya saat hari berganti', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 23, 23, 59))
    refreshToday()
    expect(TODAY).toBe('2026-11-23')
    expect(refreshToday()).toBe(false)

    vi.setSystemTime(new Date(2026, 10, 24, 0, 1))
    expect(refreshToday()).toBe(true)
    expect(TODAY).toBe('2026-11-24')
    expect(refreshToday()).toBe(false)
  })

  it('days() ikut memakai hari yang sudah disegarkan', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 23, 12, 0))
    refreshToday()
    expect(days('2026-11-20')).toBe(3)
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0))
    refreshToday()
    expect(days('2026-11-20')).toBe(5)
  })
})

describe('reqClosed (request selesai / closed)', () => {
  const k = (tutup = '0') => ({ id: 'K1', tahap: 'Sudah di ERO', srl: 'S1', tutup })
  const itm = (id, qty, over = {}) => ({ id, req: 'R1', kode: 'X', qty: String(qty), status: 'Sudah di ERO', kon: 'K1', appr: '2026-11-01', pakai: '', ...over })
  const R = st => ({ id: 'R1', by: 'u', st })

  it('Ditolak dan Dibatalkan selalu closed; Draft dan Menunggu tidak', () => {
    const s = makeSel(db())
    expect(s.reqClosed(R('Ditolak'))).toBe(true)
    expect(s.reqClosed(R('Dibatalkan'))).toBe(true)
    expect(s.reqClosed(R('Draft'))).toBe(false)
    expect(s.reqClosed(R('Menunggu Approval'))).toBe(false)
  })

  it('Disetujui: closed hanya bila semua barang sudah diambil penuh', () => {
    const base = { K: [k()], KD: [{ kon: 'K1', qty: '10', lebih: '0', tgl: '2026-11-02' }] }
    const buka = makeSel(db({ ...base, I: [itm('A', 10)], SR: [{ item: 'A', qty: '4' }] }))
    expect(buka.reqClosed(R('Disetujui'))).toBe(false)
    const tutup = makeSel(db({ ...base, I: [itm('A', 10)], SR: [{ item: 'A', qty: '10' }] }))
    expect(tutup.reqClosed(R('Disetujui'))).toBe(true)
  })

  it('Disetujui: belum datang atau belum di ERO tidak closed', () => {
    expect(makeSel(db({ K: [k()], I: [itm('A', 10)] })).reqClosed(R('Disetujui'))).toBe(false)
    expect(makeSel(db({ I: [itm('A', 10, { status: 'Approved', kon: '' })] })).reqClosed(R('Disetujui'))).toBe(false)
  })

  it('sisa ditutup: closed setelah semua yang datang diambil; belum closed bila masih ada yang siap diambil', () => {
    const base = { K: [k('6')], KD: [{ kon: 'K1', qty: '4', lebih: '0', tgl: '2026-11-02' }], I: [itm('A', 10)] }
    expect(makeSel(db({ ...base, SR: [{ item: 'A', qty: '4' }] })).reqClosed(R('Disetujui'))).toBe(true)
    expect(makeSel(db({ ...base, SR: [{ item: 'A', qty: '1' }] })).reqClosed(R('Disetujui'))).toBe(false)
  })

  it('barang yang ditolak/dibatalkan diabaikan; request tanpa barang hidup tidak closed', () => {
    const base = { K: [k()], KD: [{ kon: 'K1', qty: '5', lebih: '0', tgl: '2026-11-02' }] }
    const s = makeSel(db({ ...base, I: [itm('A', 5), itm('B', 3, { status: 'Dibatalkan' })], SR: [{ item: 'A', qty: '5' }] }))
    expect(s.reqClosed(R('Disetujui'))).toBe(true)
    expect(makeSel(db({ I: [itm('B', 3, { status: 'Dibatalkan' })] })).reqClosed(R('Disetujui'))).toBe(false)
  })
})
