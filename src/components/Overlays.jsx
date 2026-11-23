import { useState } from 'react'
import { TABS, useApp } from '../store'
import { Pill } from './ui'
import { Dialog } from './Dialog'
import { D, TODAY, days, dayDiff, disp } from '../lib/utils'
import { ThemeSwitch } from './ThemeSwitch'

const age = w => (w >= 7 ? 't-bad' : w >= 3 ? 't-warn' : 't-gray')

export function Drawer({ cnt }) {
  const { ui, setUi, me, logout } = useApp()
  const tabs = TABS[me.role]
  const close = () => setUi({ menu: false })
  return (
    <>
      <div className="scrim" onClick={close} />
      <Dialog as="aside" className="drawer" label="Menu">
        <div className="dh"><b>{me.n}</b><small>{me.role}, {me.dept}</small></div>
        {tabs.map(t => (
          <button key={t[0]} className="mi" aria-current={t[0] == ui.tab ? 'true' : undefined} onClick={() => setUi({ tab: t[0], menu: false, eu: null })}>
            {t[1]}{cnt[t[0]] ? ' (' + cnt[t[0]] + ')' : ''}
          </button>
        ))}
        <div className="mi-tema"><span>Tema tampilan</span><ThemeSwitch inline /></div>
        <button className="mi" onClick={() => setUi({ help: true, menu: false })}>Cara pakai</button>
        <button className="mi" onClick={() => setUi({ eu: me.id, self: true, menu: false })}>Profil saya</button>
        <button className="mi mi-out" onClick={logout}>Keluar</button>
      </Dialog>
    </>
  )
}

export function UserSheet() {
  const { db, ui, setUi, me, act } = useApp()
  const nw = ui.eu == 'new'
  const wh = me.role == 'Admin Warehouse'
  const u = nw ? { n: '', id: '', role: 'User', boss: '', dept: wh ? ui.ud : me.dept } : db.U.find(x => x.id == ui.eu)
  const deps = [...new Set(db.U.map(x => x.dept))]
  const roles = wh ? ['User', 'Atasan', 'Admin Dept', 'Admin Warehouse', 'Spv Warehouse'] : ['User', 'Atasan', 'Admin Dept']
  const bos = db.U.filter(x => x.role == 'Atasan' && x.id != u.id && (wh || x.dept == u.dept))
  const ttl = ui.self ? 'Profil saya' : nw ? 'Tambah pengguna' : 'Ubah pengguna'
  const [f, setF] = useState({ n: u.n, e: u.id, w: disp(db.HP[u.id]), r: u.role, b: u.boss || '', d: u.dept, a: !u.off })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const close = () => setUi({ eu: null, self: false })
  const save = async () => {
    const ok = await act('saveUser', {
      mode: nw ? 'new' : 'edit', self: ui.self, id: u.id, n: f.n.trim(), rawWa: f.w.trim(), email: f.e.trim(),
      role: f.r, boss: f.b, dept: wh ? f.d.trim() : undefined,
      active: nw || ui.self || u.id == ui.me ? undefined : f.a, me,
      // versi baris yang sedang dilihat: jika orang lain sudah mengubahnya, simpan ditolak (tidak menimpa)
      baseV: nw ? undefined : u._v,
    })
    if (ok) close()
  }
  return (
    <>
      <div className="scrim" onClick={close} />
      <Dialog label={ttl}>
        <h2>{ttl}</h2>
        <div className="f">
          <label>Nama<input value={f.n} onChange={e => set('n', e.target.value)} /></label>
          <label>Email (login)<input type="email" value={f.e} disabled={!nw} onChange={e => set('e', e.target.value)} /></label>
          <label>No. WhatsApp untuk pengingat<input inputMode="tel" value={f.w} onChange={e => set('w', e.target.value)} placeholder="08xxxxxxxxxx" /></label>
          {!ui.self && (
            <>
              <div className="grid">
                <label>Role
                  <select value={f.r} onChange={e => set('r', e.target.value)}>{roles.map(r => <option key={r}>{r}</option>)}</select>
                </label>
                <label>Atasan (wajib untuk User)
                  <select value={f.b} onChange={e => set('b', e.target.value)}>
                    <option value="">Tidak ada</option>
                    {bos.map(b => <option key={b.id} value={b.id}>{b.n}</option>)}
                  </select>
                </label>
              </div>
              {wh && (
                <label>Departemen
                  <input list="dl" value={f.d} onChange={e => set('d', e.target.value)} placeholder="Pilih atau ketik departemen baru" />
                  <datalist id="dl">{deps.map(x => <option key={x} value={x} />)}</datalist>
                </label>
              )}
              {!nw && (
                <label className="chk">
                  <input type="checkbox" checked={f.a} disabled={u.id == ui.me} onChange={e => set('a', e.target.checked)} />Pengguna aktif
                </label>
              )}
            </>
          )}
        </div>
        <div className="acts">
          <button className="btn alt grow" onClick={close}>Batal</button>
          <button className="btn grow" onClick={save}>Simpan</button>
        </div>
      </Dialog>
    </>
  )
}

export function PicSheet() {
  const { db, sel, ui, setUi } = useApp()
  const u = sel.user(ui.dpic)
  if (!u) return null
  const a = db.I.filter(i => i.status == 'Sudah di ERO' && sel.siap(i) > 0 && sel.RQ(i.req).by == u.id)
    .map(i => ({ i, m: sel.mi(i.kode), b: sel.siap(i), w: days(sel.lastArrival(i.kon) || TODAY), rm: sel.reminders(i.id) }))
    .sort((x, y) => y.w - x.w)
  const mx = a.length ? Math.max(...a.map(x => x.w)) : 0
  const close = () => setUi({ dpic: null })
  return (
    <>
      <div className="scrim" onClick={close} />
      <Dialog label={'Barang ' + u.n}>
        <h2>{u.n}</h2>
        <small className="mut">{u.dept}{u.boss ? ', atasan ' + sel.nm(u.boss) : ''}{db.HP[u.id] ? ', WA ' + disp(db.HP[u.id]) : ''}</small>
        <div className="between" style={{ marginTop: 10 }}>
          <Pill t="t-info">{a.length} barang belum diambil</Pill>
          {a.length ? <Pill t={age(mx)}>Terlama {mx} hari</Pill> : null}
        </div>
        <h3>Barang menunggu (ketuk untuk detail)</h3>
        {a.length ? a.map(x => (
          <button key={x.i.id} className="urow" onClick={() => setUi({ di: x.i.id })}>
            <span><b>{x.m.n}</b><br /><small className="mut">{x.b} {x.m.sat}, {x.i.req}, {x.rm.length ? 'diingatkan ' + x.rm.length + ' kali' : 'belum diingatkan'}</small></span>
            <span><Pill t={age(x.w)}>{x.w} hari</Pill></span>
          </button>
        )) : <small className="mut">Semua barang sudah diambil.</small>}
        <div className="acts"><button className="btn grow" onClick={close}>Tutup</button></div>
      </Dialog>
    </>
  )
}

const Dl = ({ a }) => <dl className="dl">{a.map((x, n) => [<dt key={'t' + n}>{x[0]}</dt>, <dd key={'d' + n}>{x[1]}</dd>])}</dl>
const Tl = ({ a, e }) => a.length
  ? <ul className="tl">{a.map((x, n) => <li key={n}><span>{x[0]}</span><span>{x[1]}</span></li>)}</ul>
  : <small className="mut">{e}</small>

export function DetailSheet() {
  const { db, sel, ui, setUi } = useApp()
  const i = db.I.find(x => x.id == ui.di)
  if (!i) return null
  const m = sel.mi(i.kode), r = sel.RQ(i.req), u = sel.user(r.by), k = sel.KN(i.kon)
  const kd = db.KD.filter(d => d.kon == i.kon).sort((a, b) => (a.tgl < b.tgl ? -1 : 1))
  const rm = sel.reminders(i.id)
  const sr = db.SR.filter(s => s.item == i.id)
  const b = sel.siap(i)
  const first = kd[0]?.tgl
  const last = kd.length ? kd[kd.length - 1].tgl : ''
  const w = days(last || TODAY)
  const ap = (i.appr || '').slice(0, 10)
  const s = k ? sel.SRLof(k.srl) : null
  const close = () => setUi({ di: null })
  return (
    <>
      <div className="scrim" onClick={close} />
      <Dialog label={'Detail ' + m.n}>
        <h2>{m.n}</h2>
        <small className="mut">{m.k}, {i.id}, {r.id}</small>
        <div className="between" style={{ marginTop: 10 }}>
          <Pill t={age(w)}>Di gudang {w} hari</Pill>
          <Pill t={rm.length ? 't-info' : w >= 3 ? 't-bad' : 't-gray'}>{rm.length ? 'Diingatkan ' + rm.length + ' kali' : 'Belum diingatkan'}</Pill>
        </div>
        <h3>Jumlah</h3>
        <Dl a={[['Dipesan', i.qty + ' ' + m.sat], ['Jatah yang sudah datang', sel.berhak(i) + ' ' + m.sat], ['Sudah diambil', sel.diambil(i) + ' ' + m.sat], [<b>Siap diambil</b>, <b>{b} {m.sat}</b>]]} />
        <h3>Peminta</h3>
        <Dl a={[['Nama', u.n], ['Departemen', u.dept], ['Atasan', u.boss ? sel.nm(u.boss) : '-'], ['Request', r.id + ', dibuat ' + D(r.tgl)]]} />
        <h3>Tanggal dan lead time</h3>
        <Dl a={[
          ['Disetujui', ap ? D(ap) : '-'], ['Diminta datang', D(i.datang)], ['Dipakai', i.pakai ? D(i.pakai) : '-'],
          ['Datang pertama', first ? D(first) : '-'], ['Datang terakhir', last ? D(last) : '-'],
          ['Lead time kedatangan', ap && first ? dayDiff(ap, first) + ' hari' : '-'],
          ['SRL', k ? k.srl + (s ? ', estimasi ' + D(s.est) : '') : '-'],
        ]} />
        <h3>Riwayat kedatangan SRL</h3>
        <Tl a={kd.map(d => [D(d.tgl), d.qty + ' ' + m.sat + (+d.lebih > 0 ? ', lebih ' + d.lebih : '') + ', oleh ' + sel.nm(d.by)])} e="Belum ada barang datang." />
        <h3>Riwayat pengingat</h3>
        <Tl a={rm.map(x => [D(x.at) + ' ' + x.at.slice(11, 16), sel.nm(x.by)])} e="Belum pernah diingatkan. Pengingat dikirim oleh Admin Warehouse." />
        <h3>Riwayat pengambilan</h3>
        <Tl a={sr.map(x => [x.tgl ? D(x.tgl) : '-', x.qty + ' ' + m.sat + ' oleh ' + sel.nm(x.to)])} e="Belum ada yang diambil." />
        <div className="acts"><button className="btn grow" onClick={close}>Tutup</button></div>
      </Dialog>
    </>
  )
}

const HELP = {
  'Spv Warehouse': ['<b>Dashboard</b>: pantau barang yang sudah sampai tapi belum diambil, urut dari yang paling lama.', 'Lihat sudah berapa kali diingatkan. Pengingat dikirim oleh Admin Warehouse, bukan Anda.', 'Pilih periode (minggu ini, minggu lalu, 4 minggu) untuk OPR, lalu <b>Cetak atau simpan PDF</b>.'],
  User: ['Buka <b>Buat request</b>, pilih barang, isi jumlah dan tanggal.', 'Tekan <b>Ajukan ke atasan</b>, atau <b>Simpan draft</b> kalau belum siap.', 'Pantau status tiap barang di <b>Request saya</b>.', 'Saat statusnya <b>Siap diambil</b>, ambil barang di Warehouse.'],
  Atasan: ['Buka <b>Persetujuan</b> untuk melihat request tim Anda.', 'Tekan <b>Setujui</b>, atau <b>Tolak</b> dengan catatan.', 'Banyak request sekaligus? Tekan <b>Setujui semua</b>.', 'Pantau semua request tim di <b>Tim saya</b>.'],
  'Admin Dept': ['<b>Buat ERO</b>: centang request, input article dan qty ke ERO, lalu simpan nomor SRL di sini. SRL lalu divalidasi Admin Warehouse; barang yang dikeluarkan kembali ke Pool.', '<b>SRL</b>: pantau barang yang sudah datang. Tutup sisa jika supplier tidak mengirim.', '<b>Semua request</b>: cari request departemen Anda.', '<b>Pengguna</b>: kelola akun dan nomor WhatsApp.'],
  'Admin Warehouse': ['<b>Validasi SRL</b>: periksa barang di SRL dari Admin Dept. Barang yang tidak sesuai bisa <b>dikeluarkan</b> (wajib alasan, kembali ke Pool Admin Dept), lalu tekan <b>Validasi SRL</b>.', '<b>Kedatangan</b>: pilih SRL (cari, filter, atau tombol ‹ ›), lalu catat barang yang tiba. Lengkap semua? Tekan <b>Semua datang sesuai jumlah</b>.', '<b>Serah terima</b>: barang dikelompokkan per penerima. Tekan <b>Serahkan semua</b> untuk satu penerima, atau kirim pengingat WA.', '<b>Master item</b>: tambah atau ubah barang (kode, satuan, lead time, buffer). Data asli bisa ditempel dari Excel lewat <b>Impor dari Excel</b>.', '<b>Pengguna</b>: kelola akun dan nomor WhatsApp.'],
}

export function HelpSheet() {
  const { me, setUi } = useApp()
  const close = () => setUi({ help: false })
  return (
    <>
      <div className="scrim" onClick={close} />
      <Dialog label="Cara pakai">
        <h2>Cara pakai</h2>
        <ol style={{ paddingLeft: 20, margin: '0 0 14px', display: 'grid', gap: 8 }}>
          {/* teks bantuan statis milik aplikasi (bukan input pengguna) */}
          {HELP[me.role].map((s, n) => <li key={n} dangerouslySetInnerHTML={{ __html: s }} />)}
        </ol>
        <div className="acts"><button className="btn grow" onClick={close}>Mengerti</button></div>
      </Dialog>
    </>
  )
}
