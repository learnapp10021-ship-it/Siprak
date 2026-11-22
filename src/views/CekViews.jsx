import { Fragment, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, Confirm, SrlPicker, useSrlPick, useMore } from '../components/ui'
import { D } from '../lib/utils'

const ALASAN = ['Stok supplier kosong', 'Item discontinued', 'Spesifikasi tidak sesuai', 'Belum ada vendor/harga']
const tgl = at => (at ? D(at.slice(0, 10)) + (at.length > 10 ? ' ' + at.slice(11, 16) : '') : '-')

/* ------------------------------------------------------------------ Cek SRL */

function CekCard({ k }) {
  const { db, sel, me, act } = useApp()
  const [a, setA] = useState('')
  const m = sel.mi(k.kode)
  const dt = sel.datang(k)
  const its = db.I.filter(i => i.kon == k.id && sel.live(i))
  return (
    <div className="row">
      <div className="between"><b>{m.n}</b><small>{k.id}</small></div>
      <small className="mut">{its.length} request, total {sel.total(k)} {m.sat}</small><br />
      <small className="mut">Peminta: {its.map(i => sel.nm(sel.RQ(i.req).by).split(' ')[0] + ' ' + i.qty).join(', ')}</small>
      {dt > 0 ? (
        <div className="lbl t-info" style={{ marginTop: 8 }}>Sudah ada yang datang ({dt} {m.sat}), tidak bisa dikeluarkan. Sisanya bisa ditutup oleh Admin Dept.</div>
      ) : (
        <div className="f">
          <label>Tidak bisa diorder? Isi alasan
            <input value={a} onChange={e => setA(e.target.value)} placeholder="Contoh: stok supplier kosong" />
          </label>
          <div className="chips" style={{ marginTop: 0 }}>
            {ALASAN.map(x => (
              <button key={x} className="btn alt" style={{ minHeight: 40, padding: '4px 10px', fontSize: 13 }} onClick={() => setA(x)}>{x}</button>
            ))}
          </div>
          <Confirm onConfirm={() => { if (act('keluarkan', { kon: k.id, alasan: a.trim(), by: me.n })) setA('') }}>Keluarkan dari SRL</Confirm>
        </div>
      )}
    </div>
  )
}

function CekList() {
  const { db, sel, me, act } = useApp()
  const l = db.K.filter(k => k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0)
  const g = {}
  l.forEach(k => (g[k.srl] = g[k.srl] || []).push(k))
  const pk = useSrlPick(g, sel, no => (sel.needCek(no) ? 0 : 1))
  const tag = no => (sel.needCek(no) ? <><Pill t="t-warn">Belum dicek</Pill>{' '}</> : null)
  if (!l.length) return <Empty>Belum ada SRL aktif. SRL baru dari Admin Dept akan muncul di sini untuk dicek.</Empty>
  return (
    <>
      <SrlPicker g={g} sel={sel} {...pk} tag={tag} />
      {pk.shown.map(no => {
        const s = sel.SRLof(no)
        const need = sel.needCek(no)
        return (
          <Fragment key={no}>
            <div className="srl between" style={{ alignItems: 'center' }}>
              <span>
                {no} <small className="mut">{s?.dept}, estimasi {D(s?.est)}</small><br />
                {need ? <Pill t="t-warn">Belum dicek</Pill> : s?.cek == 'Y' ? <small className="mut">Dicek {s.cekby}, {tgl(s.cekat)}</small> : null}
              </span>
              {need && <button className="btn" onClick={() => act('cekSrl', no, me.n)}>Selesai dicek</button>}
            </div>
            {/* yang masih bisa dikeluarkan (belum ada kedatangan) tampil lebih dulu */}
            {g[no].slice().sort((a, b) => (sel.datang(a) > 0) - (sel.datang(b) > 0)).map(k => <CekCard key={k.id} k={k} />)}
          </Fragment>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ Riwayat */

function RiwayatCard({ h }) {
  const { db, sel, me, act } = useApp()
  const m = sel.mi(h.kode)
  const k = sel.KN(h.kon)
  const its = (h.item || '').split(',').map(id => db.I.find(i => i.id == id)).filter(Boolean)
  const held = its.filter(i => sel.live(i) && i.tahan == 'Y' && !i.kon).length
  const wait = its.filter(i => sel.live(i) && i.tahan != 'Y' && !i.kon).length
  const redo = its.filter(i => sel.live(i) && i.kon).length
  const gone = its.filter(i => !sel.live(i)).length
  const rm = sel.hOf(h.kon).filter(x => x.jenis == 'Diingatkan')
  const ad = db.U.find(u => u.role == 'Admin Dept' && u.dept == k?.dept && !u.off)
  const hp = ad && db.HP[ad.id]
  const msg = `Halo ${ad?.n}, ${m.n} (${h.qty} ${m.sat}) dikeluarkan dari ${h.srl} karena: ${h.alasan}. Mohon ditindaklanjuti di menu Buat ERO (bagian ditahan).`
  const tone = held ? 't-warn' : wait ? 't-info' : redo ? 't-ok' : 't-gray'
  const label = held ? 'Masih ditahan' : wait ? 'Menunggu ERO ulang' : redo ? 'Sudah diproses ulang' : 'Dibatalkan'
  return (
    <div className="row">
      <div className="between"><b>{m.n}</b><Pill t={tone}>{label}</Pill></div>
      <small className="mut">{h.srl}, {h.qty} {m.sat}, dikeluarkan {h.by}, {tgl(h.at)}</small>
      <div className="lbl t-bad" style={{ marginTop: 6 }}>Alasan: {h.alasan}</div>
      <small className="mut">
        Tindak lanjut Admin {k?.dept || ''}: {[held && held + ' ditahan', wait && wait + ' menunggu ERO ulang', redo && redo + ' sudah ERO ulang', gone && gone + ' dibatalkan'].filter(Boolean).join(', ') || '-'}
      </small>
      {rm.length ? (
        <div>{rm.map((x, n) => <small key={n} className="mut" style={{ display: 'block' }}>Diingatkan {x.by}, {tgl(x.at)}</small>)}</div>
      ) : null}
      {held > 0 && (
        <div className="acts">
          {hp ? (
            <a className="btn alt grow" target="_blank" rel="noopener" href={`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`}
              onClick={() => act('ingatKeluar', { kon: h.kon, by: me.n })}>Ingatkan {ad.n.split(' ')[0]} via WA</a>
          ) : (
            <small className="mut">Admin Dept belum punya nomor WhatsApp.</small>
          )}
        </div>
      )}
    </div>
  )
}

function Riwayat() {
  const { db, sel } = useApp()
  const [q, setQ] = useState('')
  const qq = q.trim().toLowerCase()
  const all = (db.H || []).filter(h => h.jenis == 'Dikeluarkan').slice().reverse()
  const rows = all.filter(h => !qq || (h.srl + ' ' + (sel.mi(h.kode)?.n || '') + ' ' + h.alasan + ' ' + h.by).toLowerCase().includes(qq))
  const [vis, more] = useMore(rows, 10)
  return (
    <>
      <div className="f" style={{ gridColumn: '1/-1' }}>
        <label>Cari riwayat
          <input type="search" value={q} placeholder="SRL, barang, alasan" onChange={e => setQ(e.target.value)} />
        </label>
        <small className="mut">{rows.length == all.length ? all.length + ' barang dikeluarkan' : rows.length + ' dari ' + all.length}</small>
      </div>
      {rows.length ? vis.map((h, n) => <RiwayatCard key={h.kon + n} h={h} />) : <Empty>{all.length ? 'Tidak ada yang cocok.' : 'Belum ada barang yang dikeluarkan dari SRL.'}</Empty>}
      {more}
    </>
  )
}

export function VCek() {
  const { db, sel } = useApp()
  const [seg, setSeg] = useState('cek')
  const open = [...new Set(db.K.filter(k => k.tahap == 'Sudah di ERO' && sel.sisa(k) > 0).map(k => k.srl))]
  const belum = open.filter(sel.needCek).length
  const out = (db.H || []).filter(h => h.jenis == 'Dikeluarkan').length
  return (
    <>
      <Hd t="Cek SRL" s="Saring barang di SRL. Keluarkan yang tidak bisa diorder, riwayatnya tercatat." />
      <div className="chips" style={{ marginTop: 0 }}>
        <button className={'btn ' + (seg == 'cek' ? '' : 'alt')} onClick={() => setSeg('cek')} aria-pressed={seg == 'cek'}>Perlu dicek{belum ? ` (${belum})` : ''}</button>
        <button className={'btn ' + (seg == 'his' ? '' : 'alt')} onClick={() => setSeg('his')} aria-pressed={seg == 'his'}>Riwayat dikeluarkan{out ? ` (${out})` : ''}</button>
      </div>
      {seg == 'cek' ? <CekList /> : <Riwayat />}
    </>
  )
}

/* ------------------------------------------------------------------ Master item */

function MasterForm({ m, onDone }) {
  const { db, act } = useApp()
  const edit = !!m
  const [f, setF] = useState({ k: m?.k || '', n: m?.n || '', sat: m?.sat || '', lead: m?.lead ?? '3', buf: m?.buf == '1', kons: m?.kons == '1' })
  const set = p => setF(x => ({ ...x, ...p }))
  const sats = [...new Set(db.M.map(x => x.sat))].sort()
  return (
    <div className="f">
      <div className="grid" style={{ marginTop: 0 }}>
        <label>Kode barang
          <input value={f.k} disabled={edit} onChange={e => set({ k: e.target.value })} placeholder="mis. BRG-207" autoCapitalize="characters" />
        </label>
        <label>Satuan
          <input list="sat-list" value={f.sat} onChange={e => set({ sat: e.target.value })} placeholder="Pcs, Box, Kg" />
        </label>
      </div>
      <datalist id="sat-list">{sats.map(s => <option key={s} value={s} />)}</datalist>
      <label>Nama barang<input value={f.n} onChange={e => set({ n: e.target.value })} /></label>
      <label>Paling cepat datang (hari)
        <input type="number" inputMode="numeric" min="0" value={f.lead} onChange={e => set({ lead: e.target.value })} />
      </label>
      <label className="chk"><input type="checkbox" checked={f.buf} onChange={e => set({ buf: e.target.checked })} /> Barang buffer (tanggal pakai opsional)</label>
      <label className="chk"><input type="checkbox" checked={f.kons} onChange={e => set({ kons: e.target.checked })} /> Konsinyasi</label>
      <div className="acts">
        <button className="btn grow" onClick={() => { if (act('simpanMaster', { mode: edit ? 'edit' : 'new', ...f })) onDone() }}>
          {edit ? 'Simpan perubahan' : 'Tambah barang'}
        </button>
        <button className="btn alt" onClick={onDone}>Batal</button>
      </div>
    </div>
  )
}

function MasterRow({ m, editing, setEditing }) {
  const { db, act } = useApp()
  const used = db.I.filter(i => i.kode == m.k).length
  const off = m.off == 'Y'
  return (
    <div className="row">
      <div className="between"><b>{m.n}</b>{off ? <Pill t="t-gray">Nonaktif</Pill> : null}</div>
      <small className="mut">{m.k}, satuan {m.sat}, paling cepat datang {m.lead} hari. Dipakai di {used} request.</small>
      <div className="chips">
        <Pill t="t-info">{m.buf == '1' ? 'Buffer' : 'Non buffer'}</Pill>
        <Pill t="t-vio">{m.kons == '1' ? 'Konsinyasi' : 'Non konsinyasi'}</Pill>
      </div>
      {editing ? (
        <MasterForm m={m} onDone={() => setEditing(null)} />
      ) : (
        <div className="acts">
          <button className="btn alt grow" onClick={() => setEditing(m.k)}>Ubah</button>
          {off ? (
            <button className="btn alt grow" onClick={() => act('masterOff', m.k, false)}>Aktifkan</button>
          ) : (
            <Confirm className="btn bad grow" onConfirm={() => act('masterOff', m.k, true)}>Nonaktifkan</Confirm>
          )}
        </div>
      )}
    </div>
  )
}

export function VMst() {
  const { db } = useApp()
  const [q, setQ] = useState('')
  const [st, setSt] = useState('aktif')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const qq = q.trim().toLowerCase()
  const list = db.M
    .filter(m => (st == 'all' || (st == 'off') == (m.off == 'Y')) && (!qq || (m.n + ' ' + m.k).toLowerCase().includes(qq)))
    .slice()
    .sort((a, b) => a.n.localeCompare(b.n))
  const [vis, more] = useMore(list, 15)
  return (
    <>
      <Hd t="Master item" s="Barang yang bisa direquest. Nonaktifkan barang yang sudah tidak dipakai, riwayat tetap aman." />
      <div className="grid" style={{ gridColumn: '1/-1' }}>
        <label>Cari<input type="search" value={q} placeholder="Nama atau kode" onChange={e => setQ(e.target.value)} /></label>
        <label>Tampilkan
          <select value={st} onChange={e => setSt(e.target.value)}>
            <option value="aktif">Aktif</option>
            <option value="off">Nonaktif</option>
            <option value="all">Semua</option>
          </select>
        </label>
      </div>
      {adding ? (
        <div className="row" style={{ gridColumn: '1/-1' }}>
          <b>Barang baru</b>
          <MasterForm onDone={() => setAdding(false)} />
        </div>
      ) : (
        <div className="acts" style={{ gridColumn: '1/-1' }}>
          <button className="btn grow" onClick={() => setAdding(true)}>+ Tambah barang</button>
        </div>
      )}
      <small className="mut" style={{ gridColumn: '1/-1' }}>{list.length} dari {db.M.length} barang</small>
      {list.length ? vis.map(m => <MasterRow key={m.k} m={m} editing={editing == m.k} setEditing={setEditing} />) : <Empty>Tidak ada barang yang cocok.</Empty>}
      {more}
    </>
  )
}
