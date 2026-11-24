import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, ReqCard, Confirm, useMore } from '../components/ui'
import { useMedia } from '../lib/useMedia'
import { D, days } from '../lib/utils'

const TONE = { Draft: 't-gray', 'Menunggu Approval': 't-warn', Disetujui: 't-ok', Ditolak: 't-bad', Dibatalkan: 't-gray' }
const STAT = ['Menunggu Approval', 'Disetujui', 'Ditolak', 'Dibatalkan']

// Baris barang pada satu request: nama, jumlah, kapan dibutuhkan dan dipakai (bahan keputusan atasan).
function Lines({ r }) {
  const { db, sel } = useApp()
  return db.I.filter(i => i.req == r.id).map(i => {
    const m = sel.mi(i.kode)
    return (
      <div className="it" key={i.id}>
        <span>{m.n} <b>{i.qty} {m.sat}</b></span>
        <small className="mut">butuh datang {D(i.datang)}{i.pakai ? ', dipakai ' + D(i.pakai) : ''}</small>
      </div>
    )
  })
}

/* ------------------------------------------------------------ Persetujuan */

// Desktop: tabel padat, pilih banyak, setujui/tolak massal atau per baris. Catatan penolakan diisi sekali di bilah atas.
function ApprGrid({ l }) {
  const { db, sel, me, act, toast } = useApp()
  const [pick, setPick] = useState([])
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const qq = useDeferredValue(q).trim().toLowerCase()
  // buang pilihan yang requestnya sudah diputuskan
  useEffect(() => { setPick(p => (p.every(id => l.some(r => r.id == id)) ? p : p.filter(id => l.some(r => r.id == id)))) }, [l])
  const rows = useMemo(
    () => l.filter(r => !qq || sel.nm(r.by).toLowerCase().includes(qq) || r.id.toLowerCase().includes(qq) || db.I.some(i => i.req == r.id && sel.mi(i.kode).n.toLowerCase().includes(qq))),
    [l, qq, db, sel]
  )
  const [vis, more] = useMore(rows, 30)
  const shown = vis.map(r => r.id)
  const allOn = shown.length > 0 && shown.every(id => pick.includes(id))
  const toggle = id => setPick(p => (p.includes(id) ? p.filter(x => x != id) : [...p, id]))
  const toggleAll = () => setPick(p => (allOn ? p.filter(id => !shown.includes(id)) : [...new Set([...p, ...shown])]))
  const noteRef = id => document.getElementById(id)
  const tolak = async ids => {
    if (!cat.trim()) {
      toast('Isi catatan penolakan di kolom atas dulu.', true)
      noteRef('appr-note')?.focus()
      return
    }
    for (const id of ids) if (!(await act('tolak', id, cat.trim()))) return
    setCat('')
  }
  return (
    <>
      <div className="erp-bar top">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari peminta, barang, atau nomor" aria-label="Cari request" />
        <span className="grow" /><span className="erp-cnt">{rows.length == l.length ? l.length + ' menunggu' : rows.length + ' dari ' + l.length}</span>
      </div>
      <div className="erp-bar">
        <Confirm className="eb" onConfirm={() => act('setujuAll', me.id, pick).then(ok => ok && setPick([]))}>
          {pick.length ? `Setujui terpilih (${pick.length})` : 'Setujui terpilih'}
        </Confirm>
        <span className="sep" />
        <input id="appr-note" className="eb-in" value={cat} onChange={e => setCat(e.target.value)} placeholder="Catatan penolakan (wajib saat menolak)" aria-label="Catatan penolakan" style={{ minWidth: 280 }} />
        <button className="eb" disabled={!pick.length} onClick={() => tolak(pick)}>Tolak terpilih{pick.length ? ` (${pick.length})` : ''}</button>
        <span className="grow" />
        <span className="erp-cnt">{pick.length} dipilih</span>
      </div>
      <div className="erp-grid" tabIndex={0} role="region" aria-label="Request yang menunggu keputusan">
        <table className="egrid">
          <thead>
            <tr>
              <th className="c"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Pilih semua yang tampil" /></th>
              <th>Request</th><th>Peminta</th><th>Barang, kebutuhan</th><th className="n">Menunggu</th><th><span className="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            {vis.map(r => {
              const w = days(r.tgl)
              return (
                <tr key={r.id} className={pick.includes(r.id) ? 'on' : ''}>
                  <td className="c"><input type="checkbox" checked={pick.includes(r.id)} onChange={() => toggle(r.id)} aria-label={'Pilih ' + r.id} /></td>
                  <td><b>{r.id}</b><br /><small className="mut">{D(r.tgl)}</small></td>
                  <td>{sel.nm(r.by)}</td>
                  <td><Lines r={r} /></td>
                  <td className={'n' + (w >= 3 ? ' bad' : '')}>{w} hr</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right', width: 150 }}>
                    <button className="eb sm" onClick={() => act('setuju', r.id)}>Setujui</button>{' '}
                    <button className="eb sm" onClick={() => tolak([r.id])}>Tolak</button>
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan="6" className="none">Tidak ada request yang cocok dengan pencarian.</td></tr>}
          </tbody>
        </table>
      </div>
      {more}
    </>
  )
}

export function VAppr() {
  const { db, sel, me, act, setUi } = useApp()
  const wide = useMedia('(min-width:1024px)')
  // Paling lama menunggu tampil paling atas
  const l = db.R.filter(r => r.st == 'Menunggu Approval' && me.id == sel.user(r.by)?.boss).sort((a, b) => (a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : a.id < b.id ? -1 : 1))
  const [vis, more] = useMore(l, 12)
  return (
    <>
      <Hd t="Perlu disetujui" s={l.length ? l.length + ' request menunggu keputusan Anda. Yang paling lama di atas.' : 'Tidak ada request yang menunggu keputusan Anda.'} />
      {l.length && wide ? <ApprGrid l={l} /> : null}
      {l.length > 1 && !wide && (
        <div className="acts" style={{ gridColumn: '1/-1' }}>
          <Confirm className="btn grow" onConfirm={() => act('setujuAll', me.id, l.map(r => r.id))}>Setujui semua ({l.length})</Confirm>
        </div>
      )}
      {l.length && !wide ? vis.map(r => <ReqCard key={r.id} r={r} mode="appr" />) : null}
      {!l.length ? (
        <Empty>
          Semua request sudah Anda putuskan.<br />
          <button className="lnk" onClick={() => setUi({ tab: 'tim' })}>Lihat request tim</button>
        </Empty>
      ) : null}
      {!wide ? more : null}
    </>
  )
}

/* ------------------------------------------------------------ Tim saya */

export function VTim() {
  const { db, sel, ui } = useApp()
  const wide = useMedia('(min-width:1024px)')
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const qq = useDeferredValue(q).trim().toLowerCase()
  const all = db.R.filter(r => sel.user(r.by)?.boss == ui.me && r.st != 'Draft').sort((a, b) => (b.tgl < a.tgl ? -1 : b.tgl > a.tgl ? 1 : b.id < a.id ? -1 : 1))
  const cnt = {}
  all.forEach(r => (cnt[r.st] = (cnt[r.st] || 0) + 1))
  const l = all.filter(
    r => (!st || r.st == st) && (!qq || sel.nm(r.by).toLowerCase().includes(qq) || r.id.toLowerCase().includes(qq) || db.I.some(i => i.req == r.id && sel.mi(i.kode).n.toLowerCase().includes(qq)))
  )
  const [vis, more] = useMore(l, wide ? 30 : 12)
  return (
    <>
      <Hd t="Request tim" s={all.length ? (l.length == all.length ? all.length + ' request anggota tim Anda.' : l.length + ' dari ' + all.length + ' request.') : 'Semua request anggota tim Anda.'} />
      {all.length > 0 && (
        <div className="grid" style={{ gridColumn: '1/-1' }}>
          <label>Cari nama, barang, atau nomor
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Ketik untuk mencari" />
          </label>
          <label>Status
            <select value={st} onChange={e => setSt(e.target.value)}>
              <option value="">Semua ({all.length})</option>
              {STAT.filter(s => cnt[s]).map(s => <option key={s} value={s}>{s} ({cnt[s]})</option>)}
            </select>
          </label>
        </div>
      )}
      {l.length ? (
        wide ? (
          <div className="erp-grid" tabIndex={0} role="region" aria-label="Request anggota tim">
            <table className="egrid">
              <thead><tr><th>Request</th><th>Tanggal</th><th>Peminta</th><th>Barang dan status</th><th>Status</th></tr></thead>
              <tbody>
                {vis.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.id}</b></td>
                    <td>{D(r.tgl)}</td>
                    <td>{sel.nm(r.by)}</td>
                    <td>
                      {db.I.filter(i => i.req == r.id).map(i => {
                        const [, tone, lbl] = sel.st(i)
                        return <div className="it" key={i.id}><span>{sel.mi(i.kode).n} <b>{i.qty} {sel.mi(i.kode).sat}</b></span><Pill t={tone}>{lbl}</Pill></div>
                      })}
                    </td>
                    <td><Pill t={TONE[r.st]}>{r.st}</Pill>{r.cat ? <><br /><small className="mut">{r.cat}</small></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : vis.map(r => <ReqCard key={r.id} r={r} mode="tim" />)
      ) : <Empty>{all.length ? 'Tidak ada request yang cocok dengan pencarian.' : 'Belum ada request dari tim Anda. Request yang mereka ajukan akan tampil di sini.'}</Empty>}
      {more}
    </>
  )
}
