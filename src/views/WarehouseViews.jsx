import { Fragment, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, Confirm, SrlPicker, useSrlPick } from '../components/ui'
import { D, today, days } from '../lib/utils'

function DatangCard({ k }) {
  const { sel, me, act } = useApp()
  const [q, setQ] = useState('')
  const [l, setL] = useState('0')
  const [cat, setCat] = useState('')
  const [open, setOpen] = useState(false)
  const m = sel.mi(k.kode)
  const tot = sel.total(k)
  const dt = sel.datang(k)
  const sisa = sel.sisa(k)
  const pct = tot ? Math.min(100, Math.round((dt / tot) * 100)) : 0
  const lebih = +l > 0
  const over = +q > sisa
  const needCat = lebih && !cat.trim()
  const can = (+q > 0 || lebih) && !over && !needCat
  const submit = () => {
    if (act('datang', { id: k.id, q: +q, l: +l, cat: cat.trim(), by: me.id })) { setQ(''); setL('0'); setCat(''); setOpen(false) }
  }
  return (
    <div className="row">
      <div className="between"><b>{m.n}</b><small>{k.id}</small></div>
      <div className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Progres kedatangan"><i style={{ width: pct + '%' }} /></div>
      <small className="mut">Datang {dt} dari {tot} {m.sat}. Sisa <b>{sisa}</b> {m.sat}.</small>
      <div className="qrow" style={{ marginTop: 10 }}>
        <label>Jumlah datang ({m.sat})
          <input type="number" inputMode="decimal" min="0" step="any" max={sisa} value={q} placeholder="0" onChange={e => setQ(e.target.value)} />
        </label>
        <button className="btn alt" onClick={() => setQ(String(sisa))}>Semua sisa ({sisa})</button>
      </div>
      {over ? <div className="hint" role="alert">Melebihi sisa. Maksimal {sisa} {m.sat}. Kelebihan isi di "Ada kelebihan".</div> : null}
      {open || lebih ? (
        <div className="f">
          <div className="grid" style={{ marginTop: 0 }}>
            <label>Jumlah lebih ({m.sat})<input type="number" inputMode="decimal" min="0" step="any" value={l} onChange={e => setL(e.target.value)} /></label>
          </div>
          <label>Catatan kelebihan (wajib)<input value={cat} onChange={e => setCat(e.target.value)} placeholder="Contoh: supplier kirim lebih" /></label>
          {needCat ? <div className="hint" role="alert">Isi catatan karena ada kelebihan.</div> : null}
        </div>
      ) : (
        <button className="lnk" onClick={() => setOpen(true)}>+ Ada kelebihan barang?</button>
      )}
      <div className="acts">
        <button className="btn grow" disabled={!can} onClick={submit}>
          {+q > 0 ? `Catat ${+q} ${m.sat} datang` : 'Catat kedatangan'}
        </button>
      </div>
    </div>
  )
}

export function VDtg() {
  const { db, sel, me, act } = useApp()
  const l = db.K.filter(k => k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0)
  const g = {}
  l.forEach(k => (g[k.srl] = g[k.srl] || []).push(k))
  const pk = useSrlPick(g, sel)
  return (
    <>
      <Hd t="Kedatangan barang" s="Pilih nomor SRL, lalu catat barang yang tiba." />
      {l.length ? (
        <>
          <SrlPicker g={g} sel={sel} {...pk} />
          {pk.shown.map(n => {
            const a = g[n]
            const s = sel.SRLof(n)
            return (
              <Fragment key={n}>
                <div className="srl between" style={{ alignItems: 'center' }}>
                  <span>{n} <small className="mut">{s?.dept}, estimasi {D(s?.est)}</small></span>
                  <Confirm className="btn alt" onConfirm={() => act('datangAll', n, me.id)}>Semua datang sesuai jumlah</Confirm>
                </div>
                {a.map(k => <DatangCard key={k.id} k={k} />)}
              </Fragment>
            )
          })}
        </>
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
  const w = days(sel.lastArrival(i.kon) || today())
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
      <div className="qrow" style={{ marginTop: 10 }}>
        <label style={{ flex: '0 0 120px' }}>Jumlah ({m.sat})
          <input type="number" inputMode="decimal" value={q} min="0" max={b} step="any" onChange={e => setQ(e.target.value)} />
        </label>
        <button className="btn grow" disabled={!(+q > 0 && +q <= b)} onClick={() => act('serah', i.id, +q, me.id)}>Serahkan ke {first}</button>
      </div>
      {+q > b ? <div className="hint" role="alert">Maksimal {b} {m.sat} yang siap diserahkan.</div> : null}
      <div className="acts">
        {hp && (
          <a
            className="btn alt grow" target="_blank" rel="noopener"
            href={`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`}
            onClick={() => act('ingat', i.id, me.id)}
          >Ingatkan via WA</a>
        )}
      </div>
    </div>
  )
}

export function VSrh() {
  const { db, sel } = useApp()
  const l = db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).sort(sel.ord)
  const g = {}
  l.forEach(i => {
    const no = sel.KN(i.kon)?.srl || '-'
    ;(g[no] = g[no] || []).push(i)
  })
  const pk = useSrlPick(g, sel)
  return (
    <>
      <Hd t="Serah terima" s="Pilih nomor SRL. Urutan mengikuti kebutuhan paling dekat." />
      {l.length ? (
        <>
          <SrlPicker g={g} sel={sel} {...pk} />
          {pk.shown.map(n => {
            const s = sel.SRLof(n)
            return (
              <Fragment key={n}>
                <div className="srl">{n}{s ? <small className="mut"> {s.dept}, estimasi {D(s.est)}</small> : null}</div>
                {g[n].map(i => <SerahCard key={i.id} i={i} />)}
              </Fragment>
            )
          })}
        </>
      ) : (
        <Empty>Belum ada barang yang siap diserahkan.</Empty>
      )}
    </>
  )
}
