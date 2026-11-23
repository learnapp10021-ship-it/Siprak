import { useDeferredValue, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, ReqCard, Confirm, useMore } from '../components/ui'

export function VAppr() {
  const { db, sel, me, act, setUi } = useApp()
  // Paling lama menunggu tampil paling atas
  const l = db.R.filter(r => r.st == 'Menunggu Approval' && me.id == sel.user(r.by)?.boss).sort((a, b) => (a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : a.id < b.id ? -1 : 1))
  const [vis, more] = useMore(l, 12)
  return (
    <>
      <Hd t="Perlu disetujui" s={l.length ? l.length + ' request menunggu keputusan Anda. Yang paling lama di atas.' : 'Tidak ada request yang menunggu keputusan Anda.'} />
      {l.length > 1 && (
        <div className="acts" style={{ gridColumn: '1/-1' }}>
          <Confirm className="btn grow" onConfirm={() => act('setujuAll', me.id, l.map(r => r.id))}>Setujui semua ({l.length})</Confirm>
        </div>
      )}
      {l.length ? vis.map(r => <ReqCard key={r.id} r={r} mode="appr" />) : (
        <Empty>
          Semua request sudah Anda putuskan.<br />
          <button className="lnk" onClick={() => setUi({ tab: 'tim' })}>Lihat request tim</button>
        </Empty>
      )}
      {more}
    </>
  )
}

const STAT = ['Menunggu Approval', 'Disetujui', 'Ditolak', 'Dibatalkan']

export function VTim() {
  const { db, sel, ui } = useApp()
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const qq = useDeferredValue(q).trim().toLowerCase()
  const all = db.R.filter(r => sel.user(r.by)?.boss == ui.me && r.st != 'Draft').sort((a, b) => (b.tgl < a.tgl ? -1 : b.tgl > a.tgl ? 1 : b.id < a.id ? -1 : 1))
  const l = all.filter(
    r => (!st || r.st == st) && (!qq || sel.nm(r.by).toLowerCase().includes(qq) || r.id.toLowerCase().includes(qq) || db.I.some(i => i.req == r.id && sel.mi(i.kode).n.toLowerCase().includes(qq)))
  )
  const [vis, more] = useMore(l, 12)
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
              <option value="">Semua</option>
              {STAT.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      )}
      {l.length ? vis.map(r => <ReqCard key={r.id} r={r} mode="tim" />) : <Empty>{all.length ? 'Tidak ada request yang cocok dengan pencarian.' : 'Belum ada request dari tim Anda. Request yang mereka ajukan akan tampil di sini.'}</Empty>}
      {more}
    </>
  )
}
