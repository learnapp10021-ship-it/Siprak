import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { D } from '../lib/utils'

export const Pill = ({ t, children }) => <span className={`pill ${t}`}>{children}</span>
export const Hd = ({ t, s }) => (
  <div className="hd">
    <h2>{t}</h2>
    {s ? <p className="mut">{s}</p> : null}
  </div>
)
export const Empty = ({ children }) => <div className="empty">{children}</div>
export const Srl = ({ children, ...p }) => <div className="srl" {...p}>{children}</div>

// Tombol dua ketukan: ketukan pertama minta konfirmasi, kedua menjalankan.
export function Confirm({ onConfirm, className = 'btn bad', children }) {
  const [armed, setArmed] = useState(false)
  const t = useRef()
  useEffect(() => () => clearTimeout(t.current), [])
  const click = () => {
    if (!armed) {
      setArmed(true)
      t.current = setTimeout(() => setArmed(false), 4000)
      return
    }
    clearTimeout(t.current)
    setArmed(false)
    onConfirm()
  }
  return (
    <button className={className + (armed ? ' cfm' : '')} onClick={click}>
      {armed ? 'Yakin? Ketuk lagi' : children}
    </button>
  )
}

export function ItemCard({ it }) {
  const { sel, db } = useApp()
  const m = sel.mi(it.kode)
  const [g, t, l] = sel.st(it)
  const ss = db.SR.filter(s => s.item == it.id)
  return (
    <div className="item">
      <div className="between"><b>{m.n}</b><span>{it.qty} {m.sat}</span></div>
      <div className={`steps ${t}`} aria-hidden="true">
        {[0, 1, 2, 3, 4].map(n => <i key={n} className={n <= g ? 'on' : ''} />)}
      </div>
      <div className={`lbl ${t}`}>{l}</div>
      <small className="mut">Datang {D(it.datang)}{it.pakai ? ', dipakai ' + D(it.pakai) : ''}</small>
      {ss.map((s, n) => (
        <div key={n}><small className="mut">Diambil {s.qty} oleh {s.to}</small></div>
      ))}
    </div>
  )
}

const TONE = { Draft: 't-gray', 'Menunggu Approval': 't-warn', Disetujui: 't-ok', Ditolak: 't-bad', Dibatalkan: 't-gray' }

// mode: 'own' (milik sendiri), 'appr' (untuk atasan menyetujui), 'tim' (hanya lihat)
export function ReqCard({ r, mode }) {
  const { db, sel, act } = useApp()
  const [cat, setCat] = useState('')
  const its = db.I.filter(i => i.req == r.id)
  return (
    <div className="row">
      <div className="between">
        <div><b>{r.id}</b> <small>{D(r.tgl)}{mode != 'own' ? ', ' + sel.nm(r.by) : ''}</small></div>
        <Pill t={TONE[r.st]}>{r.st}</Pill>
      </div>
      {r.cat ? <small className="mut">Catatan atasan: {r.cat}</small> : null}
      {its.map(i => <ItemCard key={i.id} it={i} />)}
      {mode == 'own' && r.st == 'Draft' && (
        <div className="acts">
          <button className="btn" onClick={() => act('ajukan', r.id)}>Ajukan</button>
          <Confirm onConfirm={() => act('batal', r.id)}>Batalkan</Confirm>
        </div>
      )}
      {mode == 'own' && r.st == 'Menunggu Approval' && (
        <div className="acts"><Confirm onConfirm={() => act('batal', r.id)}>Batalkan</Confirm></div>
      )}
      {mode == 'appr' && (
        <div className="acts">
          <div className="f grow" style={{ width: '100%' }}>
            <textarea rows="2" value={cat} onChange={e => setCat(e.target.value)} placeholder="Catatan (wajib jika menolak)" />
          </div>
          <button className="btn grow" onClick={() => act('setuju', r.id)}>Setujui</button>
          <Confirm className="btn bad grow" onConfirm={() => act('tolak', r.id, cat.trim())}>Tolak</Confirm>
        </div>
      )}
    </div>
  )
}

// Salin ke clipboard dengan fallback execCommand
export function copyText(t, toast) {
  const ok = () => toast('Disalin ke clipboard.')
  const fb = () => {
    const a = document.createElement('textarea')
    a.value = t
    a.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(a)
    a.select()
    try { document.execCommand('copy'); ok() } catch { toast('Gagal menyalin. Salin manual.', true) }
    a.remove()
  }
  try { navigator.clipboard.writeText(t).then(ok, fb) } catch { fb() }
}

// Pemilih SRL: grup = { [noSRL]: [item, ...] }. Default SRL pertama (estimasi terdekat), bisa "Semua SRL".
const ALL = '*'
export function useSrlPick(g, sel) {
  const [pick, setPick] = useState('')
  const nos = Object.keys(g).sort((a, b) => {
    const ea = sel.SRLof(a)?.est || '9'
    const eb = sel.SRLof(b)?.est || '9'
    return ea < eb ? -1 : ea > eb ? 1 : a < b ? -1 : 1
  })
  const cur = pick == ALL ? ALL : g[pick] ? pick : nos[0]
  const shown = cur == ALL ? nos : cur ? [cur] : []
  return { nos, cur, shown, setPick }
}

export function SrlPicker({ g, sel, nos, cur, setPick, unit = 'barang' }) {
  if (!nos.length) return null
  const all = nos.reduce((n, no) => n + g[no].length, 0)
  return (
    <div className="f" style={{ gridColumn: '1/-1' }}>
      <label>Pilih SRL
        <select value={cur} onChange={e => setPick(e.target.value)}>
          {nos.map(no => {
            const s = sel.SRLof(no)
            return <option key={no} value={no}>{no}{s?.dept ? ' · ' + s.dept : ''} · {g[no].length} {unit}</option>
          })}
          {nos.length > 1 && <option value={ALL}>Semua SRL · {all} {unit}</option>}
        </select>
      </label>
    </div>
  )
}
