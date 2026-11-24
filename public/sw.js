// SIPRAK service worker: kerangka aplikasi tersedia tanpa jaringan dan pemuatan ulang nyaris instan.
//  - /assets/* (berkas ber-hash, isinya tidak pernah berubah)  -> cache dulu, jaringan hanya bila belum ada
//  - halaman, manifest, ikon                                      -> jaringan dulu (versi baru langsung terpakai);
//                                                                    bila jaringan lambat (>3,5 dtk) atau mati, pakai cadangan
//  - permintaan lintas asal (API Google Apps Script) dan non-GET  -> TIDAK disentuh sama sekali
// Menaikkan VERSION membuang semua cache lama.
const VERSION = 'v1'
const CACHE = 'siprak-shell-' + VERSION
const NET_TIMEOUT = 3500
const MAX_ASSETS = 60

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('siprak-shell-') && k !== CACHE) await caches.delete(k)
      await self.clients.claim()
    })()
  )
)

async function trim(cache) {
  const keys = (await cache.keys()).filter(r => r.url.includes('/assets/'))
  for (const r of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(r) // yang tertua dulu
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    await cache.put(req, res.clone())
    await trim(cache)
  }
  return res
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  const net = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone())
    return res
  })
  if (!cached) return net
  return Promise.race([net.catch(() => cached), new Promise(ok => setTimeout(() => ok(cached), NET_TIMEOUT))])
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.includes('/assets/')) e.respondWith(cacheFirst(req))
  else if (req.mode === 'navigate' || /\.(webmanifest|png|ico|svg)$/.test(url.pathname)) e.respondWith(networkFirst(req))
})
