import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, Srl, useMore } from '../components/ui'
import { D, TODAY, addDays, avg, days, dayDiff, f1, sum } from '../lib/utils'

const Kpi = ({ l, v, s }) => (
  <div className="kpi"><small className="mut">{l}</small><b>{v}</b>{s ? <small className="mut">{s}</small> : null}</div>
)
const KpiBtn = ({ l, v, s, on, onClick }) => (
  <button className={'kpi kbtn' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on}>
    <small className="mut">{l}</small><b>{v}</b><small className="mut">{s}</small>
  </button>
)
const Th = ({ a }) => <tr>{a.map(x => <th key={x}>{x}</th>)}</tr>
const agePill = w => (w >= 7 ? 't-bad' : w >= 3 ? 't-warn' : 't-gray')
const rowKey = fn => e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fn()
  }
}

export function VDash() {
  const { db, sel, ui, setUi } = useApp()
  const f = ui.df
  const pr = ui.dp
  const [qs, setQs] = useState('')

  const m = useMemo(() => {
    const dayOfWeek = new Date(TODAY + 'T00:00:00Z').getUTCDay()
    const ws = addDays(TODAY, -((dayOfWeek + 6) % 7))
    const ps = pr == 'w1' ? addDays(ws, -7) : pr == 'w4' ? addDays(ws, -21) : ws
    const pe = pr == 'w1' ? addDays(ws, -1) : TODAY
    const inP = d => !!d && d.slice(0, 10) >= ps && d.slice(0, 10) <= pe

    const w = db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0)
      .map(i => {
        const r = sel.RQ(i.req)
        const a = sel.lastArrival(i.kon)
        return { i, m: sel.mi(i.kode), b: sel.siap(i), u: r.by, by: sel.nm(r.by), d: sel.deptOf(i), a, w: days(a || TODAY), rm: sel.reminders(i.id) }
      })
      .sort((x, y) => y.w - x.w)

    const kd = db.KD.filter(d => inP(d.tgl))
    const sr = db.SR.filter(s => inP(s.tgl))
    const rmP = db.RM.filter(x => inP(x.at))
    const pk = db.SR.filter(s => s.tgl)
      .map(s => {
        const it = db.I.find(x => x.id == s.item)
        const a = it && sel.firstArrival(it.kon)
        return a ? { d: sel.deptOf(it), v: dayDiff(a, s.tgl), t: s.tgl } : null
      })
      .filter(x => x && x.v >= 0)
    const pkP = pk.filter(x => inP(x.t))

    const sl = [...new Set(db.K.filter(k => k.srl).map(k => k.srl))].sort().reverse().map(no => {
      const ks = db.K.filter(k => k.srl == no)
      const ids = ks.map(k => k.id)
      const ap = db.I.filter(i => ids.includes(i.kon) && sel.live(i) && i.appr).map(i => i.appr.slice(0, 10)).sort()[0]
      const ds = db.KD.filter(d => ids.includes(d.kon)).map(d => d.tgl).sort()
      const est = sel.SRLof(no)?.est
      const first = ds[0]
      return {
        no, d: ks[0].dept, ap, first, est,
        tot: sum(ks, sel.total), dt: sum(ks, sel.datang),
        open: ks.some(k => sel.sisa(k) > 0),
        lt: ap && first ? dayDiff(ap, first) : null,
        late: !!est && (first ? first > est : est < TODAY),
      }
    })
    const slP = sl.filter(x => inP(x.first))
    return {
      ps, pe, inP, w, kd, sr, rmP, pkP, slP,
      slT: sl.filter(x => inP(x.first) || x.open),
      ot: slP.filter(x => x.est),
      deps: [...new Set(db.U.filter(u => u.dept != 'Warehouse').map(u => u.dept))],
      adm: db.U.filter(u => u.role == 'Admin Warehouse' && !u.off),
    }
  }, [db, sel, pr])

  const { ps, pe, inP, w, kd, sr, rmP, pkP, slP, slT, ot, deps, adm } = m
  const qq = qs.trim().toLowerCase()
  const lw = w
    .filter(x => (f == 'late' ? x.w >= 3 : f == 'none' ? !x.rm.length : true))
    .filter(x => !qq || (x.m.n + ' ' + x.i.id + ' ' + x.by + ' ' + x.d).toLowerCase().includes(qq))
  const pics = Object.values(lw.reduce((o, x) => ((o[x.u] = o[x.u] || []).push(x), o), {}))
    .sort((p, q) => Math.max(...q.map(x => x.w)) - Math.max(...p.map(x => x.w)))
  const [lwV, lwMore] = useMore(lw)
  const [picV, picMore] = useMore(pics)
  const [slV, slMore] = useMore(slT)
  const a0 = w.filter(x => x.w < 3).length
  const a1 = w.filter(x => x.w >= 3 && x.w < 7).length
  const a2 = w.filter(x => x.w >= 7).length
  const pct = n => (w.length ? (n / w.length) * 100 : 0)

  return (
    <>
      <Hd t="Dashboard Warehouse" s="Monitoring untuk OPR mingguan. Pengingat dilakukan Admin Warehouse." />
      <p className="print-only"><b>Periode: {D(ps)} sampai {D(pe)}</b>. Posisi barang per {D(TODAY)}. Dicetak {D(TODAY)}.</p>
      <div className="grid" style={{ gridColumn: '1/-1' }}>
        <label>Periode ({D(ps)} sampai {D(pe)})
          <select value={pr} onChange={e => setUi({ dp: e.target.value })}>
            <option value="w0">Minggu ini</option>
            <option value="w1">Minggu lalu</option>
            <option value="w4">4 minggu terakhir</option>
          </select>
        </label>
        <div style={{ alignSelf: 'end' }}>
          <button className="btn alt" style={{ width: '100%' }} onClick={() => window.print()}>Cetak atau simpan PDF</button>
        </div>
      </div>

      <Srl>Posisi hari ini</Srl>
      <div className="kpis">
        <KpiBtn l="Belum diambil" v={w.length} s="barang di gudang" on={f == ''} onClick={() => setUi({ df: '' })} />
        <KpiBtn l="Menunggu 3 hari atau lebih" v={a1 + a2} s={a2 + ' di antaranya 7 hari atau lebih'} on={f == 'late'} onClick={() => setUi({ df: 'late' })} />
        <KpiBtn l="Belum pernah diingatkan" v={w.filter(x => !x.rm.length).length} s={'dari ' + w.length + ' barang'} on={f == 'none'} onClick={() => setUi({ df: 'none' })} />
        <Kpi l="PIC belum mengambil" v={new Set(w.map(x => x.u)).size} s="orang peminta" />
      </div>
      <div style={{ gridColumn: '1/-1', marginTop: 10 }}>
        <div className="agb" role="img" aria-label={`Aging: ${a0} kurang dari 3 hari, ${a1} 3 sampai 6 hari, ${a2} 7 hari atau lebih`}>
          <i style={{ width: pct(a0) + '%', background: 'var(--gray)' }} />
          <i style={{ width: pct(a1) + '%', background: 'var(--warn)' }} />
          <i style={{ width: pct(a2) + '%', background: 'var(--bad)' }} />
        </div>
        <small className="mut">Lama di gudang: {a0} kurang dari 3 hari, {a1} 3 sampai 6 hari, {a2} 7 hari atau lebih</small>
      </div>

      <Srl>Kinerja periode</Srl>
      <div className="kpis">
        <Kpi l="Barang tiba" v={sum(kd, d => d.qty)} s={kd.length + ' pencatatan'} />
        <Kpi l="Diserahkan" v={sum(sr, s => s.qty)} s={sr.length + ' serah terima'} />
        <Kpi l="Lead time kedatangan" v={f1(avg(slP.map(x => x.lt).filter(v => v != null))) + (slP.length ? ' hari' : '')} s="disetujui sampai datang pertama" />
        <Kpi l="Lead time pengambilan" v={f1(avg(pkP.map(x => x.v))) + (pkP.length ? ' hari' : '')} s="datang sampai diserahkan" />
        <Kpi l="SRL tepat waktu" v={ot.length ? Math.round((ot.filter(x => !x.late).length / ot.length) * 100) + '%' : '-'} s={ot.length ? ot.filter(x => !x.late).length + ' dari ' + ot.length + ' SRL' : 'belum ada SRL datang'} />
        <Kpi l="Pengingat terkirim" v={rmP.length} s="oleh admin warehouse" />
      </div>

      <Srl>Sudah sampai, belum diambil</Srl>
      <div className="grid" style={{ gridColumn: '1/-1' }}>
        <label>Tampilkan
          <select value={f} onChange={e => setUi({ df: e.target.value })}>
            <option value="">Semua</option>
            <option value="late">Menunggu 3 hari atau lebih</option>
            <option value="none">Belum pernah diingatkan</option>
          </select>
        </label>
        <label>Cari
          <input type="search" value={qs} placeholder="Barang, PIC, departemen" onChange={e => setQs(e.target.value)} />
        </label>
      </div>
      <p className="mut" style={{ gridColumn: '1/-1', margin: '0 0 6px' }}>{lw.length} barang. Ketuk kartu di atas untuk menyaring, atau ketuk baris untuk melihat detail barang.</p>
      {lw.length ? (
        <div className="tw" tabIndex={0} role="region" aria-label="Barang yang sudah sampai dan belum diambil">
          <table className="tbl">
            <thead><Th a={['Barang', 'Qty', 'Peminta', 'Datang', 'Di gudang', 'Pengingat', 'Dipakai']} /></thead>
            <tbody>
              {lwV.map(x => {
                const l = x.rm[x.rm.length - 1]
                const open = () => setUi({ di: x.i.id })
                return (
                  <tr key={x.i.id} className="clk" onClick={open} onKeyDown={rowKey(open)} tabIndex={0} role="button">
                    <td>{x.m.n} <small className="mut">{x.i.id}</small></td>
                    <td>{x.b} {x.m.sat}</td>
                    <td>{x.by}<br /><small className="mut">{x.d}</small></td>
                    <td>{D(x.a)}</td>
                    <td><Pill t={agePill(x.w)}>{x.w} hari</Pill></td>
                    <td>
                      {l ? <>{x.rm.length} kali<br /><small className="mut">{D(l.at)}, {sel.nm(l.by)}</small></> : <Pill t={x.w >= 3 ? 't-bad' : 't-gray'}>Belum</Pill>}
                    </td>
                    <td>{x.i.pakai ? D(x.i.pakai) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Tidak ada barang yang cocok. Ubah kata kunci atau filter.</Empty>
      )}
      {lwMore}

      <Srl>PIC yang belum mengambil ({pics.length} orang)</Srl>
      {pics.length ? (
        <div className="tw" tabIndex={0} role="region" aria-label="Barang menunggu per peminta">
          <table className="tbl">
            <thead><Th a={['PIC', 'Barang', 'Isi', 'Terlama', 'Pengingat']} /></thead>
            <tbody>
              {picV.map(a => {
                const x = a[0]
                const mx = Math.max(...a.map(y => y.w))
                const nr = a.filter(y => !y.rm.length && y.w >= 3).length
                const open = () => setUi({ dpic: x.u })
                return (
                  <tr key={x.u} className="clk" onClick={open} onKeyDown={rowKey(open)} tabIndex={0} role="button">
                    <td>{x.by}<br /><small className="mut">{x.d}</small></td>
                    <td>{a.length}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                      {a.slice(0, 2).map(y => y.m.n + ' ' + y.b).join(', ')}{a.length > 2 ? ' +' + (a.length - 2) + ' lainnya' : ''}
                    </td>
                    <td><Pill t={agePill(mx)}>{mx} hari</Pill></td>
                    <td>{sum(a, y => y.rm.length)} kali{nr ? <> <Pill t="t-bad">{nr} belum diingatkan</Pill></> : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Tidak ada PIC yang menunggu.</Empty>
      )}
      {picMore}

      <Srl>Lead time kedatangan per SRL</Srl>
      {slT.length ? (
        <div className="tw" tabIndex={0} role="region" aria-label="Kinerja kedatangan per SRL">
          <table className="tbl">
            <thead><Th a={['SRL', 'Dept', 'Disetujui', 'Datang pertama', 'Lead time', 'Estimasi', 'Status', 'Datang']} /></thead>
            <tbody>
              {slV.map(x => (
                <tr key={x.no}>
                  <td>{x.no}</td><td>{x.d}</td>
                  <td>{x.ap ? D(x.ap) : '-'}</td>
                  <td>{x.first ? D(x.first) : '-'}</td>
                  <td>{x.lt == null ? '-' : x.lt + ' hari'}</td>
                  <td>{x.est ? D(x.est) : '-'}</td>
                  <td>
                    {x.first
                      ? x.late ? <Pill t="t-bad">Telat {dayDiff(x.est, x.first)} hari</Pill> : <Pill t="t-ok">Tepat waktu</Pill>
                      : x.late ? <Pill t="t-bad">Lewat estimasi</Pill> : <Pill t="t-gray">Belum datang</Pill>}
                  </td>
                  <td>{x.dt} dari {x.tot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Tidak ada SRL pada periode ini.</Empty>
      )}
      {slMore}

      <Srl>Per departemen</Srl>
      <div className="tw" tabIndex={0} role="region" aria-label="Ringkasan per departemen">
        <table className="tbl">
          <thead><Th a={['Dept', 'Belum diambil', 'Rata-rata menunggu', 'Pengingat (periode)', 'Lead time pengambilan (periode)']} /></thead>
          <tbody>
            {deps.map(d => {
              const a = w.filter(x => x.d == d)
              const p = pkP.filter(x => x.d == d)
              return (
                <tr key={d}>
                  <td>{d}</td><td>{a.length}</td>
                  <td>{a.length ? f1(avg(a.map(x => x.w))) + ' hari' : '-'}</td>
                  <td>{sum(a, x => x.rm.filter(r => inP(r.at)).length)}</td>
                  <td>{p.length ? f1(avg(p.map(x => x.v))) + ' hari' : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Srl>Aktivitas admin warehouse (periode)</Srl>
      <div className="tw" tabIndex={0} role="region" aria-label="Kinerja admin warehouse">
        <table className="tbl">
          <thead><Th a={['Admin', 'Kedatangan dicatat', 'Pengingat terkirim']} /></thead>
          <tbody>
            {adm.map(u => (
              <tr key={u.id}><td>{u.n}</td><td>{kd.filter(d => d.by == u.id).length}</td><td>{rmP.filter(x => x.by == u.id).length}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
