import { useEffect, useRef, useState } from 'react'
import { useApp, newLine } from '../store'
import { Hd, Empty, Pill, ReqCard, Confirm } from '../components/ui'
import { lineErrors } from '../lib/actions'
import { D, TODAY, addDays } from '../lib/utils'

// Filter status di "Request saya". 'x' = Ditolak atau Dibatalkan.
const RFILTER = [
  ['', 'Semua'],
  ['Menunggu Approval', 'Menunggu atasan'],
  ['Disetujui', 'Disetujui'],
  ['Draft', 'Draft'],
  ['x', 'Ditolak / batal'],
]
const inFilter = (r, f) => !f || (f == 'x' ? r.st == 'Ditolak' || r.st == 'Dibatalkan' : r.st == f)

export function VReq() {
  const { db, ui, setUi } = useApp()
  const [f, setF] = useState('')
  const all = db.R.filter(r => r.by == ui.me).sort((a, b) => (b.tgl < a.tgl ? -1 : 1))
  const cnt = k => all.filter(r => inFilter(r, k)).length
  const l = all.filter(r => inFilter(r, f))
  const toNew = () => setUi({ tab: 'new' })
  return (
    <>
      <Hd t="Request saya" s="Pantau tiap barang dari pengajuan sampai diambil." />
      {all.length > 0 && (
        <div className="acts"><button className="btn alt" onClick={toNew}>Buat request baru</button></div>
      )}
      {all.length > 2 && (
        <div className="chips fl" role="group" aria-label="Filter status request">
          {RFILTER.filter(([k]) => !k || cnt(k) || f == k).map(([k, lbl]) => (
            <button key={k} className="chip" aria-pressed={f == k} onClick={() => setF(k)}>{lbl} ({cnt(k)})</button>
          ))}
        </div>
      )}
      {l.map(r => <ReqCard key={r.id} r={r} mode="own" />)}
      {!all.length && (
        <Empty>
          Belum ada request.
          <div className="acts" style={{ justifyContent: 'center' }}><button className="btn" onClick={toNew}>Buat request pertama</button></div>
        </Empty>
      )}
      {all.length > 0 && !l.length && (
        <Empty>
          Tidak ada request dengan status ini.
          <div className="acts" style={{ justifyContent: 'center' }}><button className="btn alt" onClick={() => setF('')}>Tampilkan semua</button></div>
        </Empty>
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
