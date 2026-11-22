// Uji alur klien end-to-end: store React ASLI + api.js ASLI terhubung ke backend Code.gs ASLI
// (di atas tiruan Google Sheets). Yang dicek: tombol berkali-kali, respons hilang, retry, penolakan.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, act as rtlAct, waitFor, cleanup } from '@testing-library/react'
import { createBackend } from '../../backend/test/mock-gas.mjs'

const be = createBackend()
const { env, ctx } = be
ctx.setup()
ctx.seedDemo()

const rows = name => {
  const sh = env.sheets.get(name)
  const h = sh.cells[0]
  return sh.cells.slice(1).filter(r => r && r[0]).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}
const TODAY = be.$('TODAY')
const addDays = (d, n) => be.$(`addDays('${d}', ${n})`)

// jaringan palsu -> backend; bisa "menghilangkan" respons setelah server selesai menulis
const net = { posts: 0, gets: 0, dropResponses: 0, down: false }
globalThis.fetch = async (url, opts = {}) => {
  if (net.down) throw new TypeError('network down')
  const u = new URL(url)
  let text
  if (!opts.method || opts.method === 'GET') {
    net.gets++
    text = ctx.doGet({ parameter: Object.fromEntries(u.searchParams) }).getContent()
  } else {
    net.posts++
    text = ctx.doPost({ postData: { contents: opts.body } }).getContent()
    if (net.dropResponses > 0) { net.dropResponses--; throw new TypeError('response lost') }
  }
  return { status: 200, text: async () => text }
}

let app, AppProvider, useApp
const line = q => ({ kode: 'SRG-001', qty: String(q), datang: addDays(TODAY, 10), pakai: addDays(TODAY, 14) })
const draftArgs = q => [{ status: 'Draft', lines: [line(q)], me: { id: 'andi.prod', boss: 'budi.spv', role: 'User' } }]

function Probe() {
  app = useApp()
  return <div data-testid="r">{app.db.R.length}</div>
}
const mount = async () => {
  render(<AppProvider><Probe /></AppProvider>)
  await waitFor(() => expect(app?.db).toBeTruthy())
  await waitFor(() => expect(app.db.U.length).toBeGreaterThan(0))
}

beforeAll(async () => {
  vi.stubEnv('VITE_API_URL', 'http://gas.test/exec')
  vi.stubEnv('VITE_POLL_MS', '60')
  vi.resetModules()
  ;({ AppProvider, useApp } = await import('../store'))
})
beforeEach(() => {
  cleanup()
  localStorage.clear()
  localStorage.setItem('siprak.me', 'andi.prod')
  Object.assign(net, { posts: 0, gets: 0, dropResponses: 0, down: false })
})

describe('klien SIPRAK + backend Google Sheets', () => {
  it('memuat data dari server', async () => {
    await mount()
    expect(app.db.R.length).toBe(rows('Requests').length)
    expect(app.me.id).toBe('andi.prod')
  })

  it('tombol ditekan 6x: hanya 1 pengiriman dan 1 baris tersimpan', async () => {
    await mount()
    const before = rows('Requests').length
    const args = draftArgs(21)
    let results
    await rtlAct(async () => {
      results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => app.act('saveRequest', ...args)))
    })
    expect(results.every(x => x === true)).toBe(true)
    expect(net.posts).toBe(1)
    expect(rows('Requests').length).toBe(before + 1)
    expect(app.db.R.length).toBe(before + 1) // layar sudah memuat data terverifikasi dari server
    expect(app.saving).toBe(null)
  })

  it('respons hilang setelah server menyimpan: gagal ditampilkan, Coba lagi tidak membuat data ganda', async () => {
    await mount()
    const before = rows('Requests').length
    net.dropResponses = 1
    let done
    await rtlAct(async () => { done = app.act('saveRequest', ...draftArgs(22)) })
    await waitFor(() => expect(app.saving?.phase).toBe('failed'))
    expect(app.saving.unknown).toBe(true)
    expect(rows('Requests').length).toBe(before + 1) // server memang sudah menyimpan
    expect(outboxSize()).toBe(1) // tercatat di perangkat agar retry memakai tx yang sama
    await rtlAct(async () => { app.retry(); await done })
    expect(await done).toBe(true)
    expect(rows('Requests').length).toBe(before + 1) // TETAP 1: tidak ganda
    expect(net.posts).toBe(2)
    const tx = rows('Tx').filter(t => t.action === 'saveRequest').slice(-1)[0]
    expect(tx.status).toBe('OK')
    expect(outboxSize()).toBe(0)
  })

  it('klik ulang saat gagal lalu "Nanti", lalu klik lagi: tetap tidak ganda (tx dipakai ulang)', async () => {
    await mount()
    const before = rows('Requests').length
    net.dropResponses = 1
    let p1
    await rtlAct(async () => { p1 = app.act('saveRequest', ...draftArgs(23)) })
    await waitFor(() => expect(app.saving?.phase).toBe('failed'))
    await rtlAct(async () => { app.skip(); await p1 })
    expect(await p1).toBe(false)
    expect(rows('Requests').length).toBe(before + 1)
    let p2
    await rtlAct(async () => { p2 = await app.act('saveRequest', ...draftArgs(23)) })
    expect(p2).toBe(true)
    expect(rows('Requests').length).toBe(before + 1) // pengguna menekan tombol lagi: tetap 1
  })

  it('server mati total lalu pulih: data tidak hilang, tersimpan sekali', async () => {
    await mount()
    const before = rows('Requests').length
    net.down = true
    let p
    await rtlAct(async () => { p = app.act('saveRequest', ...draftArgs(24)) })
    await waitFor(() => expect(app.saving?.phase).toBe('failed'))
    expect(rows('Requests').length).toBe(before)
    net.down = false
    await rtlAct(async () => { app.retry(); await p })
    expect(await p).toBe(true)
    expect(rows('Requests').length).toBe(before + 1)
  })

  it('transaksi tertunda diselesaikan otomatis setelah halaman dimuat ulang', async () => {
    await mount()
    const before = rows('Requests').length
    net.dropResponses = 1
    let p
    await rtlAct(async () => { p = app.act('saveRequest', ...draftArgs(25)) })
    await waitFor(() => expect(app.saving?.phase).toBe('failed'))
    cleanup() // "tutup tab" -- outbox tetap di localStorage
    await mount() // buka lagi
    await waitFor(() => expect(outboxSize()).toBe(0))
    expect(rows('Requests').length).toBe(before + 1) // tidak hilang, tidak ganda
  })

  it('ditolak server (sudah diproses orang lain): false + pesan, tidak ada yang tertulis', async () => {
    await mount()
    // atasan lain sudah memproses lebih dulu
    const r = await rtlAct(async () => app.act('saveRequest', ...draftArgs(26)))
    const rid = rows('Requests').slice(-1)[0].id
    be.ctx.doPost({ postData: { contents: JSON.stringify({ tx: 'TX-manual-0001-aaaa', name: 'ajukan', me: 'andi.prod', args: [rid] }) } })
    be.ctx.doPost({ postData: { contents: JSON.stringify({ tx: 'TX-manual-0002-bbbb', name: 'setuju', me: 'budi.spv', args: [rid] }) } })
    const before = rows('Requests').length
    let ok
    await rtlAct(async () => { ok = await app.act('batal', rid) }) // klien masih mengira Draft
    expect(ok).toBe(false)
    expect(app.toastS.bad).toBe(true)
    expect(rows('Requests').find(x => x.id === rid).st).toBe('Disetujui')
    expect(rows('Requests').length).toBe(before)
    expect(outboxSize()).toBe(0)
    expect(app.saving).toBe(null)
    expect(app.db.R.find(x => x.id === rid).st).toBe('Disetujui') // layar disegarkan dari respons penolakan
  })

  it('validasi input gagal di klien: tidak ada panggilan jaringan', async () => {
    await mount()
    const args = draftArgs(0)
    let ok
    await rtlAct(async () => { ok = await app.act('saveRequest', ...args) })
    expect(ok).toBe(false)
    expect(net.posts).toBe(0)
  })

  it('polling mengambil perubahan dari user lain', async () => {
    await mount()
    const before = app.db.R.length
    ctx.doPost({ postData: { contents: JSON.stringify({ tx: 'TX-lain-0001-cccc', name: 'saveRequest', me: 'siti.prod', args: [{ status: 'Draft', lines: [line(88)], me: {} }] }) } })
    await waitFor(() => expect(app.db.R.length).toBe(before + 1), { timeout: 3000 })
  })
})

function outboxSize() {
  return JSON.parse(localStorage.getItem('siprak.outbox.v1') || '[]').length
}
