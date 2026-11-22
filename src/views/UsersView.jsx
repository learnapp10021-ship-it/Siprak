import { useApp } from '../store'
import { Hd, Pill } from '../components/ui'
import { disp } from '../lib/utils'

export function VUsr() {
  const { db, me, ui, setUi } = useApp()
  const wh = me.role == 'Admin Warehouse'
  const d = wh ? ui.ud : me.dept
  const deps = [...new Set(db.U.map(u => u.dept))]
  const q = ui.uq.toLowerCase()
  const l = db.U.filter(u => (!d || u.dept == d) && (!q || (u.n + u.id).toLowerCase().includes(q)))
  return (
    <>
      <Hd t={wh ? 'Pengguna' : 'Pengguna ' + d} s={l.length + ' pengguna. Ketuk untuk mengubah.'} />
      <div className="grid" style={{ gridColumn: '1/-1' }}>
        <label>Cari<input value={ui.uq} onChange={e => setUi({ uq: e.target.value })} placeholder="Nama atau email" /></label>
        {wh && (
          <label>Departemen
            <select value={d} onChange={e => setUi({ ud: e.target.value })}>
              <option value="">Semua</option>
              {deps.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
      </div>
      {l.map(u => (
        <button key={u.id} className="urow" onClick={() => setUi({ eu: u.id, self: false })}>
          <span><b>{u.n}</b><br /><small className="mut">{u.role}, {u.dept}</small></span>
          <span>
            <Pill t={u.off ? 't-gray' : 't-ok'}>{u.off ? 'Nonaktif' : 'Aktif'}</Pill><br />
            <small className="mut">{db.HP[u.id] ? disp(db.HP[u.id]) : 'Belum ada nomor WA'}</small>
          </span>
        </button>
      ))}
      <div className="fabw" style={{ gridColumn: '1/-1' }}>
        <button className="btn fab" onClick={() => setUi({ eu: 'new', self: false })}>+ Tambah pengguna</button>
      </div>
    </>
  )
}
