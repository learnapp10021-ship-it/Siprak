import { useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, useMore } from '../components/ui'
import { cleanMaster, parseMaster } from '../lib/utils'

const NEW = { k: '', n: '', sat: '', buf: '0', kons: '0', lead: '3' }

function ItemSheet({ item, sats, onClose }) {
  const { act } = useApp()
  const nw = !item
  const [f, setF] = useState(item || NEW)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = () => { if (act('saveMaster', { mode: nw ? 'new' : 'edit', f })) onClose() }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-label={nw ? 'Tambah item' : 'Ubah item'}>
        <h2>{nw ? 'Tambah item' : 'Ubah item'}</h2>
        <div className="f">
          <label>Kode item
            <input value={f.k} disabled={!nw} onChange={e => set('k', e.target.value.toUpperCase())} placeholder="Contoh: BRG-204" autoCapitalize="characters" />
          </label>
          <label>Nama item<input value={f.n} onChange={e => set('n', e.target.value)} /></label>
          <div className="grid">
            <label>Satuan
              <input list="sat-dl" value={f.sat} onChange={e => set('sat', e.target.value)} placeholder="Pcs, Box, Kg" />
              <datalist id="sat-dl">{sats.map(s => <option key={s} value={s} />)}</datalist>
            </label>
            <label>Lead time (hari)
              <input type="number" inputMode="numeric" min="0" step="1" value={f.lead} onChange={e => set('lead', e.target.value)} />
            </label>
          </div>
          <label className="chk"><input type="checkbox" checked={f.buf == '1'} onChange={e => set('buf', e.target.checked ? '1' : '0')} />Barang buffer (tanggal pakai opsional)</label>
          <label className="chk"><input type="checkbox" checked={f.kons == '1'} onChange={e => set('kons', e.target.checked ? '1' : '0')} />Barang konsinyasi</label>
        </div>
        <div className="acts">
          <button className="btn grow" onClick={save}>Simpan</button>
          <button className="btn alt" onClick={onClose}>Batal</button>
        </div>
      </section>
    </>
  )
}

function ImportSheet({ onClose }) {
  const { db, act } = useApp()
  const [t, setT] = useState('')
  const rows = parseMaster(t)
  const bad = rows.filter(r => r.err)
  const good = rows.filter(r => !r.err)
  const exist = new Set(db.M.map(m => m.k))
  const ubah = good.filter(r => exist.has(r.k)).length
  const go = () => { if (act('importMaster', rows)) onClose() }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-label="Impor master item">
        <h2>Impor master item</h2>
        <p className="mut" style={{ margin: '0 0 8px' }}>
          Salin dari Excel lalu tempel di bawah. Urutan kolom: <b>Kode, Nama, Satuan, Buffer, Konsinyasi, Lead time (hari)</b>.
          Buffer/Konsinyasi isi 1 atau 0 (boleh Ya/Tidak). Kode yang sudah ada akan diperbarui.
        </p>
        <div className="f">
          <textarea rows="8" value={t} onChange={e => setT(e.target.value)} placeholder={'BRG-204\tBearing 6204\tPcs\t1\t0\t7'} aria-label="Data master item" />
          {rows.length ? (
            <div role="status">
              <Pill t="t-ok">{good.length - ubah} baru</Pill>{' '}
              {ubah ? <Pill t="t-info">{ubah} diperbarui</Pill> : null}{' '}
              {bad.length ? <Pill t="t-bad">{bad.length} bermasalah</Pill> : null}
            </div>
          ) : null}
          {bad.slice(0, 5).map((r, n) => <div key={n} className="hint">{r.k || '(tanpa kode)'}: {r.err}</div>)}
          {bad.length > 5 ? <div className="hint">dan {bad.length - 5} baris lain bermasalah.</div> : null}
        </div>
        <div className="acts">
          <button className="btn grow" disabled={!good.length} onClick={go}>
            {good.length ? `Impor ${good.length} item` : 'Impor'}
          </button>
          <button className="btn alt" onClick={onClose}>Batal</button>
        </div>
      </section>
    </>
  )
}

export function VMst() {
  const { db } = useApp()
  const [q, setQ] = useState('')
  const [sat, setSat] = useState('')
  const [ed, setEd] = useState(null) // null | 'new' | item
  const [imp, setImp] = useState(false)
  const use = {}
  db.I.forEach(i => { use[i.kode] = (use[i.kode] || 0) + 1 })
  const sats = [...new Set(db.M.map(m => m.sat))].sort()
  const key = q.trim().toLowerCase()
  const l = db.M.filter(m => (!sat || m.sat == sat) && (!key || (m.k + ' ' + m.n).toLowerCase().includes(key)))
  const [vis, more] = useMore(l, 20)
  return (
    <>
      <Hd t="Master item" s={db.M.length + ' item. Ketuk untuk mengubah. Kode tidak bisa diubah karena dipakai di request.'} />
      <div className="grid" style={{ gridColumn: '1/-1' }}>
        <label>Cari<input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Kode atau nama barang" /></label>
        <label>Satuan
          <select value={sat} onChange={e => setSat(e.target.value)}>
            <option value="">Semua</option>
            {sats.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="acts" style={{ gridColumn: '1/-1' }}>
        <button className="btn alt" onClick={() => setImp(true)}>Impor dari Excel</button>
      </div>
      {l.length ? vis.map(m => (
        <button key={m.k} className="urow" onClick={() => setEd(m)}>
          <span><b>{m.n}</b><br /><small className="mut">{m.k}, {m.sat}, lead {m.lead} hari</small></span>
          <span>
            <Pill t="t-info">{m.buf == '1' ? 'Buffer' : 'Non buffer'}</Pill>{m.kons == '1' ? <> <Pill t="t-vio">Konsinyasi</Pill></> : null}<br />
            <small className="mut">{use[m.k] ? 'Dipakai di ' + use[m.k] + ' request' : 'Belum dipakai'}</small>
          </span>
        </button>
      )) : <Empty>{db.M.length ? 'Tidak ada item yang cocok.' : 'Master item masih kosong. Tambah satu per satu atau impor dari Excel.'}</Empty>}
      {more}
      <div className="fabw" style={{ gridColumn: '1/-1' }}>
        <button className="btn fab" onClick={() => setEd('new')}>+ Tambah item</button>
      </div>
      {ed && <ItemSheet key={ed == 'new' ? 'new' : ed.k} item={ed == 'new' ? null : ed} sats={sats} onClose={() => setEd(null)} />}
      {imp && <ImportSheet onClose={() => setImp(false)} />}
    </>
  )
}
