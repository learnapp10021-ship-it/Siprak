import { useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, ReqCard, copyText } from '../components/ui'
import { D, TODAY, days, sum } from '../lib/utils'

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
        <div className="acts">
          <input value={a} onChange={e => setA(e.target.value)} placeholder="Alasan menahan" style={{ flex: 1 }} />
          <button className="btn alt" onClick={() => act('tahan', i.id, a.trim())}>Tahan</button>
        </div>
      )}
    </div>
  )
}

export function VPool() {
  const { sel, me, act, toast } = useApp()
  const [no, setNo] = useState('')
  const [est, setEst] = useState('')
  const d = me.dept
  const p = sel.poolAll(d)
  const ready = sel.poolOf(d)
  const g = {}
  p.forEach(i => (g[i.kode] = g[i.kode] || []).push(i))
  const groups = Object.entries(g).sort((x, y) =>
    (x[1].map(i => i.datang).sort()[0] || '9') < (y[1].map(i => i.datang).sort()[0] || '9') ? -1 : 1
  )
  const copyAll = () => {
    const t = {}
    ready.forEach(i => (t[i.kode] = (t[i.kode] || 0) + +i.qty))
    copyText(Object.entries(t).map(([k, q]) => k + '\t' + q).join('\n'), toast)
  }
  return (
    <>
      <Hd t={'Pool ' + d} s="Request disetujui yang belum dibuat di ERO. Paling mendesak di atas." />
      {groups.length > 0 && (
        <div className="row" style={{ gridColumn: '1/-1' }}>
          <b>{new Set(ready.map(i => i.kode)).size} barang dari {new Set(ready.map(i => i.req)).size} request siap dibuat di ERO</b><br />
          <small className="mut">1. Salin daftar, buat SRL di ERO. 2. Simpan nomor SRL di sini. Status barang otomatis menjadi Sudah di ERO.</small>
          <div className="acts"><button className="btn alt grow" onClick={copyAll}>Salin semua (article dan qty)</button></div>
          <div className="grid">
            <label>No. SRL dari ERO<input value={no} onChange={e => setNo(e.target.value)} placeholder="SRL-2611-003" /></label>
            <label>Estimasi datang (opsional)<input type="date" min={TODAY} value={est} onChange={e => setEst(e.target.value)} /></label>
          </div>
          <div className="acts">
            <button
              className="btn grow"
              onClick={() => {
                if (act('simpanSrl', { no: no.trim(), est, me })) { setNo(''); setEst('') }
              }}
            >Simpan SRL</button>
          </div>
        </div>
      )}
      {groups.length ? (
        groups.map(([k, a]) => {
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
                {ok.length} request, total {sum(ok, i => i.qty)} {m.sat}. Datang terawal {D(ok.map(i => i.datang).sort()[0])}, menunggu {wt} hari.
              </small>
              {a.map(i => <HoldRow key={i.id} i={i} m={m} />)}
            </div>
          )
        })
      ) : (
        <Empty>Pool kosong. Request yang disetujui atasan akan muncul di sini.</Empty>
      )}
    </>
  )
}

function KonCard({ k }) {
  const { db, sel, act } = useApp()
  const [alasan, setAlasan] = useState('')
  const m = sel.mi(k.kode)
  const t = sel.total(k)
  const dt = sel.datang(k)
  const s = sel.sisa(k)
  const peminta = db.I.filter(i => i.kon == k.id && sel.live(i))
  return (
    <div className="row">
      <div className="between">
        <div><b>{m.n}</b> <small>{k.id}</small></div>
        <Pill t={k.tahap == 'Konsolidasi' ? 't-vio' : k.tahap == 'Dikeluarkan' ? 't-bad' : 't-ok'}>{k.tahap}</Pill>
      </div>
      <small className="mut">{peminta.length} request, total {t} {m.sat}{k.srl ? ', ' + k.srl : ''}{k.by ? ', dibuat ' + k.by : ''}</small><br />
      <small className="mut">Peminta: {peminta.map(i => sel.nm(sel.RQ(i.req).by).split(' ')[0] + ' ' + i.qty).join(', ')}</small>
      {k.tahap == 'Dikeluarkan' && <div className="lbl t-bad">Dikeluarkan Warehouse: {k.alasan}. Requestnya kembali ke Pool (ditahan).</div>}
      <div className="bar"><b style={{ width: (t ? Math.min(100, (dt / t) * 100) : 0) + '%' }} /></div>
      <small className="mut">
        Datang {dt} dari {t}{k.tutup > 0 ? ', ditutup ' + k.tutup + ' (' + k.alasan + ')' : ''}{s > 0 ? ', sisa ' + s : ''}
      </small>
      {s > 0 && (
        <div className="acts">
          <input value={alasan} onChange={e => setAlasan(e.target.value)} placeholder="Alasan menutup sisa" style={{ flex: 1 }} />
          <button className="btn alt" onClick={() => { if (act('tutup', k.id, alasan.trim())) setAlasan('') }}>Tutup sisa</button>
        </div>
      )}
    </div>
  )
}

export function VKon() {
  const { db, me } = useApp()
  const l = db.K.filter(k => k.dept == me.dept).sort((a, b) => (b.id < a.id ? -1 : 1))
  return (
    <>
      <Hd t={'Konsolidasi ' + me.dept} s="Status tiap SRL dan barang yang sudah datang." />
      {l.length ? l.map(k => <KonCard key={k.id} k={k} />) : <Empty>Belum ada konsolidasi. Mulai dari tab Pool.</Empty>}
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
  return (
    <>
      <Hd t={'Semua request ' + d} s={l.length + ' request ditemukan.'} />
      <div className="grid" style={{ gridColumn: '1/-1' }}>
        <label>Cari nama atau barang<input value={ui.q} onChange={e => setUi({ q: e.target.value })} placeholder="Ketik nama atau barang" /></label>
        <label>Tahap barang
          <select value={f} onChange={e => setUi({ sf: e.target.value })}>
            <option value="">Semua</option>
            {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </label>
      </div>
      {l.length ? l.map(r => <ReqCard key={r.id} r={r} mode="tim" />) : <Empty>Tidak ada request yang cocok dengan filter.</Empty>}
    </>
  )
}

