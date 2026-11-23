import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, newLine } from '../store'
import { Hd, Empty, Pill, ReqCard, Confirm } from '../components/ui'
import { lineErrors } from '../lib/actions'
import { D, TODAY, addDays } from '../lib/utils'

// "Request saya" dipisah: Aktif (yang masih perlu dipantau) dan Selesai (closed: ditolak, dibatalkan, atau semua barang
// sudah diambil / sisa ditutup). Yang Selesai tidak dihitung dan tidak digambar sampai dibuka, dan tampil ringkas per
// 20 request, supaya layar tetap ringan walau riwayatnya ratusan.
const AFILTER = [
  ['', 'Semua aktif'],
  ['Menunggu Approval', 'Menunggu atasan'],
  ['Disetujui', 'Disetujui / diproses'],
  ['Draft', 'Draft'],
]
const PAGE = 20

// Baris ringkas untuk request selesai; rincian barang baru digambar saat dibuka.
function ClosedRow({ r }) {
  const { db, sel } = useApp()
  const [open, setOpen] = useState(false)
  const n = db.I.filter(i => i.req == r.id).length
  const lbl = r.st == 'Disetujui' ? 'Selesai' : r.st
  const tone = r.st == 'Ditolak' ? 't-bad' : 't-gray'
  return (
    <div className="row closed">
      <button className="cl-hd" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span><b>{r.id}</b> <small className="mut">{D(r.tgl)}, {n} barang</small></span>
        <span className="cl-r"><Pill t={r.st == 'Disetujui' ? 't-ok' : tone}>{lbl}</Pill><span className="pk-chg">{open ? 'Tutup' : 'Rincian'}</span></span>
      </button>
      {open && <ReqCard r={r} mode="own" />}
    </div>
  )
}

export function VReq() {
  const { db, sel, ui, setUi } = useApp()
  const [view, setView] = useState('aktif')
  const [f, setF] = useState('')
  const [q, setQ] = useState('')
  const [lim, setLim] = useState(PAGE)
  const toNew = () => setUi({ tab: 'new' })
  // Dihitung sekali per perubahan data: barang dikelompokkan per request, lalu dipilah aktif / selesai
  const { act, done } = useMemo(() => {
    const by = {}
    db.I.forEach(i => (by[i.req] = by[i.req] || []).push(i))
    const mine = db.R.filter(r => r.by == ui.me).sort((a, b) => (b.tgl < a.tgl ? -1 : b.tgl > a.tgl ? 1 : b.id < a.id ? -1 : 1))
    const act = [], done = []
    mine.forEach(r => (sel.reqClosed(r, by[r.id] || []) ? done : act).push(r))
    return { act, done }
  }, [db, sel, ui.me])
  const total = act.length + done.length
  const cnt = k => act.filter(r => !k || r.st == k).length
  const key = q.trim().toLowerCase()
  const hay = r => (r.id + ' ' + r.st + ' ' + db.I.filter(i => i.req == r.id).map(i => (sel.mi(i.kode)?.n || '') + ' ' + i.kode).join(' ')).toLowerCase()
  const lA = act.filter(r => !f || r.st == f)
  // pencarian hanya memindai riwayat selesai bila memang dibuka
  const lD = view == 'selesai' ? done.filter(r => !key || hay(r).includes(key)) : []
  const pick = v => { setView(v); setLim(PAGE); setQ('') }
  return (
    <>
      <Hd t="Request saya" s="Pantau tiap barang dari pengajuan sampai diambil." />
      {total > 0 && (
        <div className="acts"><button className="btn alt" onClick={toNew}>Buat request baru</button></div>
      )}
      {total > 0 && (
        <div className="seg" role="group" aria-label="Tampilan request">
          <button aria-pressed={view == 'aktif'} onClick={() => pick('aktif')}>Aktif ({act.length})</button>
          <button aria-pressed={view == 'selesai'} onClick={() => pick('selesai')}>Selesai ({done.length})</button>
        </div>
      )}
      {view == 'aktif' && (
        <>
          {act.length > 2 && (
            <div className="chips fl" role="group" aria-label="Filter status request">
              {AFILTER.filter(([k]) => !k || cnt(k) || f == k).map(([k, lbl]) => (
                <button key={k} className="chip" aria-pressed={f == k} onClick={() => setF(k)}>{lbl} ({cnt(k)})</button>
              ))}
            </div>
          )}
          {lA.map(r => <ReqCard key={r.id} r={r} mode="own" />)}
          {!total && (
            <Empty>
              Belum ada request.
              <div className="acts" style={{ justifyContent: 'center' }}><button className="btn" onClick={toNew}>Buat request pertama</button></div>
            </Empty>
          )}
          {total > 0 && !act.length && (
            <Empty>
              Tidak ada request aktif.
              <div className="acts" style={{ justifyContent: 'center' }}>
                {done.length ? <button className="btn alt" onClick={() => pick('selesai')}>Lihat {done.length} request selesai</button> : null}
              </div>
            </Empty>
          )}
          {act.length > 0 && !lA.length && (
            <Empty>
              Tidak ada request dengan status ini.
              <div className="acts" style={{ justifyContent: 'center' }}><button className="btn alt" onClick={() => setF('')}>Tampilkan semua</button></div>
            </Empty>
          )}
        </>
      )}
      {view == 'selesai' && (
        <>
          <small className="mut" style={{ gridColumn: '1/-1' }}>Riwayat request yang sudah tuntas: semua barang diambil, ditolak, atau dibatalkan.</small>
          {done.length > 5 && (
            <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
              <label>Cari riwayat
                <input type="search" value={q} placeholder="No. request atau nama barang" onChange={e => { setQ(e.target.value); setLim(PAGE) }} />
              </label>
            </div>
          )}
          {lD.slice(0, lim).map(r => <ClosedRow key={r.id} r={r} />)}
          {lD.length > lim && (
            <div className="acts">
              <button className="btn alt grow" onClick={() => setLim(lim + PAGE)}>Tampilkan {Math.min(PAGE, lD.length - lim)} lagi ({lD.length - lim} tersisa)</button>
            </div>
          )}
          {!done.length && <Empty>Belum ada request yang selesai.</Empty>}
          {done.length > 0 && !lD.length && <Empty>Tidak ada riwayat yang cocok dengan pencarian.</Empty>}
        </>
      )}
    </>
  )
}

const FIELDS = ['kode', 'qty', 'datang', 'pakai']

// Pesan galat di bawah kolom. aria-hidden agar tidak ikut menjadi nama <label>; dibacakan lewat aria-describedby.
const Err = ({ id, m }) => (m ? <span className="hint" id={id} aria-hidden="true">{m}</span> : null)
const bad = (m, id) => (m ? { 'aria-invalid': 'true', 'aria-describedby': id } : {})

// Draf form tersimpan otomatis di perangkat ini, jadi tidak hilang saat halaman dimuat ulang atau tertutup.
const DRAFT_KEY = id => 'siprak.draft.' + id
const pristine = d => d.length == 1 && !d[0].kode && !d[0].qty && !d[0].datang && !d[0].pakai
const readDraft = id => {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY(id)))
    if (!Array.isArray(v) || !v.length || v.length > 50 || !v.every(x => x && typeof x == 'object')) return null
    return v.map(x => ({ kode: String(x.kode || ''), qty: String(x.qty ?? ''), datang: String(x.datang || ''), pakai: String(x.pakai || '') }))
  } catch { return null }
}
const writeDraft = (id, d) => {
  try {
    if (pristine(d)) localStorage.removeItem(DRAFT_KEY(id))
    else localStorage.setItem(DRAFT_KEY(id), JSON.stringify(d))
  } catch { /* penyimpanan penuh atau mode privat: abaikan */ }
}

const BIG = 12 // di atas ini, daftar barang diberi kolom cari

export function VNew() {
  const { db, sel, ui, setUi, me, act, toast } = useApp()
  const [tried, setTried] = useState(false)
  const [back, setBack] = useState(false) // draf lama baru saja dipulihkan
  const [qs, setQs] = useState({}) // kata cari barang per baris
  const f = ui.draft
  const ready = useRef(false)

  // Pulihkan draf yang tersimpan, hanya bila form masih kosong
  useEffect(() => {
    if (pristine(ui.draft)) {
      const d = readDraft(ui.me)
      if (d && !pristine(d)) { setUi({ draft: d.map(x => ({ ...newLine(), ...x })) }); setBack(true) }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Simpan setiap perubahan (lewati render pertama agar draf lama tidak tertimpa sebelum dipulihkan)
  useEffect(() => {
    if (!ready.current) { ready.current = true; return }
    writeDraft(ui.me, f)
  }, [f, ui.me])

  if (me.off) return <Empty>Akun Anda nonaktif. Hubungi admin departemen untuk mengaktifkan kembali.</Empty>

  const set = (i, k, v) =>
    setUi(s => {
      const draft = s.draft.map((x, n) => (n == i ? { ...x, [k]: v } : x))
      if (k == 'kode') {
        const m = sel.mi(v)
        if (m && !draft[i].datang) draft[i].datang = addDays(TODAY, +m.lead)
      }
      return { draft }
    })
  // Form baru dikosongkan HANYA setelah server memverifikasi data tersimpan
  const save = async status => {
    // Aturan yang sama dengan server (lineErrors): tandai kolom yang salah dan pindahkan fokus ke yang pertama
    const errs = f.map(x => lineErrors(sel, x))
    const i = errs.findIndex(e => Object.keys(e).length)
    if (i >= 0) {
      setTried(true)
      document.getElementById(`nr-${i}-${FIELDS.find(k => errs[i][k])}`)?.focus()
      toast('Lengkapi isian yang belum benar (lihat pesan di bawah kolom).', true)
      return
    }
    if (await act('saveRequest', { status, lines: f, me })) {
      setTried(false)
      setBack(false)
      setQs({})
      setUi({ draft: [newLine()], tab: 'req' })
    }
  }
  const reset = () => { setTried(false); setBack(false); setQs({}); setUi({ draft: [newLine()] }) }
  const boss = me.boss ? sel.nm(me.boss) : ''

  return (
    <>
      <Hd t="Buat request" s="Satu request bisa berisi beberapa barang." />
      <small className="mut" style={{ gridColumn: '1/-1' }}>Isian tersimpan otomatis di perangkat ini sampai Anda menyimpan atau mengajukan.</small>
      {back && (
        <div className="note" role="status">
          <span>Isian sebelumnya dipulihkan.</span>
          <button className="lnk" onClick={reset}>Mulai dari kosong</button>
        </div>
      )}
      {f.map((x, i) => {
        const m = x.kode && sel.mi(x.kode)
        const min = m ? addDays(TODAY, +m.lead) : TODAY
        const E = tried ? lineErrors(sel, x) : {}
        const id = k => `nr-${i}-${k}`
        const q = (qs[i] || '').trim().toLowerCase()
        const opts = db.M.filter(o => o.k == x.kode || !q || (o.n + ' ' + o.k).toLowerCase().includes(q))
        return (
          <div className="row" key={i}>
            {f.length > 1 && (
              <div className="rowhd"><b>Barang {i + 1}</b>{m ? <small className="mut">{m.n}</small> : null}</div>
            )}
            <div className="f">
              {db.M.length > BIG && (
                <label>Cari barang
                  <input type="search" value={qs[i] || ''} placeholder="Ketik nama atau kode barang" onChange={e => setQs(s => ({ ...s, [i]: e.target.value }))} />
                </label>
              )}
              <label>Barang
                <select id={id('kode')} value={x.kode} onChange={e => set(i, 'kode', e.target.value)} {...bad(E.kode, id('kode') + '-e')}>
                  <option value="">{opts.length ? 'Pilih barang' : 'Tidak ada barang yang cocok'}</option>
                  {opts.map(o => <option key={o.k} value={o.k}>{o.n} ({o.k})</option>)}
                </select>
                <Err id={id('kode') + '-e'} m={E.kode} />
              </label>
              {m && (
                <div className="chips">
                  <Pill t="t-info">{m.buf == '1' ? 'Buffer' : 'Non buffer'}</Pill>
                  <Pill t="t-vio">{m.kons == '1' ? 'Konsinyasi' : 'Non konsinyasi'}</Pill>
                  <Pill t="t-gray">Paling cepat datang {m.lead} hari</Pill>
                </div>
              )}
            </div>
            <div className="grid">
              <label>Jumlah{m ? ' (' + m.sat + ')' : ''}
                <input id={id('qty')} type="number" min="0" step="any" inputMode="decimal" value={x.qty} onChange={e => set(i, 'qty', e.target.value)} {...bad(E.qty, id('qty') + '-e')} />
                <Err id={id('qty') + '-e'} m={E.qty} />
              </label>
              <label>Tanggal datang{m ? ' (paling cepat ' + D(min) + ')' : ''}
                <input id={id('datang')} type="date" min={min} value={x.datang} onChange={e => set(i, 'datang', e.target.value)} {...bad(E.datang, id('datang') + '-e')} />
                <Err id={id('datang') + '-e'} m={E.datang} />
              </label>
              <label>Tanggal pakai {m && m.buf == '0' ? '(wajib)' : '(opsional)'}
                <input id={id('pakai')} type="date" value={x.pakai} onChange={e => set(i, 'pakai', e.target.value)} {...bad(E.pakai, id('pakai') + '-e')} />
                <Err id={id('pakai') + '-e'} m={E.pakai} />
              </label>
            </div>
            {m && (
              <div className="chips qd" role="group" aria-label={'Pilih tanggal datang cepat untuk ' + m.n}>
                <small className="mut">Pilih cepat tanggal datang:</small>
                {[['Paling cepat', min], ['+1 minggu', addDays(min, 7)], ['+2 minggu', addDays(min, 14)]].map(([t, v]) => (
                  <button key={t} type="button" className="chip" aria-pressed={x.datang == v} onClick={() => set(i, 'datang', v)}>{t} ({D(v)})</button>
                ))}
              </div>
            )}
            {i == 0 && <small className="mut" style={{ display: 'block', marginTop: 10 }}>Tanggal datang: kapan barang sudah harus ada di gudang. Tanggal pakai: kapan barang mulai dipakai.</small>}
            {f.length > 1 && (
              <div className="acts">
                <Confirm className="btn bad" onConfirm={() => { setQs({}); setUi(s => ({ draft: s.draft.filter((_, n) => n != i) })) }}>Hapus barang ini</Confirm>
              </div>
            )}
          </div>
        )
      })}
      <div className="acts"><button className="btn alt grow" onClick={() => setUi(s => ({ draft: [...s.draft, newLine()] }))}>Tambah barang</button></div>
      <div className={'sumline' + (boss ? '' : ' warn')} role="status">
        {boss
          ? <>Request ini berisi <b>{f.length} barang</b>. Setelah diajukan, <b>{boss}</b> (atasan Anda) akan menyetujuinya.</>
          : <>Akun Anda belum punya atasan, jadi request baru bisa disimpan sebagai draft saja. Hubungi admin departemen untuk menetapkan atasan.</>}
      </div>
      <div className="acts">
        <button className="btn alt grow" onClick={() => save('Draft')}>Simpan draft</button>
        <button className="btn grow" onClick={() => save('Menunggu Approval')}>Ajukan ke atasan</button>
      </div>
      <small className="mut" style={{ gridColumn: '1/-1', display: 'block', marginTop: 8 }}>Draft bisa diajukan nanti dari tab Request saya.</small>
    </>
  )
}
