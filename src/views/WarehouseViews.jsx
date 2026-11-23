import { Fragment, useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, Confirm, SrlPicker, SrlHead, useSrlPick } from '../components/ui'
import { D, TODAY, days, sum } from '../lib/utils'
import { useMedia } from '../lib/useMedia'

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

function DatangCard({ k, first }) {
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
    if (await act('datang', { id: k.id, q: +q, l: +l, cat: cat.trim(), by: me.id })) { setQ(''); setL('0'); setCat(''); setOpen(false) }
  }
  return (
    <div className="row">
      <div className="between"><b>{m.n}</b><Pill t={dt ? 't-info' : 't-gray'}>Sisa {sisa} {m.sat}</Pill></div>
      <div className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Progres kedatangan"><i style={{ width: pct + '%' }} /></div>
      <small className="mut">Datang {dt} dari {tot} {m.sat} ({k.id})</small>
      <div className="qrow" style={{ marginTop: 10 }}>
        <label>Jumlah datang ({m.sat})
          <input type="number" inputMode="decimal" min="0" step="any" max={sisa} value={q} placeholder="0" data-first-input={first ? '' : undefined} onChange={e => setQ(e.target.value)} />
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

const FST = [['', 'Semua'], ['new', 'Belum ada yang datang'], ['part', 'Sebagian datang']]
const EMPTY = { q: '', l: '', cat: '', more: false }

function DatangSrl({ no, items }) {
  const { db, sel, me, act } = useApp()
  const wide = useMedia('(min-width:1024px)')
  const [q, setQ] = useState('')
  const [sf, setSf] = useState('')
  const [ent, setEnt] = useState({}) // isian tabel entri cepat: { [id konsolidasi]: { q, l, cat, more } }
  const tbl = useRef()
  const key = q.trim().toLowerCase()
  const kind = k => (sel.datang(k) > 0 ? 'part' : 'new')
  const nNew = items.filter(k => kind(k) == 'new').length
  const cn = { '': items.length, new: nNew, part: items.length - nNew }
  const shown = items.filter(
    k => (!sf || kind(k) == sf) && (!key || (sel.mi(k.kode).n + ' ' + k.kode + ' ' + k.id).toLowerCase().includes(key))
  )
  const p = progDtg(db, sel)(no)

  const get = id => ent[id] || EMPTY
  const upd = (id, patch) => setEnt(s => ({ ...s, [id]: { ...EMPTY, ...s[id], ...patch } }))
  const evalRow = k => {
    const e = get(k.id), sisa = sel.sisa(k)
    const qn = +e.q || 0, ln = +e.l || 0
    const filled = qn > 0 || ln > 0
    const err = !filled ? '' : qn < 0 || ln < 0 ? 'Tidak boleh negatif.' : qn > sisa ? 'Melebihi sisa (' + sisa + ').' : ln > 0 && !e.cat.trim() ? 'Isi catatan kelebihan.' : ''
    return { e, sisa, qn, ln, filled, err }
  }
  // seluruh barang di SRL ini (bukan hanya yang tampil setelah dicari/disaring) ikut dicatat
  const evs = items.map(k => [k, evalRow(k)])
  const filled = evs.filter(([, r]) => r.filled)
  const bad = filled.filter(([, r]) => r.err).length
  const hidden = filled.filter(([k]) => !shown.includes(k)).length
  const submit = async () => {
    const rows = filled.map(([k, r]) => ({ id: k.id, q: r.qn, l: r.ln, cat: r.e.cat.trim() }))
    if (await act('datangBatch', { rows, by: me.id })) setEnt({})
  }
  const fillAll = () => setEnt(s => {
    const n = { ...s }
    shown.forEach(k => { n[k.id] = { ...EMPTY, ...n[k.id], q: String(sel.sisa(k)) } })
    return n
  })
  // Enter / panah bawah: baris berikutnya; Shift+Enter / panah atas: baris sebelumnya; Enter di baris terakhir: tombol Catat
  const onKey = (e, i) => {
    const go = d => tbl.current?.querySelector(`[data-r="${i + d}"]`)
    if (e.key == 'Enter' || e.key == 'ArrowDown' || e.key == 'ArrowUp') {
      e.preventDefault()
      const up = e.key == 'ArrowUp' || (e.key == 'Enter' && e.shiftKey)
      const t = go(up ? -1 : 1)
      if (t) t.focus()
      else if (!up && e.key == 'Enter') document.getElementById('dtg-submit')?.focus()
    }
  }

  return (
    <>
      <SrlHead no={no} s={sel.SRLof(no)} pct={p.pct} sub={`${items.length} barang belum lengkap. ${p.text}.`}>
        <Confirm className="btn alt" onConfirm={() => act('datangAll', no, me.id)}>Semua datang sesuai jumlah ({items.length})</Confirm>
      </SrlHead>
      <ItemSearch q={q} setQ={setQ} n={items.length} />
      {items.length > BANYAK && (
        <div className="chips fl" role="group" aria-label="Filter barang di SRL ini">
          {FST.filter(([k]) => !k || cn[k] || sf == k).map(([k, lbl]) => (
            <button key={k} className="chip" aria-pressed={sf == k} onClick={() => setSf(k)}>{lbl} ({cn[k]})</button>
          ))}
        </div>
      )}
      {wide ? (
        <>
          <div className="erp-bar top">
            <button className="eb" onClick={fillAll} disabled={!shown.length}>Isi semua yang tampil sesuai sisa ({shown.length})</button>
            <span className="grow" />
            <small className="mut">Ketik jumlah lalu Enter untuk pindah ke baris berikutnya.</small>
          </div>
          <div className="erp-grid" ref={tbl}>
            <table className="egrid">
              <thead>
                <tr><th>Barang</th><th className="n">Total</th><th className="n">Sudah datang</th><th className="n">Sisa</th><th>Datang sekarang</th><th><span className="sr-only">Aksi</span></th></tr>
              </thead>
              <tbody>
                {shown.map((k, i) => {
                  const m = sel.mi(k.kode)
                  const r = evalRow(k)
                  return (
                    <Fragment key={k.id}>
                      <tr className={r.filled ? (r.err ? 'err' : 'on') : ''}>
                        <td><b>{m.n}</b><small>{k.kode} · {k.id}</small></td>
                        <td className="n">{sel.total(k)} {m.sat}</td>
                        <td className="n">{sel.datang(k)}</td>
                        <td className="n"><b>{r.sisa}</b></td>
                        <td>
                          <input
                            className="qin" type="number" inputMode="decimal" min="0" step="any" placeholder="0" value={r.e.q}
                            data-r={i} {...(i == 0 ? { 'data-first-input': '' } : {})} aria-label={'Jumlah datang ' + m.n + ' (' + m.sat + ')'}
                            aria-invalid={r.err ? 'true' : undefined} onChange={e => upd(k.id, { q: e.target.value })} onKeyDown={e => onKey(e, i)}
                          />
                          {r.err ? <small className="bad" role="alert"> {r.err}</small> : null}
                        </td>
                        <td className="c3">
                          <button className="eb sm" onClick={() => upd(k.id, { q: String(r.sisa) })} aria-label={'Isi semua sisa ' + m.n}>Semua sisa</button>{' '}
                          <button className="eb sm" aria-expanded={r.e.more} onClick={() => upd(k.id, { more: !r.e.more })}>{r.e.more ? 'Tutup' : '+ lebih'}</button>
                        </td>
                      </tr>
                      {r.e.more && (
                        <tr className="sub">
                          <td colSpan="6">
                            <div className="acts" style={{ marginTop: 0 }}>
                              <label className="qrow-l">Jumlah lebih ({m.sat})
                                <input className="qin" type="number" inputMode="decimal" min="0" step="any" value={r.e.l} onChange={e => upd(k.id, { l: e.target.value })} />
                              </label>
                              <input style={{ flex: 1 }} value={r.e.cat} placeholder="Catatan kelebihan (wajib), mis. supplier kirim lebih" aria-label={'Catatan kelebihan ' + m.n} onChange={e => upd(k.id, { cat: e.target.value })} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {!shown.length && <tr><td colSpan="6" className="none">Tidak ada barang yang cocok.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="erp-bar dtg-foot" role="status">
            <b>{filled.length} barang terisi</b>
            {hidden > 0 ? <small className="mut">({hidden} tidak tampil karena pencarian atau filter)</small> : null}
            {bad > 0 ? <small className="bad">{bad} isian perlu diperbaiki</small> : null}
            <span className="grow" />
            <button className="eb" disabled={!filled.length} onClick={() => setEnt({})}>Kosongkan isian</button>
            <button id="dtg-submit" className="btn" disabled={!filled.length || bad > 0} onClick={submit}>Catat {filled.length} kedatangan</button>
          </div>
        </>
      ) : (
        shown.map((k, i) => <DatangCard key={k.id} k={k} first={i == 0} />)
      )}
      {(key || sf) && !shown.length && !wide ? <Empty>Tidak ada barang yang cocok dengan pencarian atau filter.</Empty> : null}
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
  const pk = useSrlPick(g, sel, progDtg(db, sel), 'dtg')
  // SRL yang tadi dikerjakan sudah lengkap: beri tahu dan tunjukkan SRL yang kini terbuka
  const [done, setDone] = useState(null)
  const prev = useRef('')
  const nSrl = Object.keys(g).length
  useEffect(() => {
    const p = prev.current
    if (p && p != pk.cur && !g[p]) setDone({ no: p, next: pk.cur || '', left: nSrl })
    prev.current = pk.cur || ''
  }, [pk.cur]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Hd t="Kedatangan barang" s={l.length ? `${nSrl} SRL dengan ${l.length} barang menunggu kedatangan.` : 'Pilih nomor SRL, lalu catat barang yang tiba.'} />
      {done && (
        <div className="pool-done" role="status">
          <span>
            <b>{done.no} selesai.</b>{' '}
            {done.next ? 'Lanjut ke ' + done.next + '.' : done.left ? 'Tidak ada SRL lain yang cocok dengan pencarian atau filter.' : 'Semua barang sudah tiba.'}
          </span>
          <button className="btn alt" onClick={() => setDone(null)}>Tutup</button>
        </div>
      )}
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
  const pk = useSrlPick(g, sel, progSrh(db, sel), 'srh')
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
