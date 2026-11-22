import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { produce } from 'immer'
import { buildSeed } from './data/seed'
import { makeSel } from './lib/selectors'
import { actions } from './lib/actions'
import * as api from './lib/api'
import { outbox } from './lib/outbox'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)
const REMOTE = api.REMOTE

const emptyLine = () => ({ kode: '', qty: '', datang: '', pakai: '' })
export const newLine = emptyLine

export const TABS = {
  User: [['req', 'Request saya'], ['new', 'Buat request']],
  Atasan: [['appr', 'Persetujuan'], ['tim', 'Tim saya']],
  'Admin Dept': [['pool', 'Buat ERO'], ['kon', 'SRL'], ['allr', 'Semua request'], ['usr', 'Pengguna']],
  'Admin Warehouse': [['dtg', 'Kedatangan'], ['srh', 'Serah terima'], ['usr', 'Pengguna']],
  'Spv Warehouse': [['dash', 'Dashboard']],
}

const savedMe = () => {
  try {
    return localStorage.getItem('siprak.me') || 'andi.prod'
  } catch {
    return 'andi.prod'
  }
}

const initialUi = {
  me: savedMe(), tab: 'req', draft: [emptyLine()],
  menu: false, eu: null, self: false, help: false, dpic: null, di: null,
  uq: '', ud: '', q: '', sf: '', df: '', dp: 'w0',
}

const POLL_MS = +import.meta.env.VITE_POLL_MS || 12000

function Boot({ state, err, retry }) {
  return (
    <div id="app" className="mob" style={{ padding: 24 }}>
      <div className="hd"><h2>Request barang</h2></div>
      {state == 'loading' ? (
        <div className="empty" role="status">Memuat data dari server…</div>
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
  const [db, setDb] = useState(() => (REMOTE ? null : buildSeed()))
  const dbRef = useRef(db)
  const verRef = useRef(0)
  const [boot, setBoot] = useState({ state: REMOTE ? 'loading' : 'ready', err: '' })
  const [ui, setUiState] = useState({ ...initialUi, ...init })
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

  useEffect(() => {
    try { localStorage.setItem('siprak.me', ui.me) } catch {}
  }, [ui.me])

  // ---------- data dari server ----------
  const applySnap = useCallback(s => {
    if (!s || typeof s.ver !== 'number' || s.ver < verRef.current) return
    const { ver, ...data } = s
    verRef.current = ver
    dbRef.current = data
    setDb(data)
  }, [])

  const load = useCallback(async () => {
    setBoot({ state: 'loading', err: '' })
    try {
      const r = await api.sync(0)
      if (!r.ok || !r.snap) throw new Error(r.err || 'Respons server kosong.')
      if (!r.snap.U?.length) throw new Error('Sheet Users masih kosong. Isi pengguna atau jalankan seedDemo() di Apps Script.')
      applySnap(r.snap)
      const u = r.snap.U
      if (!u.find(x => x.id == uiRef.current.me)) setUiState(s => ({ ...s, me: (u.find(x => !x.off) || u[0]).id }))
      setBoot({ state: 'ready', err: '' })
    } catch (e) {
      setBoot({ state: 'error', err: e.message || String(e) })
    }
  }, [applySnap])

  useEffect(() => {
    if (REMOTE) load()
  }, [load])

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
      if (!stop) t = setTimeout(tick, POLL_MS + Math.random() * 6000) // jitter agar 40 klien tidak serempak
    }
    t = setTimeout(tick, POLL_MS + Math.random() * 6000)
    const vis = () => {
      if (!document.hidden) { clearTimeout(t); tick() }
    }
    document.addEventListener('visibilitychange', vis)
    return () => { stop = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis) }
  }, [boot.state, applySnap])

  const sel = useMemo(() => (db ? makeSel(db) : null), [db])
  const me = db ? sel.user(ui.me) || db.U[0] : null

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

  if (boot.state != 'ready') return <Boot state={boot.state} err={boot.err} retry={load} />

  const value = { db, sel, ui, setUi, me, act, toast, toastS, saving, net, retry, skip, remote: REMOTE }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
