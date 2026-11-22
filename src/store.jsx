import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { produce } from 'immer'
import { buildSeed } from './data/seed'
import { makeSel } from './lib/selectors'
import { actions } from './lib/actions'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const emptyLine = () => ({ kode: '', qty: '', datang: '', pakai: '' })
export const newLine = emptyLine

export const TABS = {
  User: [['req', 'Request saya'], ['new', 'Buat request']],
  Atasan: [['appr', 'Persetujuan'], ['tim', 'Tim saya']],
  'Admin Dept': [['pool', 'Buat ERO'], ['kon', 'SRL'], ['allr', 'Semua request'], ['usr', 'Pengguna']],
  'Admin Warehouse': [['dtg', 'Kedatangan'], ['srh', 'Serah terima'], ['usr', 'Pengguna']],
  'Spv Warehouse': [['dash', 'Dashboard']],
}

const initialUi = {
  me: 'andi.prod', tab: 'req', draft: [emptyLine()],
  menu: false, eu: null, self: false, help: false, dpic: null, di: null,
  uq: '', ud: '', q: '', sf: '', df: '', dp: 'w0',
}

export function AppProvider({ children, initialUi: init }) {
  const [db, setDb] = useState(buildSeed)
  const dbRef = useRef(db)
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
  const me = sel.user(ui.me)

  // Jalankan aksi atas draft immer. Mengembalikan true jika berhasil.
  const act = useCallback(
    (name, ...args) => {
      let res
      const next = produce(dbRef.current, d => {
        res = actions[name](makeSel(d), d, ...args)
      })
      if (res?.err) {
        toast(res.err, true)
        return false
      }
      dbRef.current = next
      setDb(next)
      if (res?.ok) toast(res.ok)
      return true
    },
    [toast]
  )

  const value = { db, sel, ui, setUi, me, act, toast, toastS }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
