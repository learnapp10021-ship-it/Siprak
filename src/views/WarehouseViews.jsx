import { memo, useDeferredValue, useMemo, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, Confirm, SrlPicker, SrlHead, useSrlPick, useMore, fokusJumlah } from '../components/ui'
import { D, TODAY, days, sum } from '../lib/utils'
import { SerahPenerima } from './SerahView'

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

const DatangCard = memo(function DatangCard({ k }) {
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
  const submit = async () => {
    if (await act('datang', { id: k.id, q: +q, l: +l, cat: cat.trim(), by: me.id })) { setQ(''); setL('0'); setCat(''); setOpen(false); fokusJumlah() }
  }
  return (
    <div className="row dtg">
      <div className="between"><b>{m.n}</b><Pill t={dt ? 't-info' : 't-gray'}>Sisa {sisa} {m.sat}</Pill></div>
      <div className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Progres kedatangan"><i style={{ width: pct + '%' }} /></div>
      <small className="mut">Datang {dt} dari {tot} {m.sat} ({k.id})</small>
      <div className="qrow" style={{ marginTop: 10 }}>
        <label>Jumlah datang ({m.sat})
          <input
            type="number" inputMode="decimal" min="0" step="any" max={sisa} value={q} placeholder="0" enterKeyHint="done"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key == 'Enter' && can) { e.preventDefault(); submit() } }}
          />
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
})

function DatangSrl({ no, items, p }) {
  const { sel, me, act } = useApp()
  const [q, setQ] = useState('')
  const [st, setSt] = useState('') // '', 'baru' (belum ada yang datang), 'sebagian'
  const key = useDeferredValue(q).trim().toLowerCase()
  const nBaru = useMemo(() => items.filter(k => !sel.datang(k)).length, [items, sel])
  const shown = useMemo(
    () => items.filter(k => (!st || (st == 'baru' ? !sel.datang(k) : sel.datang(k) > 0)) &&
      (!key || (sel.mi(k.kode).n + ' ' + k.kode + ' ' + k.id).toLowerCase().includes(key))),
    [items, sel, key, st],
  )
  const [vis, more] = useMore(shown, 15)
  return (
    <>
      <SrlHead no={no} s={sel.SRLof(no)} pct={p.pct} sub={`${items.length} barang belum lengkap. ${p.text}.`}>
        <Confirm className="btn alt" onConfirm={() => act('datangAll', no, me.id)}>Semua datang sesuai jumlah ({items.length})</Confirm>
      </SrlHead>
      <ItemSearch q={q} setQ={setQ} n={items.length} />
      {items.length > BANYAK && nBaru > 0 && nBaru < items.length ? (
        <div className="chips" role="group" aria-label="Filter status kedatangan">
          <button className="chip" aria-pressed={st == 'baru'} onClick={() => setSt(st == 'baru' ? '' : 'baru')}>Belum datang ({nBaru})</button>
          <button className="chip" aria-pressed={st == 'sebagian'} onClick={() => setSt(st == 'sebagian' ? '' : 'sebagian')}>Sebagian ({items.length - nBaru})</button>
        </div>
      ) : null}
      {items.length > BANYAK ? <small className="mut" aria-live="polite">{shown.length == items.length ? items.length + ' barang' : shown.length + ' dari ' + items.length + ' barang'}</small> : null}
      {vis.map(k => <DatangCard key={k.id} k={k} />)}
      {more}
      {(key || st) && !shown.length ? <Empty>Tidak ada barang yang cocok.</Empty> : null}
    </>
  )
}

// Kemajuan kedatangan semua SRL sekaligus: satu kali jalan melewati db.K (bukan satu pindaian per SRL).
const progDtgMap = (db, sel) => {
  const m = new Map()
  db.K.forEach(k => {
    if (k.tahap != 'Sudah di ERO') return
    const a = m.get(k.srl) || { t: 0, d: 0 }
    a.t += sel.total(k)
    a.d += sel.datang(k)
    m.set(k.srl, a)
  })
  return no => {
    const a = m.get(no) || { t: 0, d: 0 }
    const pct = a.t ? Math.min(100, Math.round((a.d / a.t) * 100)) : 0
    return { pct, text: pct + '% datang' }
  }
}

export function VDtg() {
  const { db, sel } = useApp()
  // dihitung sekali per perubahan data, bukan setiap mengetik di kolom cari
  const { n, g, prog } = useMemo(() => {
    const g = {}
    let n = 0
    db.K.forEach(k => {
      if (k.tahap != 'Sudah di ERO' || !(sel.sisa(k) > 0)) return
      ;(g[k.srl] = g[k.srl] || []).push(k)
      n++
    })
    return { n, g, prog: progDtgMap(db, sel) }
  }, [db, sel])
  const pk = useSrlPick(g, sel, prog)
  return (
    <>
      <Hd t="Kedatangan barang" s="Pilih nomor SRL, lalu catat barang yang tiba." />
      {n ? (
        <>
          <SrlPicker {...pk} />
          {pk.cur ? <DatangSrl key={pk.cur} no={pk.cur} items={g[pk.cur]} p={prog(pk.cur)} /> : null}
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

// Kemajuan semua SRL sekaligus: satu kali jalan melewati barang (bukan satu pindaian per SRL), untuk ratusan SRL.
const progSrhMap = (db, sel) => {
  const m = new Map()
  db.I.forEach(i => {
    if (i.status != 'Sudah di ERO') return
    const no = sel.KN(i.kon)?.srl
    if (!no) return
    const a = m.get(no) || { t: 0, d: 0 }
    a.t += +i.qty
    a.d += sel.diambil(i)
    m.set(no, a)
  })
  return no => {
    const a = m.get(no) || { t: 0, d: 0 }
    const pct = a.t ? Math.min(100, Math.round((a.d / a.t) * 100)) : 0
    return { pct, text: pct + '% diserahkan' }
  }
}

function SerahSrl({ no, items }) {
  const { db, sel, act } = useApp()
  const [q, setQ] = useState('')
  const key = useDeferredValue(q).trim().toLowerCase()
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

// Mode tampilan Serah terima diingat per perangkat: per penerima (bawaan) atau per SRL.
const MODE_KEY = 'siprak.srhMode'
const readMode = () => {
  try { return localStorage.getItem(MODE_KEY) == 'srl' ? 'srl' : 'org' } catch { return 'org' }
}

export function VSrh() {
  const { db, sel } = useApp()
  const [mode, setMode] = useState(readMode)
  const pilih = m => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* mode privat: abaikan */ }
  }
  const srl = mode == 'srl'
  // dihitung sekali per perubahan data, bukan setiap mengetik di kolom cari
  const { l, g, prog } = useMemo(() => {
    if (!srl) return { l: [], g: {}, prog: null }
    const l = db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0).sort(sel.ord)
    const g = {}
    l.forEach(i => {
      const no = sel.KN(i.kon)?.srl || '-'
      ;(g[no] = g[no] || []).push(i)
    })
    return { l, g, prog: progSrhMap(db, sel) }
  }, [srl, db, sel])
  const pk = useSrlPick(g, sel, prog || undefined)
  return (
    <>
      <Hd t="Serah terima" s={srl ? 'Pilih nomor SRL. Barang dikelompokkan per penerima, kebutuhan terdekat di atas.' : 'Cari penerima, lalu serahkan semua barangnya sekaligus, lintas SRL.'} />
      <div className="sh-modes" role="group" aria-label="Cara menampilkan">
        <button className="chip" aria-pressed={!srl} onClick={() => pilih('org')}>Per penerima</button>
        <button className="chip" aria-pressed={srl} onClick={() => pilih('srl')}>Per SRL</button>
      </div>
      {!srl ? (
        <SerahPenerima />
      ) : l.length ? (
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
