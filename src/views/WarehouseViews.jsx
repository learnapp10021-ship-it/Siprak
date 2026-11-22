import { Fragment, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, Confirm } from '../components/ui'
import { D, TODAY, days } from '../lib/utils'

function DatangCard({ k }) {
  const { sel, me, act } = useApp()
  const [q, setQ] = useState('')
  const [l, setL] = useState('0')
  const [cat, setCat] = useState('')
  const m = sel.mi(k.kode)
  return (
    <div className="row">
      <div className="between"><b>{m.n}</b><small>{k.id}</small></div>
      <small className="mut">Datang {sel.datang(k)} dari {sel.total(k)} {m.sat}, sisa {sel.sisa(k)}</small>
      <div className="grid">
        <label>Qty datang<input type="number" min="0" step="any" max={sel.sisa(k)} value={q} onChange={e => setQ(e.target.value)} /></label>
        <label>Qty lebih<input type="number" min="0" step="any" value={l} onChange={e => setL(e.target.value)} /></label>
      </div>
      <div className="f"><label>Catatan (wajib jika ada kelebihan)<input value={cat} onChange={e => setCat(e.target.value)} /></label></div>
      <div className="acts">
        <button
          className="btn grow"
          onClick={async () => {
            if (await act('datang', { id: k.id, q: +q, l: +l, cat: cat.trim(), by: me.n })) { setQ(''); setL('0'); setCat('') }
          }}
        >Catat kedatangan</button>
      </div>
    </div>
  )
}

export function VDtg() {
  const { db, sel, me, act } = useApp()
  const l = db.K.filter(k => k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0)
  const g = {}
  l.forEach(k => (g[k.srl] = g[k.srl] || []).push(k))
  return (
    <>
      <Hd t="Kedatangan barang" s="Catat barang yang tiba per nomor SRL." />
      {l.length ? (
        Object.entries(g).map(([n, a]) => {
          const s = sel.SRLof(n)
          return (
            <Fragment key={n}>
              <div className="srl between" style={{ alignItems: 'center' }}>
                <span>{n} <small className="mut">{s?.dept}, estimasi {D(s?.est)}</small></span>
                <Confirm className="btn alt" onConfirm={() => act('datangAll', n, me.n)}>Semua datang sesuai jumlah</Confirm>
              </div>
              {a.map(k => <DatangCard key={k.id} k={k} />)}
            </Fragment>
          )
        })
      ) : (
        <Empty>Semua barang di ERO sudah tiba.</Empty>
      )}
    </>
  )
}

function SerahCard({ i }) {
  const { db, sel, me, act } = useApp()
  const m = sel.mi(i.kode)
  const r = sel.RQ(i.req)
  const b = sel.siap(i)
  const [q, setQ] = useState(String(b))
  const w = days(sel.lastArrival(i.kon) || TODAY)
  const n = sel.reminders(i.id).length
  const hp = db.HP[r.by]
  const first = sel.nm(r.by).split(' ')[0]
  const msg = 'Halo ' + sel.nm(r.by) + ', ' + b + ' ' + m.sat + ' ' + m.n + ' sudah siap diambil di Warehouse.'
  return (
    <div className="row">
      <div className="between"><b>{m.n}</b><span>{b} {m.sat}</span></div>
      <small className="mut">PIC {sel.nm(r.by)}, {sel.user(r.by).dept}, pakai {D(i.pakai)}. Dipesan {i.qty}.</small><br />
      <Pill t={w >= 3 ? 't-warn' : 't-gray'}>Di gudang {w} hari</Pill>{' '}
      {n ? <Pill t="t-info">Diingatkan {n} kali</Pill> : null}
      <div className="acts">
        <input type="number" value={q} min="0" max={b} step="any" onChange={e => setQ(e.target.value)} style={{ width: 90 }} />
        <button className="btn grow" onClick={() => act('serah', i.id, +q)}>Serahkan ke {first}</button>
        {hp && (
          <a
            className="btn alt grow" target="_blank" rel="noopener"
            href={`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`}
            onClick={() => act('ingat', i.id, me.n)}
          >Ingatkan via WA</a>
        )}
      </div>
    </div>
  )
}

export function VSrh() {
  const { db, sel } = useApp()
  const l = db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).sort(sel.ord)
  return (
    <>
      <Hd t="Serah terima" s="Urutan mengikuti kebutuhan paling dekat." />
      {l.length ? l.map(i => <SerahCard key={i.id} i={i} />) : <Empty>Belum ada barang yang siap diserahkan.</Empty>}
    </>
  )
}
