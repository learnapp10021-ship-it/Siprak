import { useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, Confirm, SrlPicker, SrlHead, useSrlPick } from '../components/ui'
import { D, TODAY, days, sum } from '../lib/utils'

const BANYAK = 6 // di atas ini, daftar barang dalam satu SRL diberi kolom cari

function ItemSearch({ q, setQ, n }) {
  if (n <= BANYAK) return null
  return (
    <div className="f itemq">
      <label>Cari barang di SRL ini
        <input type="search" value={q} placeholder="Nama barang atau kode" onChange={e => setQ(e.target.value)} />
      </label>
    </div>
  )
}

/* ------------------------------------------------------------------ Kedatangan */

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
      <div className="between"><b>{m.n}</b><Pill t={dt ? 't-info' : 't-gray'}>Sisa {sisa} {m.sat}</Pill></div>
      <div className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Progres kedatangan"><i style={{ width: pct + '%' }} /></div>
      <small className="mut">Datang {dt} dari {tot} {m.sat} ({k.id})</small>
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

function DatangSrl({ no, items }) {
  const { db, sel, me, act } = useApp()
  const [q, setQ] = useState('')
  const key = q.trim().toLowerCase()
  const shown = key ? items.filter(k => (sel.mi(k.kode).n + ' ' + k.kode + ' ' + k.id).toLowerCase().includes(key)) : items
  const p = progDtg(db, sel)(no)
  return (
    <>
      <SrlHead no={no} s={sel.SRLof(no)} pct={p.pct} sub={`${items.length} barang belum lengkap. ${p.text}.`}>
        <Confirm className="btn alt" onConfirm={() => act('datangAll', no, me.id)}>Semua datang sesuai jumlah ({items.length})</Confirm>
      </SrlHead>
      <ItemSearch q={q} setQ={setQ} n={items.length} />
      {shown.map(k => <DatangCard key={k.id} k={k} />)}
      {key && !shown.length ? <Empty>Tidak ada barang yang cocok dengan "{q.trim()}".</Empty> : null}
    </>
  )
}

// progres kedatangan seluruh barang di satu SRL (termasuk yang sudah lengkap)
const progDtg = (db, sel) => no => {
  const ks = db.K.filter(k => k.srl == no && k.tahap == 'Sudah di ERO')
  const t = sum(ks, k => sel.total(k))
  const d = sum(ks, k => sel.datang(k))
  const pct = t ? Math.min(100, Math.round((d / t) * 100)) : 0
  return { pct, text: pct + '% datang' }
}

export function VDtg() {
  const { db, sel } = useApp()
  const l = db.K.filter(k => k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0)
  const g = {}
  l.forEach(k => (g[k.srl] = g[k.srl] || []).push(k))
  const pk = useSrlPick(g, sel, progDtg(db, sel))
  return (
    <>
      <Hd t="Kedatangan barang" s="Pilih nomor SRL, lalu catat barang yang tiba." />
      {l.length ? (
        <>
          <SrlPicker {...pk} />
          {pk.cur ? <DatangSrl key={pk.cur} no={pk.cur} items={g[pk.cur]} /> : null}
        </>
      ) : (
        <Empty>Semua barang di ERO sudah tiba.</Empty>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ Serah terima */

function SerahCard({ i, grouped }) {
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
      <small className="mut">
        {grouped ? '' : 'PIC ' + sel.nm(r.by) + ', ' + sel.user(r.by).dept + ', '}pakai {D(i.pakai)}. Dipesan {i.qty}.
      </small><br />
      <Pill t={w >= 3 ? 't-warn' : 't-gray'}>Di gudang {w} hari</Pill>{' '}
      {n ? <Pill t="t-info">Diingatkan {n} kali</Pill> : null}
      <div className="qrow" style={{ marginTop: 10 }}>
        <label style={{ flex: '0 0 120px' }}>Jumlah ({m.sat})
          <input type="number" inputMode="decimal" value={q} min="0" max={b} step="any" onChange={e => setQ(e.target.value)} />
        </label>
        <button className="btn grow" disabled={!(+q > 0 && +q <= b)} onClick={() => act('serah', i.id, +q)}>Serahkan ke {first}</button>
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

// progres serah terima seluruh barang di satu SRL (yang sudah di ERO)
const progSrh = (db, sel) => no => {
  const its = db.I.filter(i => i.status == 'Sudah di ERO' && sel.KN(i.kon)?.srl == no)
  const t = sum(its, i => i.qty)
  const d = sum(its, i => sel.diambil(i))
  const pct = t ? Math.min(100, Math.round((d / t) * 100)) : 0
  return { pct, text: pct + '% diserahkan' }
}

function SerahSrl({ no, items }) {
  const { db, sel, act } = useApp()
  const [q, setQ] = useState('')
  const key = q.trim().toLowerCase()
  const shown = key
    ? items.filter(i => (sel.mi(i.kode).n + ' ' + i.kode + ' ' + sel.nm(sel.RQ(i.req).by)).toLowerCase().includes(key))
    : items
  // kelompokkan per penerima (PIC); urutan kelompok mengikuti kebutuhan paling dekat
  const grp = new Map()
  shown.forEach(i => {
    const by = sel.RQ(i.req).by
    if (!grp.has(by)) grp.set(by, [])
    grp.get(by).push(i)
  })
  const p = progSrh(db, sel)(no)
  const total = new Set(items.map(i => sel.RQ(i.req).by)).size
  return (
    <>
      <SrlHead no={no} s={sel.SRLof(no)} pct={p.pct} sub={`${items.length} barang siap untuk ${total} penerima. ${p.text}.`} />
      <ItemSearch q={q} setQ={setQ} n={items.length} />
      {[...grp.entries()].map(([by, a]) => (
        <div key={by} style={{ display: 'contents' }}>
          <div className="pic">
            <span><b>{sel.nm(by)}</b> <small className="mut">{sel.user(by).dept}, {a.length} barang</small></span>
            {a.length > 1 && (
              <Confirm className="btn alt" onConfirm={() => act('serahAll', a.map(i => i.id))}>Serahkan semua ({a.length})</Confirm>
            )}
          </div>
          {a.map(i => <SerahCard key={i.id} i={i} grouped />)}
        </div>
      ))}
      {key && !shown.length ? <Empty>Tidak ada barang yang cocok dengan "{q.trim()}".</Empty> : null}
    </>
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
  const pk = useSrlPick(g, sel, progSrh(db, sel))
  return (
    <>
      <Hd t="Serah terima" s="Pilih nomor SRL. Barang dikelompokkan per penerima, kebutuhan terdekat di atas." />
      {l.length ? (
        <>
          <SrlPicker {...pk} />
          {pk.cur ? <SerahSrl key={pk.cur} no={pk.cur} items={g[pk.cur]} /> : null}
        </>
      ) : (
        <Empty>Belum ada barang yang siap diserahkan.</Empty>
      )}
    </>
  )
}
