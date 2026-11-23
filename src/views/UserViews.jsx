import { useState } from 'react'
import { useApp, newLine } from '../store'
import { Hd, Empty, Pill, ReqCard, Confirm } from '../components/ui'
import { lineErrors } from '../lib/actions'
import { D, TODAY, addDays } from '../lib/utils'

export function VReq() {
  const { db, ui } = useApp()
  const l = db.R.filter(r => r.by == ui.me).sort((a, b) => (b.tgl < a.tgl ? -1 : 1))
  return (
    <>
      <Hd t="Request saya" s="Pantau tiap barang dari pengajuan sampai diambil." />
      {l.length ? l.map(r => <ReqCard key={r.id} r={r} mode="own" />) : <Empty>Belum ada request. Buka tab Buat request untuk mulai.</Empty>}
    </>
  )
}

const FIELDS = ['kode', 'qty', 'datang', 'pakai']

// Pesan galat di bawah kolom. aria-hidden agar tidak ikut menjadi nama <label>; dibacakan lewat aria-describedby.
const Err = ({ id, m }) => (m ? <span className="hint" id={id} aria-hidden="true">{m}</span> : null)
const bad = (m, id) => (m ? { 'aria-invalid': 'true', 'aria-describedby': id } : {})

export function VNew() {
  const { db, sel, ui, setUi, me, act, toast } = useApp()
  const [tried, setTried] = useState(false)
  const f = ui.draft
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
      setUi({ draft: [newLine()], tab: 'req' })
    }
  }

  return (
    <>
      <Hd t="Buat request" s="Satu request bisa berisi beberapa barang." />
      {f.map((x, i) => {
        const m = x.kode && sel.mi(x.kode)
        const min = m ? addDays(TODAY, +m.lead) : TODAY
        const E = tried ? lineErrors(sel, x) : {}
        const id = k => `nr-${i}-${k}`
        return (
          <div className="row" key={i}>
            <div className="f">
              <label>Barang
                <select id={id('kode')} value={x.kode} onChange={e => set(i, 'kode', e.target.value)} {...bad(E.kode, id('kode') + '-e')}>
                  <option value="">Pilih barang</option>
                  {db.M.map(o => <option key={o.k} value={o.k}>{o.n} ({o.k})</option>)}
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
            {f.length > 1 && (
              <div className="acts">
                <Confirm className="btn bad" onConfirm={() => setUi(s => ({ draft: s.draft.filter((_, n) => n != i) }))}>Hapus barang ini</Confirm>
              </div>
            )}
          </div>
        )
      })}
      <div className="acts"><button className="btn alt grow" onClick={() => setUi(s => ({ draft: [...s.draft, newLine()] }))}>Tambah barang</button></div>
      <div className="acts">
        <button className="btn alt grow" onClick={() => save('Draft')}>Simpan draft</button>
        <button className="btn grow" onClick={() => save('Menunggu Approval')}>Ajukan ke atasan</button>
      </div>
    </>
  )
}
