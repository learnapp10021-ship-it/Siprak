import { useApp, newLine } from '../store'
import { Hd, Empty, Pill, ReqCard, Confirm } from '../components/ui'
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

export function VNew() {
  const { db, sel, ui, setUi, me, act } = useApp()
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
    if (await act('saveRequest', { status, lines: f, me })) setUi({ draft: [newLine()], tab: 'req' })
  }

  return (
    <>
      <Hd t="Buat request" s="Satu request bisa berisi beberapa barang." />
      {f.map((x, i) => {
        const m = x.kode && sel.mi(x.kode)
        const min = m ? addDays(TODAY, +m.lead) : TODAY
        return (
          <div className="row" key={i}>
            <div className="f">
              <label>Barang
                <select value={x.kode} onChange={e => set(i, 'kode', e.target.value)}>
                  <option value="">Pilih barang</option>
                  {db.M.map(o => <option key={o.k} value={o.k}>{o.n} ({o.k})</option>)}
                </select>
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
                <input type="number" min="0" step="any" inputMode="decimal" value={x.qty} onChange={e => set(i, 'qty', e.target.value)} />
              </label>
              <label>Tanggal datang{m ? ' (paling cepat ' + D(min) + ')' : ''}
                <input type="date" min={min} value={x.datang} onChange={e => set(i, 'datang', e.target.value)} />
              </label>
              <label>Tanggal pakai {m && m.buf == '0' ? '(wajib)' : '(opsional)'}
                <input type="date" value={x.pakai} onChange={e => set(i, 'pakai', e.target.value)} />
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
