// Impor master item: nilai ambigu harus ditolak, bukan diam-diam dianggap 0 (penting untuk data sungguhan).
import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { parseMaster, cleanMaster } from '../lib/utils'
import { buildSeed } from '../data/seed'
import { makeSel } from '../lib/selectors'
import { actions } from '../lib/actions'

describe('parseMaster: Buffer/Konsinyasi', () => {
  it('menerima 1/0, Ya/Tidak, kosong', () => {
    const r = parseMaster('A-1\tBaut\tPcs\t1\t0\t3\nA-2\tOli\tLtr\tYa\tTidak\t5\nA-3\tKabel\tM\t\t\t2')
    expect(r.map(x => x.err)).toEqual(['', '', ''])
    expect(r.map(x => [x.buf, x.kons])).toEqual([['1', '0'], ['1', '0'], ['0', '0']])
  })
  it('menolak nilai tak dikenal (2, x, salah ketik) dengan pesan yang menyebut nilainya', () => {
    const r = parseMaster('B-1\tX\tPcs\t2\t0\t3\nB-2\tY\tPcs\t1\tx\t3\nB-3\tZ\tPcs\tYaa\t0\t3')
    expect(r[0].err).toMatch(/Buffer harus.*"2"/)
    expect(r[1].err).toMatch(/Konsinyasi harus.*"x"/)
    expect(r[2].err).toMatch(/Buffer harus.*"Yaa"/)
  })
  it('aturan lama tetap: kode/nama/satuan wajib, lead time angka', () => {
    expect(cleanMaster({ k: '', n: 'a', sat: 'b' }).err).toMatch(/Kode/)
    expect(cleanMaster({ k: 'a', n: '', sat: 'b' }).err).toMatch(/Nama/)
    expect(cleanMaster({ k: 'a', n: 'b', sat: '' }).err).toMatch(/Satuan/)
    expect(cleanMaster({ k: 'a', n: 'b', sat: 'c', lead: 'tiga' }).err).toMatch(/Lead/)
    expect(cleanMaster({ k: 'a b', n: 'b', sat: 'c' }).k).toBe('A-B')
  })
})

describe('importMaster di server: baris bermasalah tidak pernah tersimpan', () => {
  const run = rows => {
    const db = buildSeed()
    const n0 = db.M.length
    let res
    const next = produce(db, d => { res = actions.importMaster(makeSel(d), d, rows) })
    return { res, added: next.M.length - n0, next }
  }
  it('baris ber-err dari klien dibuang walau kolomnya tampak valid', () => {
    const rows = parseMaster('Z-1\tA\tPcs\t1\t0\t3\nZ-2\tB\tPcs\t2\t0\t3') // baris 2: Buffer "2" tidak valid
    const { res, added, next } = run(rows)
    expect(added).toBe(1)
    expect(next.M.find(m => m.k == 'Z-2')).toBeUndefined()
    expect(res.ok).toMatch(/1 baris tidak valid dilewati/)
  })
  it('klien nakal yang mengirim nilai mentah tak dikenal tetap ditolak server', () => {
    const { added } = run([{ k: 'Z-3', n: 'C', sat: 'Pcs', buf: 'x', kons: '0', lead: '3' }])
    expect(added).toBe(0)
  })
  it('semua baris tidak valid: ditolak dengan pesan', () => {
    expect(run(parseMaster('Z-4\t\tPcs')).res.err).toMatch(/Tidak ada baris yang valid/)
  })
})
