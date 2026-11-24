// Menjalankan public/sw.js di VM dengan Cache/fetch tiruan untuk memastikan kebijakan cache-nya benar.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

const code = fs.readFileSync('public/sw.js', 'utf8')

function boot() {
  const stores = new Map()
  const L = {}
  const calls = { net: [] }
  let online = true
  const mkCache = name => {
    if (!stores.has(name)) stores.set(name, new Map())
    const m = stores.get(name)
    return {
      match: async r => m.get(r.url),
      put: async (r, res) => { m.set(r.url, res) },
      keys: async () => [...m.keys()].map(url => ({ url })),
      delete: async r => m.delete(r.url),
    }
  }
  const res = (body, ok = true) => ({ ok, body, clone() { return res(body, ok) } })
  const ctx = vm.createContext({
    URL, Promise, setTimeout, clearTimeout,
    self: { location: { origin: 'https://app.test' }, addEventListener: (t, f) => (L[t] = f), skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { open: async n => mkCache(n), keys: async () => [...stores.keys()], delete: async n => stores.delete(n) },
    fetch: async r => { calls.net.push(r.url); if (!online) throw new Error('offline'); return res('net:' + r.url) },
  })
  vm.runInContext(code, ctx)
  const fire = (url, { method = 'GET', mode = 'cors' } = {}) => {
    let p = null
    L.fetch({ request: { url, method, mode }, respondWith: x => (p = x) })
    return p
  }
  return { L, stores, calls, fire, setOnline: v => (online = v) }
}

describe('service worker', () => {
  let sw
  beforeEach(() => { sw = boot() })

  it('aset ber-hash: jaringan hanya sekali, berikutnya dari cache', async () => {
    const u = 'https://app.test/assets/index-abc.js'
    expect((await sw.fire(u)).body).toBe('net:' + u)
    expect((await sw.fire(u)).body).toBe('net:' + u)
    expect(sw.calls.net.length).toBe(1)
  })

  it('halaman: jaringan dulu; saat offline memakai cadangan', async () => {
    const u = 'https://app.test/Siprak/'
    await sw.fire(u, { mode: 'navigate' })
    sw.setOnline(false)
    expect((await sw.fire(u, { mode: 'navigate' })).body).toBe('net:' + u)
    expect(sw.calls.net.length).toBe(2)
  })

  it('tidak menyentuh API lintas asal maupun permintaan non-GET', () => {
    expect(sw.fire('https://script.google.com/macros/s/x/exec?fn=sync')).toBeNull()
    expect(sw.fire('https://app.test/assets/a.js', { method: 'POST' })).toBeNull()
    expect(sw.fire('https://app.test/data.json')).toBeNull()
  })

  it('aktivasi membuang cache versi lama saja', async () => {
    sw.stores.set('siprak-shell-v0', new Map())
    sw.stores.set('lain', new Map())
    let p
    sw.L.activate({ waitUntil: x => (p = x) })
    await p
    expect([...sw.stores.keys()]).toEqual(['lain'])
  })

  it('aset tua dipangkas agar cache tidak membengkak', async () => {
    for (let i = 0; i < 70; i++) await sw.fire(`https://app.test/assets/f${i}.js`)
    const cache = [...sw.stores.values()][0]
    expect(cache.size).toBeLessThanOrEqual(60)
    expect(cache.has('https://app.test/assets/f69.js')).toBe(true)
    expect(cache.has('https://app.test/assets/f0.js')).toBe(false)
  })
})
