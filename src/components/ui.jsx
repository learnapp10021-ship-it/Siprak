import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { D, today } from '../lib/utils'

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
        <div key={n}><small className="mut">Diambil {s.qty} oleh {sel.nm(s.to)}</small></div>
      ))}
    </div>
  )
}

const TONE = { Draft: 't-gray', 'Menunggu Approval': 't-warn', Disetujui: 't-ok', Ditolak: 't-bad', Dibatalkan: 't-gray' }

// mode: 'own' (milik sendiri), 'appr' (untuk atasan menyetujui), 'tim' (hanya lihat)
export function ReqCard({ r, mode }) {
  const { db, sel, me, act } = useApp()
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
          <button className="btn" onClick={() => act('ajukan', r.id, me.id)}>Ajukan</button>
          <Confirm onConfirm={() => act('batal', r.id, me.id)}>Batalkan</Confirm>
        </div>
      )}
      {mode == 'own' && r.st == 'Menunggu Approval' && (
        <div className="acts"><Confirm onConfirm={() => act('batal', r.id, me.id)}>Batalkan</Confirm></div>
      )}
      {mode == 'appr' && (
        <div className="acts">
          <div className="f grow" style={{ width: '100%' }}>
            <textarea rows="2" value={cat} onChange={e => setCat(e.target.value)} placeholder="Catatan (wajib jika menolak)" />
          </div>
          <button className="btn grow" onClick={() => act('setuju', r.id, me.id)}>Setujui</button>
          <Confirm className="btn bad grow" onConfirm={() => act('tolak', r.id, cat.trim(), me.id)}>Tolak</Confirm>
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

// Pemilih SRL untuk jumlah banyak: cari, filter dept / terlambat, urutkan, daftar bertahap.
// g = { [noSRL]: [item, ...] }. SRL teratas hasil filter otomatis terpilih.
const PAGE = 8
const SORTS = { est: 'Estimasi terdekat', new: 'SRL terbaru', big: 'Barang terbanyak' }

export function useSrlPick(g, sel) {
  const [f, setF] = useState({ pick: '', q: '', dept: '', late: false, sort: 'est', lim: PAGE })
  // ganti pilihan / tampilkan lagi tidak mereset panjang daftar; ubah filter mereset
  const set = p => setF(x => ({ ...x, ...('pick' in p || 'lim' in p ? {} : { lim: PAGE }), ...p }))
  const meta = {}
  Object.keys(g).forEach(no => {
    const r = sel.SRLof(no)
    const names = g[no].map(x => sel.mi(x.kode)?.n || '').join(' ')
    meta[no] = { no, dept: r?.dept || '', est: r?.est || '', n: g[no].length,
      late: !!(r?.est && r.est < today()), hay: (no + ' ' + (r?.dept || '') + ' ' + names).toLowerCase() }
  })
  const depts = [...new Set(Object.values(meta).map(m => m.dept).filter(Boolean))].sort()
  const q = f.q.trim().toLowerCase()
  const cmp = {
    est: (a, b) => ((a.est || '9') < (b.est || '9') ? -1 : (a.est || '9') > (b.est || '9') ? 1 : a.no < b.no ? -1 : 1),
    new: (a, b) => (a.no < b.no ? 1 : -1),
    big: (a, b) => b.n - a.n || (a.no < b.no ? -1 : 1),
  }[f.sort]
  const list = Object.values(meta)
    .filter(m => (!q || m.hay.includes(q)) && (!f.dept || m.dept == f.dept) && (!f.late || m.late))
    .sort(cmp)
  const nos = list.map(m => m.no)
  const cur = nos.includes(f.pick) ? f.pick : nos[0]
  const lateN = Object.values(meta).filter(m => m.late).length
  return { list, nos, cur, shown: cur ? [cur] : [], f, set, depts, lateN, total: Object.keys(g).length }
}

export function SrlPicker({ list, cur, f, set, depts, lateN, total, unit = 'barang' }) {
  if (!total) return null
  const vis = list.slice(0, f.lim)
  const filt = total > 5 // SRL sedikit: cukup daftar saja, tanpa cari & filter
  return (
    <div className="f srlpick" style={{ gridColumn: '1/-1' }}>
      {filt && (
        <>
      <label>Cari SRL
        <input type="search" value={f.q} placeholder="No. SRL, departemen, atau nama barang" onChange={e => set({ q: e.target.value })} />
      </label>
      <div className="grid" style={{ marginTop: 0 }}>
        <label>Departemen
          <select value={f.dept} onChange={e => set({ dept: e.target.value })}>
            <option value="">Semua</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>Urutkan
          <select value={f.sort} onChange={e => set({ sort: e.target.value })}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
        </>
      )}
      <div className="chips" style={{ marginTop: 0, alignItems: 'center' }}>
        {filt && lateN > 0 && (
          <button className={'btn ' + (f.late ? '' : 'alt')} style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => set({ late: !f.late })}>
            Terlambat ({lateN})
          </button>
        )}
        <small className="mut">{list.length == total ? total + ' SRL' : list.length + ' dari ' + total + ' SRL'}</small>
      </div>
      {list.length ? (
        <div role="listbox" aria-label="Daftar SRL">
          {vis.map(m => (
            <button
              key={m.no} role="option" aria-selected={m.no == cur}
              onClick={() => set({ pick: m.no })}
              style={{
                display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, alignItems: 'center', textAlign: 'left',
                font: 'inherit', color: 'var(--ink)', cursor: 'pointer', padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                border: '1px solid ' + (m.no == cur ? 'var(--brand)' : 'var(--line)'),
                background: m.no == cur ? 'var(--soft)' : 'var(--paper)',
              }}
            >
              <span><b>{m.no}</b><br /><small className="mut">{m.dept || '-'}, est. {D(m.est)}</small></span>
              <span style={{ textAlign: 'right' }}>
                {m.late ? <Pill t="t-bad">Terlambat</Pill> : null}<br /><small className="mut">{m.n} {unit}</small>
              </span>
            </button>
          ))}
          {list.length > vis.length && (
            <button className="btn alt" style={{ width: '100%' }} onClick={() => set({ lim: f.lim + PAGE })}>
              Tampilkan {Math.min(PAGE, list.length - vis.length)} lagi ({list.length - vis.length} tersisa)
            </button>
          )}
        </div>
      ) : (
        <div className="empty">Tidak ada SRL yang cocok. Ubah kata kunci atau filter.</div>
      )}
    </div>
  )
}

// Daftar bertahap untuk tabel/daftar panjang. Mengembalikan [baris tampil, tombol "tampilkan lagi"].
export function useMore(list, step = 15) {
  const [n, setN] = useState(step)
  useEffect(() => setN(step), [list.length, step])
  const left = list.length - n
  const btn = left > 0 ? (
    <div style={{ gridColumn: '1/-1', marginTop: 8 }}>
      <button className="btn alt" style={{ width: '100%' }} onClick={() => setN(n + step)}>
        Tampilkan {Math.min(step, left)} lagi ({left} tersisa)
      </button>
    </div>
  ) : null
  return [list.slice(0, n), btn]
}
