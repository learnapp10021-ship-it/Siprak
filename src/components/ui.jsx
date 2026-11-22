import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { D, TODAY } from '../lib/utils'

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
          <div className="f" style={{ flex: '1 0 100%' }}>
            <textarea rows="2" value={cat} onChange={e => setCat(e.target.value)} placeholder="Catatan (wajib jika menolak)" aria-label="Catatan untuk pemohon" />
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

// Pemilih SRL untuk jumlah banyak (puluhan SRL): cari, filter dept / terlambat, urutkan, daftar bertahap.
// HP: hanya satu kartu "SRL aktif" + tombol sebelumnya/berikutnya; daftar & pencarian dibuka lewat "Cari / ganti SRL".
// Desktop: daftar selalu tampil di kolom kiri.
// g = { [noSRL]: [item, ...] }. SRL teratas hasil filter otomatis terpilih.
// prog(no) opsional -> { pct, text } untuk bilah progres tiap SRL.
const PAGE = 8
const SORTS = { est: 'Estimasi terdekat', new: 'SRL terbaru', big: 'Barang terbanyak' }

function goDetail() {
  if (typeof window == 'undefined' || window.innerWidth >= 1024) return
  const sm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  requestAnimationFrame(() => document.getElementById('srl-detail')?.scrollIntoView({ block: 'start', behavior: sm }))
}

export function useSrlPick(g, sel, prog) {
  const [f, setF] = useState({ pick: '', q: '', dept: '', late: false, sort: 'est', lim: PAGE, open: false })
  // ganti pilihan / buka-tutup / tampilkan lagi tidak mereset panjang daftar; ubah filter mereset
  const set = p => setF(x => ({ ...x, ...('pick' in p || 'lim' in p || 'open' in p ? {} : { lim: PAGE }), ...p }))
  const meta = {}
  Object.keys(g).forEach(no => {
    const r = sel.SRLof(no)
    const names = g[no].map(x => sel.mi(x.kode)?.n || '').join(' ')
    meta[no] = { no, dept: r?.dept || '', est: r?.est || '', n: g[no].length, p: prog ? prog(no) : null,
      late: !!(r?.est && r.est < TODAY), hay: (no + ' ' + (r?.dept || '') + ' ' + names).toLowerCase() }
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
  const idx = nos.indexOf(cur)
  const lateN = Object.values(meta).filter(m => m.late).length
  const go = no => { set({ pick: no, open: false }); goDetail() }
  const reset = () => set({ q: '', dept: '', late: false })
  const active = !!(q || f.dept || f.late)
  return { list, cur, idx, prev: nos[idx - 1], next: nos[idx + 1], go, f, set, depts, lateN, total: Object.keys(g).length, active, reset }
}

export function SrlPicker({ list, cur, idx, prev, next, go, f, set, depts, lateN, total, active, reset, unit = 'barang' }) {
  if (!total) return null
  const vis = list.slice(0, f.lim)
  const fold = total > 5 // SRL sedikit: cukup daftar saja, tanpa cari, filter, dan lipat
  const c = list.find(m => m.no == cur)
  const hide = fold && !f.open && !!c
  return (
    <div className="f srlpick" style={{ gridColumn: '1/-1' }}>
      {fold && c && (
        <div className="pk-cur">
          <button className="pk-nav" disabled={!prev} onClick={() => go(prev)} aria-label="SRL sebelumnya">‹</button>
          <button className="pk-main" aria-expanded={f.open} onClick={() => set({ open: !f.open })}>
            <small>SRL {idx + 1} dari {list.length}{list.length < total ? ' (terfilter)' : ''}</small>
            <b>{c.no}</b>
            <small>{c.dept || '-'}, est. {D(c.est)}, {c.n} {unit}{c.late ? ', terlambat' : ''}</small>
            <span className="pk-chg">{f.open ? 'Tutup daftar' : 'Cari / ganti SRL'}</span>
          </button>
          <button className="pk-nav" disabled={!next} onClick={() => go(next)} aria-label="SRL berikutnya">›</button>
        </div>
      )}
      <div className={'pk-body' + (hide ? ' pk-hide' : '')}>
        {fold && (
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
          {fold && lateN > 0 && (
            <button className="chip" aria-pressed={f.late} onClick={() => set({ late: !f.late })}>Terlambat ({lateN})</button>
          )}
          <small className="mut">{list.length == total ? total + ' SRL' : list.length + ' dari ' + total + ' SRL'}</small>
          {fold && active && <button className="lnk" style={{ minHeight: 32, padding: '4px 0' }} onClick={reset}>Hapus filter</button>}
        </div>
        {list.length ? (
          <div role="listbox" aria-label="Daftar SRL">
            {vis.map(m => (
              <button key={m.no} role="option" aria-selected={m.no == cur} className={'pk-row' + (m.no == cur ? ' on' : '')} onClick={() => go(m.no)}>
                <span className="pk-l">
                  <b>{m.no}</b>
                  <small className="mut">{m.dept || '-'}, est. {D(m.est)}</small>
                  {m.p ? <span className="pbar" aria-hidden="true"><i style={{ width: m.p.pct + '%' }} /></span> : null}
                </span>
                <span className="pk-r">
                  {m.late ? <Pill t="t-bad">Terlambat</Pill> : null}
                  <small className="mut">{m.n} {unit}</small>
                  {m.p ? <small className="mut">{m.p.text}</small> : null}
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
    </div>
  )
}

// Kepala SRL terpilih (menempel di atas saat menggulir di HP & desktop). children = tombol aksi massal.
export function SrlHead({ no, s, pct, sub, children }) {
  const late = !!(s?.est && s.est < TODAY)
  return (
    <>
      <div className="srlhd" id="srl-detail">
        <div className="srlhd-t">
          <span><b>{no}</b> <small className="mut">{s ? s.dept + ', est. ' + D(s.est) : ''}</small></span>
          {late ? <Pill t="t-bad">Terlambat</Pill> : null}
        </div>
        {pct != null ? <div className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: pct + '%' }} /></div> : null}
        {sub ? <small className="mut">{sub}</small> : null}
      </div>
      {children ? <div className="srlact">{children}</div> : null}
    </>
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
