import { useDeferredValue, useMemo, useState } from 'react'
import { useApp, newLine } from '../store'
import { Hd, Empty, Pill, ReqCard, Confirm, useMore } from '../components/ui'
import { lineErrors } from '../lib/actions'
import { useOwnRequests } from '../lib/useOwnRequests'
import { CATS, CAT_ORDER, bySiapFirst, itemCat, reqSummary } from '../lib/reqStage'
import { D, TODAY, addDays, days } from '../lib/utils'
import './reqsaya.css'

// Hanya request yang belum 100%. Yang sudah selesai, ditolak, atau dibatalkan pindah ke tab Histori.
// Ringkasan per tahap bisa diketuk untuk menyaring; barang siap diambil selalu di atas karena itu yang butuh tindakan pemohon.
export function VReq() {
  const { sel, setUi } = useApp()
  const { aktif, histori } = useOwnRequests()
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q).trim().toLowerCase()

  // dihitung sekali per perubahan data, bukan tiap mengetik
  const sums = useMemo(() => aktif.map(r => reqSummary(r, sel)), [aktif, sel])
  const total = useMemo(() => {
    const t = { all: 0, siap: 0, approval: 0, proses: 0, tahan: 0, draft: 0 }
    sums.forEach(s => { t.all += s.n; CAT_ORDER.forEach(k => { t[k] += s.c[k] }) })
    return t
  }, [sums])
  const ready = useMemo(
    () => sums
      .flatMap(s => s.items.filter(i => itemCat(i, sel) == 'siap').map(i => ({ i, r: s.r, b: sel.siap(i), m: sel.mi(i.kode), w: days(sel.lastArrival(i.kon) || TODAY) })))
      .sort((x, y) => y.w - x.w),
    [sums, sel]
  )
  const list = useMemo(() => {
    let l = sums
    if (cat) l = l.filter(x => x.c[cat] > 0)
    if (dq) l = l.filter(x => (x.r.id + ' ' + x.items.map(i => (sel.mi(i.kode)?.n || '') + ' ' + i.kode).join(' ')).toLowerCase().includes(dq))
    return cat ? l : [...l].sort(bySiapFirst) // sort stabil: urutan terbaru tetap terjaga di tiap kelompok
  }, [sums, cat, dq, sel])
  const [rows, more] = useMore(list.map(x => x.r), 10)

  return (
    <>
      <Hd t="Request saya" s="Pantau barang Anda sampai diambil." />
      {aktif.length ? (
        <>
          {!cat && ready.length ? (
            <section className="rs-ready" aria-label="Barang siap diambil">
              <div className="rs-rh">
                <h3>{ready.length} barang siap diambil di Warehouse</h3>
                {ready.length > 3 ? <button type="button" className="lnk" onClick={() => setCat('siap')}>Lihat semua</button> : null}
              </div>
              <ul>
                {ready.slice(0, 3).map(x => (
                  <li key={x.i.id}>
                    <span className="rs-n"><b>{x.m?.n || x.i.kode}</b><small className="mut">{x.r.id}, di gudang {x.w} hari</small></span>
                    <span className="rs-q">{x.b} {x.m?.sat}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="rs-chips" role="group" aria-label="Saring menurut tahap">
            <button type="button" className="chip" aria-pressed={!cat} onClick={() => setCat('')}>Semua ({total.all})</button>
            {CAT_ORDER.filter(k => total[k] > 0).map(k => (
              <button key={k} type="button" className="chip" aria-pressed={cat == k} onClick={() => setCat(cat == k ? '' : k)}>{CATS[k].l} ({total[k]})</button>
            ))}
          </div>
          {aktif.length > 5 ? (
            <input className="rs-q-in" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nomor request atau nama barang" aria-label="Cari request" />
          ) : null}
          <p className="mut rs-cnt" aria-live="polite">{cat || dq ? list.length + ' dari ' + aktif.length + ' request' : ''}</p>

          {rows.length ? (
            rows.map(r => <ReqCard key={r.id} r={r} mode="own" />)
          ) : (
            <Empty>
              Tidak ada request yang cocok.{' '}
              <button type="button" className="lnk" onClick={() => { setCat(''); setQ('') }}>Hapus filter</button>
            </Empty>
          )}
          {more}
        </>
      ) : (
        <Empty>
          {histori.length
            ? 'Tidak ada request yang sedang berjalan. Semua request Anda sudah selesai dan ada di Histori.'
            : 'Belum ada request. Buka tab Buat request untuk mulai.'}
        </Empty>
      )}
      {histori.length ? (
        <div style={{ marginTop: 12 }}>
          <button className="lnk" onClick={() => setUi({ tab: 'his' })}>Lihat Histori ({histori.length} request)</button>
        </div>
      ) : null}
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
