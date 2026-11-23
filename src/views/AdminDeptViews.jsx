import { useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, ReqCard, useMore } from '../components/ui'
import { D, TODAY, days, sum } from '../lib/utils'
import { useMedia } from '../lib/useMedia'

function HoldRow({ i, m }) {
  const { sel, act } = useApp()
  const [a, setA] = useState('')
  return (
    <div className="item">
      <div className="between"><span>{sel.nm(sel.RQ(i.req).by)}, {i.qty} {m.sat}</span><small>{i.req}</small></div>
      {i.tahan ? (
        <>
          <div className="lbl t-warn">Ditahan: {i.alasan}</div>
          <div className="acts"><button className="btn alt" onClick={() => act('lepas', i.id)}>Lepas tahan</button></div>
        </>
      ) : (
        <>
        {i.alasan ? <div className="lbl t-warn">{i.alasan}</div> : null}
        <div className="acts">
          <input value={a} onChange={e => setA(e.target.value)} placeholder="Alasan menahan" style={{ flex: 1 }} />
          <button className="btn alt" onClick={() => act('tahan', i.id, a.trim())}>Tahan</button>
        </div>
        </>
      )}
    </div>
  )
}

function PoolGrid({ p, all, off, flip, setOff, no, setNo, est, setEst, simpan }) {
  const { sel, me, act } = useApp()
  const [fq, setFq] = useState('')
  const [fs, setFs] = useState('')
  const [why, setWhy] = useState('')
  const ready = all.filter(i => !off.includes(i.id))
  const rows = p
    .map(i => ({ i, m: sel.mi(i.kode), who: sel.nm(sel.RQ(i.req).by), w: days(i.appr) }))
    .sort((a, b) => ((a.i.datang || '9') < (b.i.datang || '9') ? -1 : (a.i.datang || '9') > (b.i.datang || '9') ? 1 : a.m.n.localeCompare(b.m.n)))
    .filter(({ i, m, who }) => {
      const st = i.tahan ? 'hold' : i.datang < TODAY ? 'late' : 'ok'
      if (fs && fs != st) return false
      const q = fq.trim().toLowerCase()
      return !q || (m.n + ' ' + who + ' ' + i.req).toLowerCase().includes(q)
    })
  const vis = rows.filter(r => !r.i.tahan)
  const allOn = vis.length > 0 && vis.every(r => !off.includes(r.i.id))
  const tot = {}
  ready.forEach(i => (tot[i.kode] = (tot[i.kode] || 0) + +i.qty))
  const tahan = async () => {
    if (!ready.length) return
    for (const i of ready) if (!(await act('tahan', i.id, why.trim()))) return
    setWhy('')
  }
  const toggleAll = () => setOff(o => (allOn ? [...new Set([...o, ...vis.map(r => r.i.id)])] : o.filter(x => !vis.some(r => r.i.id == x))))
  return (
    <div className="erp">
      <div className="erp-bar">
        <input className="eb-in" value={why} onChange={e => setWhy(e.target.value)} placeholder="Alasan menahan" aria-label="Alasan menahan terpilih" />
        <button className="eb" onClick={tahan} disabled={!ready.length}>Tahan terpilih</button>
        <span className="grow" />
        <span className="erp-cnt">{ready.length} dipilih dari {p.length} request</span>
      </div>
      <div className="erp-grid">
        <table className="egrid">
          <thead>
            <tr>
              <th className="c"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Pilih semua yang tampil" /></th>
              <th>Request</th><th>Peminta</th><th>Barang</th><th className="n">Qty</th><th>Dibutuhkan</th><th className="n">Tunggu</th><th>Status</th><th><span className="sr-only">Aksi</span></th>
            </tr>
            <tr className="flt">
              <th role="presentation" />
              <th colSpan="3"><input value={fq} onChange={e => setFq(e.target.value)} placeholder="Cari request, peminta, barang" aria-label="Cari di pool" /></th>
              <th role="presentation" colSpan="3" />
              <th>
                <select value={fs} onChange={e => setFs(e.target.value)} aria-label="Filter status">
                  <option value="">Semua</option><option value="ok">Siap</option><option value="late">Terlewat</option><option value="hold">Ditahan</option>
                </select>
              </th>
              <th role="presentation" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ i, m, who, w }) => {
              const on = !i.tahan && !off.includes(i.id)
              return (
                <tr key={i.id} className={(i.tahan ? 'held ' : '') + (on ? 'on' : '')}>
                  <td className="c">{i.tahan ? null : <input type="checkbox" checked={on} onChange={() => flip(i.id)} aria-label={'Ikut SRL: ' + who + ', ' + m.n} />}</td>
                  <td>{i.req}</td>
                  <td>{who}</td>
                  <td><b>{m.n}</b><small>{i.kode} · {m.buf == '1' ? 'Buffer' : 'Non buffer'}</small></td>
                  <td className="n">{i.qty} {m.sat}</td>
                  <td className={i.datang < TODAY && !i.tahan ? 'bad' : ''}>{D(i.datang)}</td>
                  <td className="n">{w} hr</td>
                  <td>{i.tahan ? <span className="t-warn">Ditahan: {i.alasan}</span> : i.datang < TODAY ? <span className="t-bad">Terlewat</span> : 'Siap'}</td>
                  <td className="c">{i.tahan ? <button className="eb sm" onClick={() => act('lepas', i.id)}>Lepas</button> : null}</td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan="9" className="none">Tidak ada request yang cocok dengan filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="erp-tab"><span>Detail SRL</span></div>
      <div className="erp-det">
        <div>
          <table className="egrid sm">
            <thead><tr><th>Article</th><th>Barang</th><th className="n">Request</th><th className="n">Total qty</th></tr></thead>
            <tbody>
              {Object.entries(tot).map(([k, q]) => (
                <tr key={k}><td>{k}</td><td>{sel.mi(k).n}</td><td className="n">{ready.filter(i => i.kode == k).length}</td><td className="n"><b>{q}</b> {sel.mi(k).sat}</td></tr>
              ))}
              {!ready.length && <tr><td colSpan="4" className="none">Belum ada request dipilih. Centang request di tabel atas.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="erp-form">
          <small className="mut">1. Centang request, lalu input article dan total qty di kiri ke ERO. 2. Isi nomor SRL dari ERO. 3. Simpan; Admin Warehouse akan memvalidasi.</small>
          <label>No. SRL dari ERO<input value={no} onChange={e => setNo(e.target.value)} placeholder="SRL-2611-003" /></label>
          <label>Estimasi datang (opsional)<input type="date" min={TODAY} value={est} onChange={e => setEst(e.target.value)} />{est ? <small className="mut">{D(est)}</small> : null}</label>
          <button className="btn" disabled={!ready.length} onClick={simpan}>Simpan SRL ({ready.length} request)</button>
        </div>
      </div>
    </div>
  )
}

export function VPool() {
  const { sel, me, act, setUi } = useApp()
  const wide = useMedia('(min-width:1024px)')
  const [off, setOff] = useState([])
  const [done, setDone] = useState(null)
  const [no, setNo] = useState('')
  const [est, setEst] = useState('')
  const d = me.dept
  const p = sel.poolAll(d)
  const all = sel.poolOf(d)
  const ready = all.filter(i => !off.includes(i.id))
  const flip = id => setOff(o => (o.includes(id) ? o.filter(x => x != id) : [...o, id]))
  const g = {}
  p.forEach(i => (g[i.kode] = g[i.kode] || []).push(i))
  const groups = Object.entries(g).sort((x, y) =>
    (x[1].map(i => i.datang).sort()[0] || '9') < (y[1].map(i => i.datang).sort()[0] || '9') ? -1 : 1
  )
  const simpan = async () => {
    // ids = barang yang terlihat siap diproses; server menolak bila daftar sudah berubah
    const n = ready.length, nomor = no.trim()
    if (await act('simpanSrl', { no: nomor, est, me, ids: ready.map(i => i.id) })) { setNo(''); setEst(''); setOff([]); setDone({ no: nomor, n }) }
  }
  return (
    <>
      <Hd t={'Pool ' + d} s="Request disetujui yang belum dibuat di ERO. Paling mendesak di atas." />
      {done && (
        <div className="pool-done" role="status">
          <span><b>{done.no} tersimpan.</b> {done.n} request menunggu validasi Admin Warehouse.</span>
          <span><button className="btn alt" onClick={() => setUi({ tab: 'kon' })}>Lihat di SRL</button> <button className="btn alt" onClick={() => setDone(null)}>Tutup</button></span>
        </div>
      )}
      {groups.length > 0 && wide && <PoolGrid {...{ p, all, off, flip, setOff, no, setNo, est, setEst, simpan }} />}
      {groups.length > 0 && !wide && (
        <div className="row eropanel">
          <b>{new Set(ready.map(i => i.kode)).size} barang dari {new Set(ready.map(i => i.req)).size} request siap dibuat di ERO</b><br />
          <small className="mut">1. Input article dan qty di bawah ke ERO. 2. Simpan nomor SRL di sini. Admin Warehouse akan memvalidasi barang di SRL itu; yang tidak sesuai bisa dikeluarkan dan kembali ke Pool ini.</small>
          <table className="pool-sum">
            <tbody>
              {Object.entries(ready.reduce((t, i) => ((t[i.kode] = (t[i.kode] || 0) + +i.qty), t), {})).map(([k, q]) => (
                <tr key={k}><td><b>{k}</b><small className="mut"> {sel.mi(k).n}</small></td><td>{q} {sel.mi(k).sat}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="grid">
            <label>No. SRL dari ERO<input value={no} onChange={e => setNo(e.target.value)} placeholder="SRL-2611-003" /></label>
            <label>Estimasi datang (opsional)<input type="date" min={TODAY} value={est} onChange={e => setEst(e.target.value)} />{est ? <small className="mut">{D(est)}</small> : null}</label>
          </div>
          <div className="acts"><button className="btn grow" onClick={simpan}>Simpan SRL</button></div>
        </div>
      )}
      {groups.length > 0 && !wide && groups.map(([k, a]) => {
        const m = sel.mi(k)
        const ok = a.filter(i => !i.tahan)
        const late = ok.some(i => i.datang < TODAY)
        const wt = Math.max(...a.map(i => days(i.appr)))
        return (
          <div className="row" key={k}>
            <div className="between">
              <b>{m.n}</b>
              <span>
                {late && <><Pill t="t-bad">Tanggal datang terlewat</Pill>{' '}</>}
                {wt >= 3 && <><Pill t="t-warn">Menunggu {wt} hari</Pill>{' '}</>}
                <Pill t="t-info">{m.buf == '1' ? 'Buffer' : 'Non buffer'}</Pill>
              </span>
            </div>
            <small className="mut">
              {ok.length
                ? `${ok.length} request siap, total ${sum(ok, i => i.qty)} ${m.sat}. Datang terawal ${D(ok.map(i => i.datang).sort()[0])}, menunggu ${wt} hari.`
                : `Semua request ditahan (${a.length}). Belum ikut ERO sampai dilepas.`}
            </small>
            {a.map(i => <HoldRow key={i.id} i={i} m={m} />)}
          </div>
        )
      })}
      {!groups.length && <Empty>Pool kosong. Request yang disetujui atasan akan muncul di sini.</Empty>}
    </>
  )
}

const TH = { 'Validasi Warehouse': ['t-warn', 'Menunggu validasi Warehouse'], Dikeluarkan: ['t-gray', 'Semua barang dikeluarkan'], Konsolidasi: ['t-vio', 'Konsolidasi'] }

function KonCard({ k }) {
  const { db, sel, act } = useApp()
  const [alasan, setAlasan] = useState('')
  const m = sel.mi(k.kode)
  const t = sel.total(k)
  const dt = sel.datang(k)
  const s = sel.sisa(k)
  const peminta = db.I.filter(i => i.kon == k.id && sel.live(i))
  const [tone, tl] = TH[k.tahap] || ['t-ok', k.tahap]
  const jalan = k.tahap == 'Sudah di ERO'
  return (
    <div className="row">
      <div className="between">
        <div><b>{m.n}</b> <small>{k.id}</small></div>
        <Pill t={tone}>{tl}</Pill>
      </div>
      <small className="mut">{peminta.length} request, total {t} {m.sat}{k.srl ? ', ' + k.srl : ''}{k.by ? ', dibuat ' + sel.nm(k.by) : ''}</small><br />
      <small className="mut">Peminta: {peminta.map(i => sel.nm(sel.RQ(i.req).by).split(' ')[0] + ' ' + i.qty).join(', ')}</small>
      {jalan ? (
        <>
          <div className="bar"><b style={{ width: (t ? Math.min(100, (dt / t) * 100) : 0) + '%' }} /></div>
          <small className="mut">
            Datang {dt} dari {t}{k.tutup > 0 ? ', ditutup ' + k.tutup + ' (' + k.alasan + ')' : ''}{s > 0 ? ', sisa ' + s : ''}
          </small>
        </>
      ) : k.tahap == 'Dikeluarkan' ? <small className="mut">Alasan: {k.alasan}</small> : null}
      {jalan && s > 0 && (
        <div className="acts">
          <input value={alasan} onChange={e => setAlasan(e.target.value)} placeholder="Alasan menutup sisa" style={{ flex: 1 }} />
          <button className="btn alt" onClick={async () => { if (await act('tutup', k.id, alasan.trim())) setAlasan('') }}>Tutup sisa</button>
        </div>
      )}
    </div>
  )
}

function KonRow({ k }) {
  const { db, sel, act } = useApp()
  const [open, setOpen] = useState(false)
  const [alasan, setAlasan] = useState('')
  const m = sel.mi(k.kode)
  const t = sel.total(k), dt = sel.datang(k), s = sel.sisa(k)
  const peminta = db.I.filter(i => i.kon == k.id && sel.live(i))
  const [tone, tl] = TH[k.tahap] || ['t-ok', k.tahap]
  const jalan = k.tahap == 'Sudah di ERO'
  return (
    <>
      <tr>
        <td><b>{m.n}</b><small className="mut">{k.id}</small></td>
        <td>{k.srl || '-'}</td>
        <td>{peminta.map(i => sel.nm(sel.RQ(i.req).by).split(' ')[0] + ' ' + i.qty).join(', ')}<small className="mut">{peminta.length} request</small></td>
        <td className="n">{t} {m.sat}</td>
        <td>
          {jalan ? (
            <>
              <div className="bar"><b style={{ width: (t ? Math.min(100, (dt / t) * 100) : 0) + '%' }} /></div>
              <small className="mut">Datang {dt} dari {t}{k.tutup > 0 ? ', ditutup ' + k.tutup : ''}{s > 0 ? ', sisa ' + s : ''}</small>
            </>
          ) : k.tahap == 'Dikeluarkan' ? <small className="mut">Alasan: {k.alasan}</small> : <small className="mut">-</small>}
        </td>
        <td><Pill t={tone}>{tl}</Pill></td>
        <td>{jalan && s > 0 ? <button className="eb sm" onClick={() => setOpen(o => !o)}>{open ? 'Batal' : 'Tutup sisa'}</button> : null}</td>
      </tr>
      {open && (
        <tr className="sub"><td colSpan="7">
          <div className="acts">
            <input value={alasan} onChange={e => setAlasan(e.target.value)} placeholder="Alasan menutup sisa" style={{ flex: 1 }} />
            <button className="btn" onClick={async () => { if (await act('tutup', k.id, alasan.trim())) { setAlasan(''); setOpen(false) } }}>Tutup sisa {s} {m.sat}</button>
          </div>
        </td></tr>
      )}
    </>
  )
}

const KRANK = { val: 0, run: 1, kon: 2, done: 3, out: 4 }
const KLAB = { val: 'Menunggu validasi', run: 'Sedang berjalan', kon: 'Konsolidasi', done: 'Selesai', out: 'Dikeluarkan' }

export function VKon() {
  const { db, sel, me } = useApp()
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const kst = k => (k.tahap == 'Validasi Warehouse' ? 'val' : k.tahap == 'Dikeluarkan' ? 'out' : k.tahap == 'Sudah di ERO' ? (sel.sisa(k) > 0 ? 'run' : 'done') : 'kon')
  const all = db.K.filter(k => k.dept == me.dept)
    .map(k => ({ k, s: kst(k) }))
    .sort((a, b) => KRANK[a.s] - KRANK[b.s] || b.k.id.localeCompare(a.k.id, undefined, { numeric: true }))
  const cnt = {}
  all.forEach(x => (cnt[x.s] = (cnt[x.s] || 0) + 1))
  const qq = q.trim().toLowerCase()
  const l = all.filter(({ k, s }) => {
    if (st && s != st) return false
    if (!qq) return true
    const names = db.I.filter(i => i.kon == k.id).map(i => sel.nm(sel.RQ(i.req).by)).join(' ')
    return (sel.mi(k.kode).n + ' ' + k.id + ' ' + (k.srl || '') + ' ' + names).toLowerCase().includes(qq)
  })
  const [vis, more] = useMore(l, 12)
  const wide = useMedia('(min-width:1024px)')
  return (
    <>
      <Hd t={'SRL ' + me.dept} s={all.length ? (l.length == all.length ? all.length : l.length + ' dari ' + all.length) + ' barang di SRL. Yang perlu perhatian di atas.' : 'Status tiap SRL dan barang yang sudah datang.'} />
      {all.length > 4 && wide && (
        <div className="erp-bar top">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari barang, SRL, atau peminta" aria-label="Cari barang, SRL, atau peminta" />
          <select value={st} onChange={e => setSt(e.target.value)} aria-label="Status">
            <option value="">Semua status ({all.length})</option>
            {Object.keys(KLAB).filter(x => cnt[x]).map(x => <option key={x} value={x}>{KLAB[x]} ({cnt[x]})</option>)}
          </select>
          <span className="grow" /><span className="erp-cnt">{l.length} dari {all.length} barang</span>
        </div>
      )}
      {all.length > 4 && !wide && (
        <div className="grid" style={{ gridColumn: '1/-1' }}>
          <label>Cari barang, SRL, atau peminta
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Ketik untuk mencari" />
          </label>
          <label>Status
            <select value={st} onChange={e => setSt(e.target.value)}>
              <option value="">Semua ({all.length})</option>
              {Object.keys(KLAB).filter(x => cnt[x]).map(x => <option key={x} value={x}>{KLAB[x]} ({cnt[x]})</option>)}
            </select>
          </label>
        </div>
      )}
      {l.length ? (
        wide ? (
          <div className="erp-grid">
            <table className="egrid">
              <thead><tr><th>Barang</th><th>No. SRL</th><th>Peminta</th><th className="n">Total</th><th>Progres datang</th><th>Status</th><th><span className="sr-only">Aksi</span></th></tr></thead>
              <tbody>{vis.map(x => <KonRow key={x.k.id} k={x.k} />)}</tbody>
            </table>
          </div>
        ) : vis.map(x => <KonCard key={x.k.id} k={x.k} />)
      ) : <Empty>{all.length ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada SRL. Mulai dari tab Buat ERO.'}</Empty>}
      {more}
    </>
  )
}

export function VAll() {
  const { db, sel, me, ui, setUi } = useApp()
  const d = me.dept
  const q = ui.q.toLowerCase()
  const f = ui.sf
  const names = ['Diajukan', 'Disetujui', 'Dikonsolidasi', 'Di ERO', 'Barang tiba']
  const l = db.R.filter(
    r =>
      sel.user(r.by)?.dept == d && r.st != 'Draft' &&
      (!q || sel.nm(r.by).toLowerCase().includes(q) || db.I.some(i => i.req == r.id && sel.mi(i.kode).n.toLowerCase().includes(q))) &&
      (!f || db.I.some(i => i.req == r.id && sel.live(i) && sel.st(i)[0] == f))
  ).sort((a, b) => (b.tgl < a.tgl ? -1 : 1))
  const [vis, more] = useMore(l, 12)
  const wide = useMedia('(min-width:1024px)')
  return (
    <>
      <Hd t={'Semua request ' + d} s={l.length + ' request ditemukan.'} />
      {wide ? (
        <div className="erp-bar top">
          <input value={ui.q} onChange={e => setUi({ q: e.target.value })} placeholder="Cari nama atau barang" aria-label="Cari nama atau barang" />
          <select value={f} onChange={e => setUi({ sf: e.target.value })} aria-label="Tahap barang">
            <option value="">Semua tahap</option>
            {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
          <span className="grow" /><span className="erp-cnt">{l.length} request</span>
        </div>
      ) : (
      <div className="grid" style={{ gridColumn: '1/-1' }}>
        <label>Cari nama atau barang<input value={ui.q} onChange={e => setUi({ q: e.target.value })} placeholder="Ketik nama atau barang" /></label>
        <label>Tahap barang
          <select value={f} onChange={e => setUi({ sf: e.target.value })}>
            <option value="">Semua</option>
            {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </label>
      </div>
      )}
      {l.length ? (
        wide ? (
          <div className="erp-grid">
            <table className="egrid">
              <thead><tr><th>Request</th><th>Tanggal</th><th>Peminta</th><th>Barang dan status</th><th>Tahap</th></tr></thead>
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
                    <td><Pill t={{ Draft: 't-gray', 'Menunggu Approval': 't-warn', Disetujui: 't-ok', Ditolak: 't-bad', Dibatalkan: 't-gray' }[r.st]}>{r.st}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : vis.map(r => <ReqCard key={r.id} r={r} mode="tim" />)
      ) : <Empty>Tidak ada request yang cocok dengan filter.</Empty>}
      {more}
    </>
  )
}

