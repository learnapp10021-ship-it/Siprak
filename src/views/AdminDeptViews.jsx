import { useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, ReqCard, copyText, useMore } from '../components/ui'
import { D, TODAY, days, sum } from '../lib/utils'

function HoldRow({ i, m }) {
  const { sel, act } = useApp()
  const [a, setA] = useState('')
  return (
    <div className="item">
      <div className="between"><span><b className="dsk-b">{sel.nm(sel.RQ(i.req).by)}</b><span className="dsk-x">{sel.nm(sel.RQ(i.req).by)}, </span> {i.qty} {m.sat}</span><small>{i.req}</small></div>
      {i.datang ? <small className="mut dsk">Dibutuhkan {D(i.datang)}{i.datang < TODAY && !i.tahan ? ' (terlewat)' : ''}, disetujui {days(i.appr)} hari lalu</small> : null}
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
  const tot = {}
  ready.forEach(i => (tot[i.kode] = (tot[i.kode] || 0) + +i.qty))
  const held = p.length - ready.length
  const lateN = ready.filter(i => i.datang < TODAY).length
  const oldest = ready.length ? Math.max(...ready.map(i => days(i.appr))) : 0
  return (
    <>
      <Hd t={'Pool ' + d} s="Request disetujui yang belum dibuat di ERO. Paling mendesak di atas." />
      {groups.length > 0 && (
        <div className="pool-kpi dsk" aria-label="Ringkasan pool">
          <div><b>{ready.length}</b><span>Siap dibuat di ERO</span></div>
          <div className={held ? 'w' : ''}><b>{held}</b><span>Ditahan</span></div>
          <div className={lateN ? 'x' : ''}><b>{lateN}</b><span>Tanggal datang terlewat</span></div>
          <div><b>{oldest}<small> hari</small></b><span>Menunggu terlama</span></div>
        </div>
      )}
      {groups.length > 0 && (
        <div className="row eropanel">
          <b>{new Set(ready.map(i => i.kode)).size} barang dari {new Set(ready.map(i => i.req)).size} request siap dibuat di ERO</b><br />
          <small className="mut dsk-x">1. Salin daftar, buat SRL di ERO. 2. Simpan nomor SRL di sini. Admin Warehouse akan memvalidasi barang di SRL itu; yang tidak sesuai bisa dikeluarkan dan kembali ke Pool ini.</small>
          <div className="dsk">
            <div className="stp"><i>1</i><b>Salin daftar barang</b></div>
            {ready.length ? (
              <table className="pool-sum"><tbody>
                {Object.entries(tot).map(([k, q]) => <tr key={k}><td>{sel.mi(k).n}</td><td>{q} {sel.mi(k).sat}</td></tr>)}
              </tbody></table>
            ) : <small className="mut">Belum ada barang siap. Lepas tahan dulu bila perlu.</small>}
          </div>
          <div className="acts"><button className="btn alt grow" onClick={copyAll} disabled={!ready.length}>Salin semua (article dan qty)</button></div>
          <div className="dsk stp"><i>2</i><b>Buat SRL di ERO, lalu isi nomornya</b></div>
          <div className="grid">
            <label>No. SRL dari ERO<input value={no} onChange={e => setNo(e.target.value)} placeholder="SRL-2611-003" /></label>
            <label>Estimasi datang (opsional)<input type="date" min={TODAY} value={est} onChange={e => setEst(e.target.value)} /></label>
          </div>
          <div className="acts">
            <button
              className="btn grow" disabled={!ready.length}
              onClick={async () => {
                // ids = barang yang terlihat siap diproses; server menolak bila daftar sudah berubah
                if (await act('simpanSrl', { no: no.trim(), est, me, ids: ready.map(i => i.id) })) { setNo(''); setEst('') }
              }}
            >Simpan SRL</button>
          </div>
          <small className="mut dsk">Langkah 3: Simpan SRL. Admin Warehouse akan memvalidasi; barang tidak sesuai kembali ke Pool.</small>
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
                {ok.length
                  ? `${ok.length} request siap, total ${sum(ok, i => i.qty)} ${m.sat}. Datang terawal ${D(ok.map(i => i.datang).sort()[0])}, menunggu ${wt} hari.`
                  : `Semua request ditahan (${a.length}). Belum ikut ERO sampai dilepas.`}
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
      <small className="mut">{peminta.length} request, total {t} {m.sat}{k.srl ? ', ' + k.srl : ''}{k.by ? ', dibuat ' + k.by : ''}</small><br />
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
  return (
    <>
      <Hd t={'SRL ' + me.dept} s={all.length ? (l.length == all.length ? all.length : l.length + ' dari ' + all.length) + ' barang di SRL. Yang perlu perhatian di atas.' : 'Status tiap SRL dan barang yang sudah datang.'} />
      {all.length > 4 && (
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
      {l.length ? vis.map(x => <KonCard key={x.k.id} k={x.k} />) : <Empty>{all.length ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada SRL. Mulai dari tab Buat ERO.'}</Empty>}
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
      {l.length ? vis.map(r => <ReqCard key={r.id} r={r} mode="tim" />) : <Empty>Tidak ada request yang cocok dengan filter.</Empty>}
      {more}
    </>
  )
}

