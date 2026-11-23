import { describe, it, expect } from 'vitest'
import { buildSeed } from '../data/seed'
import { makeSel } from '../lib/selectors'
import { badgeCounts, incomingNotes, AKSI } from '../lib/notes'
import { actions } from '../lib/actions'

const clone = o => JSON.parse(JSON.stringify(o))
const run = (db, name, ...args) => {
  const d = clone(db)
  const r = actions[name](makeSel(d), d, ...args)
  if (r?.err) throw new Error(r.err)
  return d
}

describe('notifikasi perubahan dari orang lain', () => {
  const db = buildSeed()
  const budi = () => db.U.find(u => u.role == 'Atasan' && db.R.some(r => r.st == 'Menunggu Approval' && makeSel(db).user(r.by)?.boss == u.id))

  it('tidak ada catatan bila data sama', () => {
    expect(incomingNotes(db, clone(db), 'andi.prod')).toEqual([])
  })

  it('atasan diberi tahu ada request baru menunggu persetujuannya', () => {
    const atasan = budi()
    const staf = db.U.find(u => u.role == 'User' && u.boss == atasan.id)
    const baru = run(db, 'saveRequest', {
      status: 'Menunggu Approval', me: staf,
      lines: [{ kode: db.M[0].k, qty: '1', datang: '2099-01-01', pakai: '2099-01-02' }],
    })
    const n = incomingNotes(db, baru, atasan.id)
    expect(n.join(' ')).toMatch(/1 request baru menunggu persetujuan Anda/)
  })

  it('pemilik request diberi tahu saat status request berubah', () => {
    const r = db.R.find(x => x.st == 'Menunggu Approval')
    const boss = makeSel(db).user(r.by).boss
    const next = run(db, 'setuju', r.id)
    const n = incomingNotes(db, next, r.by)
    expect(n.some(t => t.startsWith(r.id + ': Disetujui'))).toBe(true)
    expect(boss).toBeTruthy()
  })

  it('maksimal 3 baris, sisanya diringkas', () => {
    const next = clone(db)
    next.R.filter(r => r.by == 'andi.prod').forEach(r => (r.st = 'Dibatalkan'))
    const mine = db.R.filter(r => r.by == 'andi.prod' && r.st != 'Dibatalkan')
    const n = incomingNotes(db, next, 'andi.prod')
    expect(n.length).toBeLessThanOrEqual(4)
    if (mine.length > 3) expect(n[3]).toMatch(/perubahan lain/)
  })

  it('badge dihitung per peran dan semua aksi punya label ramah', () => {
    const sel = makeSel(db)
    const atasan = budi()
    expect(badgeCounts(db, sel, atasan).appr).toBeGreaterThan(0)
    expect(badgeCounts(db, sel, db.U.find(u => u.role == 'User')).appr).toBe(0)
    Object.keys(actions).forEach(a => expect(AKSI[a], 'label untuk ' + a).toBeTruthy())
  })
})
