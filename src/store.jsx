import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { produce } from 'immer'
import { buildSeed } from './data/seed'
import { makeSel } from './lib/selectors'
import { actions } from './lib/actions'
import * as api from './lib/api'
import { outbox } from './lib/outbox'
import { TODAY, refreshToday } from './lib/utils'
import { POLL_MS } from './config'
import { Login } from './components/Login'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)
const REMOTE = api.REMOTE
const emptyDb = () => ({ U: [], HP: {}, M: [], R: [], I: [], K: [], L: [], KD: [], SR: [], RM: [] })

const emptyLine = () => ({ kode: '', qty: '', datang: '', pakai: '' })
export const newLine = emptyLine

export const TABS = {
  User: [['req', 'Request saya'], ['new', 'Buat request']],
  Atasan: [['appr', 'Persetujuan'], ['tim', 'Tim saya']],
  'Admin Dept': [['pool', 'Buat ERO'], ['kon', 'SRL'], ['allr', 'Semua request'], ['usr', 'Pengguna']],
  'Admin Warehouse': [['val', 'Validasi SRL'], ['dtg', 'Kedatangan'], ['srh', 'Serah terima'], ['mst', 'Master item'], ['usr', 'Pengguna']],
  'Spv Warehouse': [['dash', 'Dashboard']],
}

const initialUi = {
  me: '', tab: 'req', draft: [emptyLine()],
  menu: false, eu: null, self: false, help: false, dpic: null, di: null,
  uq: '', ud: '', q: '', sf: '', df: '', dp: 'w0',
}

// Sesi masuk (sementara tanpa kata sandi): id pengguna diingat di perangkat ini.
const SESSION_KEY = 'siprak.me'
const readSession = () => {
  try { return localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
}
const writeSession = id => {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* mode privat: abaikan */ }
}
// Cache lokal: aplikasi langsung tampil dari data terakhir, lalu disegarkan dari server di belakang layar.
const CACHE_KEY = 'siprak.cache.v2'
const readCache = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY))
    return c?.db?.U ? c : null
  } catch { return null }
}
const writeCache = (db, ver) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ db, ver })) } catch { /* kuota penuh: abaikan */ }
}

function Boot({ state, err, retry }) {
  return (
    <div id="app" className="mob" style={{ padding: 24 }}>
      <div className="hd"><h2>Request barang</h2></div>
      {state == 'loading' ? (
        <div className="empty loading" role="status">Memuat data dari server…</div>
      ) : (
        <>
          <div className="empty" role="alert">Tidak bisa memuat data. {err}</div>
          <div className="acts"><button className="btn grow" onClick={retry}>Coba lagi</button></div>
        </>
      )}
    </div>
  )
}

export function AppProvider({ children, initialUi: init }) {
  // Demo (tanpa API): data contoh. Server: dari cache lokal bila ada (cepat), kalau tidak tunggu data server.
  const first = useRef(null)
  if (!first.current) {
    const c = REMOTE ? readCache() : null
    first.current = REMOTE ? { db: c?.db || null, ver: c?.ver || 0, cached: !!c } : { db: buildSeed(), ver: 0, cached: false }
  }
  const [db, setDb] = useState(first.current.db)
  const dbRef = useRef(db)
  const verRef = useRef(first.current.ver)
  const trusted = useRef(!first.current.cached) // versi dari cache belum diverifikasi server
  const [boot, setBoot] = useState({ state: db ? 'ready' : 'loading', err: '' })
  const [ui, setUiState] = useState({ ...initialUi, me: readSession(), ...init })
  const uiRef = useRef(ui)
  uiRef.current = ui
  const [toastS, setToastS] = useState({ text: '', bad: false, show: false })
  const [saving, setSaving] = useState(null) // { tx, phase: 'sending' | 'failed', err? }
  const [net, setNet] = useState({ ok: true })
  const timer = useRef()
  const busyRef = useRef(false)
  const chain = useRef(Promise.resolve())
  const inflight = useRef(new Map())
  const decide = useRef(null)

  const setUi = useCallback(p => setUiState(s => ({ ...s, ...(typeof p == 'function' ? p(s) : p) })), [])

  const toast = useCallback((text, bad = false) => {
    clearTimeout(timer.current)
    setToastS({ text, bad, show: true })
    timer.current = setTimeout(() => setToastS(t => ({ ...t, show: false })), bad ? 6000 : 3200)
  }, [])

  // ---------- data dari server ----------
  // Snapshot pertama dari server selalu diterima (versi dari cache lokal tidak dipercaya);
  // sesudahnya hanya yang lebih baru, supaya respons lama yang terlambat tidak menimpa yang baru.
  const applySnap = useCallback(s => {
    if (!s || typeof s.ver !== 'number') return
    if (trusted.current && s.ver < verRef.current) return
    trusted.current = true
    const { ver, ...data } = s
    verRef.current = ver
    dbRef.current = data
    setDb(data)
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await api.sync(trusted.current ? verRef.current : 0)
      if (!r.ok) throw new Error(r.err || 'Respons server kosong.')
      if (r.snap) applySnap(r.snap)
      else if (r.same) trusted.current = true
      setNet({ ok: true })
      setBoot({ state: 'ready', err: '' })
    } catch (e) {
      // dengan cache: tetap tampil dan tandai offline; tanpa cache: tampilkan galat + Coba lagi
      setNet({ ok: false })
      setBoot(b => (dbRef.current ? { state: 'ready', err: '' } : { state: 'error', err: e.message || String(e) }))
    }
  }, [applySnap])

  useEffect(() => {
    if (REMOTE) load()
  }, [load])

  // Simpan snapshot ke cache lokal setiap data berubah
  useEffect(() => {
    if (REMOTE && db?.U?.length) writeCache(db, verRef.current)
  }, [db])

  // Polling ringan: server membalas { same: true } bila tidak ada perubahan (dilayani dari cache)
  useEffect(() => {
    if (!REMOTE || boot.state != 'ready') return
    let stop = false
    let t
    const tick = async () => {
      if (!document.hidden && !busyRef.current) {
        try {
          const r = await api.sync(verRef.current)
          if (r.ok && r.snap && !busyRef.current) applySnap(r.snap)
          setNet(n => (n.ok ? n : { ok: true }))
        } catch {
          setNet({ ok: false })
        }
      }
      if (!stop) t = setTimeout(tick, POLL_MS + Math.random() * POLL_MS * 0.4) // jitter agar 40 klien tidak serempak
    }
    t = setTimeout(tick, POLL_MS + Math.random() * POLL_MS * 0.4)
    const vis = () => {
      if (!document.hidden) { clearTimeout(t); tick() }
    }
    document.addEventListener('visibilitychange', vis)
    return () => { stop = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis) }
  }, [boot.state, applySnap])

  // Ganti hari saat tab tetap terbuka: segarkan "hari ini" lalu hitung ulang semua turunan (status terlambat, dll.)
  const [day, setDay] = useState(TODAY)
  useEffect(() => {
    const chk = () => { if (refreshToday()) setDay(TODAY) }
    const t = setInterval(chk, 60000)
    document.addEventListener('visibilitychange', chk)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', chk) }
  }, [])

  const sel = useMemo(() => makeSel(db || emptyDb()), [db, day])
  // Pengguna aktif: id sesi harus ada di data dan aktif, kalau tidak -> layar masuk
  const meId = sel.user(ui.me) && !sel.user(ui.me).off ? ui.me : ''
  const me = sel.user(meId)
  const uiEff = useMemo(() => (meId === ui.me ? ui : { ...ui, me: meId }), [ui, meId])

  // Jangan tutup halaman ketika penyimpanan masih berjalan atau belum terkonfirmasi
  useEffect(() => {
    const h = e => {
      if (busyRef.current) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  // ---------- menulis ----------
  // Mode demo lokal: aksi dijalankan di memori (sama seperti sebelumnya)
  const localWrite = useCallback(async ({ name, args }) => {
    let res
    const next = produce(dbRef.current, d => { res = actions[name](makeSel(d), d, ...args) })
    if (res?.err) return { ok: false, rejected: true, err: res.err }
    dbRef.current = next
    setDb(next)
    return { ok: true, verified: true, msg: res?.ok || '' }
  }, [])

  const dry = (name, args) => {
    let res
    produce(dbRef.current, d => { res = actions[name](makeSel(d), d, ...args) })
    return res?.err || ''
  }

  // Satu transaksi sampai tuntas: kirim -> (gagal? tanya pengguna) -> kirim ulang dengan tx SAMA.
  // Mengembalikan true hanya jika server memverifikasi data tersimpan.
  const runLoop = useCallback(
    async entry => {
      for (;;) {
        busyRef.current = true
        setSaving({ tx: entry.tx, phase: 'sending', name: entry.name })
        const r = await (REMOTE ? api.write(entry) : localWrite(entry))
        if (r.ok) {
          outbox.del(entry.tx)
          busyRef.current = false
          setSaving(null)
          if (r.snap) applySnap(r.snap)
          if (!REMOTE) { if (r.msg) toast(r.msg) }
          else if (r.replay) toast('Sudah tersimpan sebelumnya dan terverifikasi. ' + (r.msg || ''))
          else if (r.msg) toast(r.msg + ' Tersimpan dan terverifikasi.')
          return true
        }
        if (r.rejected) {
          outbox.del(entry.tx)
          busyRef.current = false
          setSaving(null)
          if (r.snap) applySnap(r.snap)
          toast(r.err, true)
          return false
        }
        setSaving({ tx: entry.tx, phase: 'failed', name: entry.name, err: r.err, unknown: !!r.unknown })
        const choice = await new Promise(res => { decide.current = res })
        decide.current = null
        if (choice !== 'retry') {
          busyRef.current = false
          setSaving(null)
          return false
        }
      }
    },
    [applySnap, localWrite, toast]
  )

  // Antrean: penulisan dari satu klien berjalan satu per satu
  const enqueue = useCallback(fn => {
    const prev = chain.current
    let rel
    chain.current = new Promise(r => (rel = r))
    return prev.then(fn).finally(rel)
  }, [])

  const act = useCallback(
    (name, ...args) => {
      const fp = name + '|' + JSON.stringify(args)
      const live = inflight.current.get(fp)
      if (live) return live // tombol ditekan berkali-kali: pakai hasil yang sama, jangan kirim lagi
      const p = enqueue(async () => {
        const old = REMOTE ? outbox.find(fp) : null // klik ulang aksi yang belum pasti = retry (tx sama)
        if (REMOTE && !old) {
          const e = dry(name, args) // validasi cepat di klien; server tetap otoritatif
          if (e) { toast(e, true); return false }
        }
        const entry = old || { tx: api.newTx(), fp, name, args, me: uiRef.current.me, at: Date.now() }
        if (REMOTE) outbox.put(entry)
        return runLoop(entry)
      }).finally(() => inflight.current.delete(fp))
      inflight.current.set(fp, p)
      return p
    },
    [enqueue, runLoop, toast]
  )

  // Setelah halaman dimuat ulang: selesaikan transaksi yang dulu belum terkonfirmasi (aman: tx sama)
  const resumed = useRef(false)
  useEffect(() => {
    if (!REMOTE || boot.state != 'ready' || resumed.current) return
    resumed.current = true
    outbox.all().forEach(e => enqueue(() => runLoop(e)))
  }, [boot.state, enqueue, runLoop])

  const retry = useCallback(() => decide.current?.('retry'), [])
  const skip = useCallback(() => decide.current?.('skip'), [])

  const login = useCallback(
    id => {
      writeSession(id)
      setUi({ me: id, tab: 'x', menu: false, eu: null, self: false, help: false, dpic: null, di: null })
    },
    [setUi]
  )
  const logout = useCallback(() => {
    writeSession('')
    setUi({ me: '', tab: 'x', menu: false, eu: null, self: false, help: false, dpic: null, di: null })
  }, [setUi])

  if (boot.state != 'ready' || !db)
    return <Boot state={boot.state == 'error' ? 'error' : 'loading'} err={boot.err} retry={() => { setBoot({ state: 'loading', err: '' }); load() }} />
  if (!me && db.U.length) return <Login users={db.U} onPick={login} />
  if (!me)
    return <Boot state="error" err="Sheet Users masih kosong. Isi pengguna atau jalankan seedDemo() di Apps Script." retry={() => { setBoot({ state: 'loading', err: '' }); load() }} />

  // 'sync' dipertahankan untuk header (teks status kecil di bawah nama)
  const sync = { pending: saving ? 1 : 0, err: net.ok ? '' : 'offline' }
  const value = { db, sel, ui: uiEff, setUi, me, act, toast, toastS, saving, net, sync, retry, skip, remote: REMOTE, logout }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
