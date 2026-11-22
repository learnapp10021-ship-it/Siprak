import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { produce } from 'immer'
import { buildSeed } from './data/seed'
import { makeSel } from './lib/selectors'
import { actions } from './lib/actions'
import { api, apiOn } from './lib/api'
import { diffDb, emptyDb } from './lib/diff'
import { POLL_MS } from './config'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const emptyLine = () => ({ kode: '', qty: '', datang: '', pakai: '' })
export const newLine = emptyLine

export const TABS = {
  User: [['req', 'Request saya'], ['new', 'Buat request']],
  Atasan: [['appr', 'Persetujuan'], ['tim', 'Tim saya']],
  'Admin Dept': [['pool', 'Buat ERO'], ['kon', 'SRL'], ['allr', 'Semua request'], ['usr', 'Pengguna']],
  'Admin Warehouse': [['dtg', 'Kedatangan'], ['srh', 'Serah terima'], ['mst', 'Master item'], ['usr', 'Pengguna']],
  'Spv Warehouse': [['dash', 'Dashboard']],
}

const initialUi = {
  me: 'andi.prod', tab: 'req', draft: [emptyLine()],
  menu: false, eu: null, self: false, help: false, dpic: null, di: null,
  uq: '', ud: '', q: '', sf: '', df: '', dp: 'w0',
}

// Cache lokal: aplikasi langsung tampil dari data terakhir, lalu disegarkan dari server di belakang layar.
const CACHE_KEY = 'siprak.cache.v1'
const readCache = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY))
    return c?.db?.U ? c : null
  } catch {
    return null
  }
}
const writeCache = (db, ver) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ db, ver }))
  } catch {
    /* kuota penuh / mode privat: abaikan */
  }
}

export function AppProvider({ children, initialUi: init }) {
  // Mode demo (tanpa API): data contoh. Mode server: dari cache lokal bila ada, kalau tidak kosong dulu.
  const boot = useRef(null)
  if (!boot.current) {
    const c = apiOn ? readCache() : null
    boot.current = apiOn ? { db: c?.db || emptyDb(), ver: c?.ver || null, ready: !!c } : { db: buildSeed(), ver: null, ready: true }
  }
  const [db, setDb] = useState(boot.current.db)
  const dbRef = useRef(db)
  const verRef = useRef(boot.current.ver)
  const [ready, setReady] = useState(boot.current.ready)
  const [sync, setSync] = useState({ pending: 0, err: '' })
  const [ui, setUiState] = useState({ ...initialUi, ...init })
  const [toastS, setToastS] = useState({ text: '', bad: false, show: false })
  const timer = useRef()

  const setUi = useCallback(p => setUiState(s => ({ ...s, ...(typeof p == 'function' ? p(s) : p) })), [])

  const toast = useCallback((text, bad = false) => {
    clearTimeout(timer.current)
    setToastS({ text, bad, show: true })
    timer.current = setTimeout(() => setToastS(t => ({ ...t, show: false })), bad ? 4500 : 2600)
  }, [])

  const sel = useMemo(() => makeSel(db), [db])

  // Pengguna aktif: bila id awal tidak ada di data (mis. data dari spreadsheet), pakai pengguna pertama.
  const meId = sel.user(ui.me) ? ui.me : db.U[0]?.id
  const me = sel.user(meId)
  const uiEff = useMemo(() => (meId === ui.me ? ui : { ...ui, me: meId }), [ui, meId])

  /* ------------------------------------------------------------ sinkronisasi */

  const pendingRef = useRef(0)
  const staleRef = useRef(false)
  const queue = useRef(Promise.resolve())
  const setPending = n => {
    pendingRef.current = n
    setSync(s => ({ ...s, pending: n }))
  }

  const apply = useCallback((next, ver) => {
    dbRef.current = next
    verRef.current = ver
    setDb(next)
    setReady(true)
  }, [])

  const reload = useCallback(async () => {
    try {
      const r = await api.all(verRef.current)
      if (!r.same && pendingRef.current === 0) apply(r.db, r.ver)
      else if (r.same) verRef.current = r.ver
      setSync(s => ({ ...s, err: '' }))
    } catch (e) {
      setSync(s => ({ ...s, err: e.message }))
      // Tanpa cache sama sekali: tetap tampilkan layar (kosong) agar pesan galat terbaca
      setReady(true)
    }
  }, [apply])

  // Muat awal + polling ringan (hanya cek nomor versi) + cek ulang saat tab kembali aktif
  useEffect(() => {
    if (!apiOn) return
    reload()
    const check = async () => {
      if (document.visibilityState !== 'visible' || pendingRef.current) return
      try {
        const v = await api.ver()
        if (v !== verRef.current) await reload()
        else setSync(s => (s.err ? { ...s, err: '' } : s))
      } catch (e) {
        setSync(s => ({ ...s, err: e.message }))
      }
    }
    const iv = setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', check)
    }
  }, [reload])

  // Simpan snapshot ke cache lokal setiap data berubah
  useEffect(() => {
    if (apiOn && ready && db.U.length) writeCache(db, verRef.current)
  }, [db, ready])

  // Kirim perubahan berurutan (satu per satu) agar urutan add/set di sheet terjaga
  const save = useCallback(
    ops => {
      setPending(pendingRef.current + 1)
      queue.current = queue.current
        .then(() => api.mutate(ops))
        .then(r => {
          // Bila ada penulis lain di antara versi kita dan versi sebelum tulisan ini, data lokal perlu disegarkan
          if (r.base !== verRef.current) staleRef.current = true
          verRef.current = r.ver
          setSync(s => ({ ...s, err: '' }))
        })
        .catch(e => {
          staleRef.current = true
          toast(e.conflict ? e.message + ' Data dimuat ulang, silakan ulangi.' : 'Gagal menyimpan: ' + e.message, true)
          setSync(s => ({ ...s, err: e.conflict ? '' : e.message }))
        })
        .finally(() => {
          setPending(pendingRef.current - 1)
          if (pendingRef.current === 0 && staleRef.current) {
            staleRef.current = false
            verRef.current = null // paksa ambil data penuh
            reload()
          }
        })
    },
    [reload, toast]
  )

  // Jalankan aksi atas draft immer. Mengembalikan true jika berhasil.
  const act = useCallback(
    (name, ...args) => {
      let res
      const prev = dbRef.current
      const next = produce(prev, d => {
        res = actions[name](makeSel(d), d, ...args)
      })
      if (res?.err) {
        toast(res.err, true)
        return false
      }
      dbRef.current = next
      setDb(next)
      if (apiOn) {
        const ops = diffDb(prev, next)
        if (ops.length) save(ops)
      }
      if (res?.ok) toast(res.ok)
      return true
    },
    [toast, save]
  )

  // Layar penuh hanya saat benar-benar belum ada data untuk ditampilkan
  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', font: '14px system-ui', color: '#5F6368' }}>
        Memuat data…
      </div>
    )
  }
  if (!me) {
    return (
      <div style={{ padding: 24, font: '14px/1.6 system-ui', color: '#202124', maxWidth: 480, margin: '0 auto' }}>
        <b>Belum ada data pengguna.</b>
        <p>
          {sync.err
            ? 'Gagal terhubung ke server: ' + sync.err
            : 'Spreadsheet masih kosong. Jalankan seedDemo() di Apps Script, atau isi sheet Users.'}
        </p>
        <button onClick={() => { setReady(false); verRef.current = null; reload() }}>Coba lagi</button>
      </div>
    )
  }

  const value = { db, sel, ui: uiEff, setUi, me, act, toast, toastS, sync }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
