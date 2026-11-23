import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import { Empty, Pill, Confirm } from '../components/ui'
import { D, TODAY, days } from '../lib/utils'
import './serah.css'

// Serah terima per PENERIMA. Di gudang, yang datang ke loket adalah orang, dan barangnya bisa tersebar di
// banyak SRL. Jadi petugas mencari orangnya, lalu menyerahkan semua barangnya lintas SRL sekaligus.
// Aman untuk ratusan SRL: daftar bertahap (20 per halaman), cari/filter/urut, rincian hanya untuk satu orang.

const PAGE = 20
const GPAGE = 8 // grup SRL yang tampil sekaligus di rincian satu penerima
const BUKA = 3 // bila SRL lebih dari ini, hanya sebagian kecil yang terbuka di awal
const LAMA = 3 // hari di gudang yang dianggap lama
const SORTS = { wait: 'Menunggu terlama', need: 'Kebutuhan terdekat', many: 'Barang terbanyak', name: 'Nama A-Z' }
const ini = n => n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
const fmt = n => String(Math.round(n * 100) / 100).replace('.', ',')

// Semua barang siap serah, dikelompokkan per penerima. Dihitung sekali per perubahan data.
export function usePenerima() {
  const { db, sel } = useApp()
  return useMemo(() => {
    const g = new Map()
    db.I.forEach(i => {
      if (i.status != 'Sudah di ERO') return
      const b = sel.siap(i)
      if (!(b > 0)) return
      const by = sel.RQ(i.req).by
      const k = sel.KN(i.kon)
      const it = { i, b, m: sel.mi(i.kode), srl: k?.srl || '-', est: sel.SRLof(k?.srl)?.est || '', wait: days(sel.lastArrival(i.kon) || TODAY) }
      if (!g.has(by)) g.set(by, { by, name: sel.nm(by), dept: sel.user(by)?.dept || '', items: [] })
      g.get(by).items.push(it)
    })
    return [...g.values()].map(p => {
      p.items.sort((a, b) => sel.ord(a.i, b.i))
      p.srls = new Set(p.items.map(x => x.srl))
      p.wait = Math.max(...p.items.map(x => x.wait))
      p.need = p.items.reduce((m, x) => (x.i.pakai && x.i.pakai < m ? x.i.pakai : m), '9999-12-31')
      p.hay = (p.name + ' ' + p.dept + ' ' + [...p.srls].join(' ') + ' ' + p.items.map(x => x.m.n + ' ' + x.i.kode).join(' ')).toLowerCase()
      return p
    })
  }, [db, sel])
}

// Kelompokkan barang per SRL; SRL dengan estimasi paling awal di atas.
export function grupSrl(items) {
  const m = new Map()
  items.forEach(x => {
    if (!m.has(x.srl)) m.set(x.srl, { no: x.srl, est: x.est, a: [] })
    m.get(x.srl).a.push(x)
  })
  return [...m.values()].sort((a, b) => ((a.est || '9') < (b.est || '9') ? -1 : (a.est || '9') > (b.est || '9') ? 1 : a.no < b.no ? -1 : 1))
}

// Kotak centang tiga keadaan: semua / sebagian / tidak ada.
function Tri({ n, of, onChange, label }) {
  const r = useRef(null)
  useEffect(() => { if (r.current) r.current.indeterminate = n > 0 && n < of }, [n, of])
  return <input ref={r} type="checkbox" checked={n == of && of > 0} onChange={() => onChange(n < of)} aria-label={label} />
}

function Detail({ p, onBack }) {
  const { db, sel, me, act } = useApp()
  const [off, setOff] = useState(() => new Set()) // barang yang tidak dicentang (bawaan: semua ikut)
  const [qty, setQty] = useState({}) // jumlah diubah per barang (bawaan: semua yang siap)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [lim, setLim] = useState(GPAGE)
  const allGrups = useMemo(() => grupSrl(p.items), [p.items])
  // SRL banyak: hanya beberapa teratas yang terbuka di awal; sedikit: semua terbuka
  const [buka, setBuka] = useState(() => new Set(allGrups.slice(0, allGrups.length > BUKA ? 1 : allGrups.length).map(g => g.no)))
  const key = useDeferredValue(q).trim().toLowerCase()
  const first = p.name.split(' ')[0]
  const hp = db.HP[p.by]

  const val = x => (qty[x.i.id] != null ? qty[x.i.id] : String(x.b))
  const okq = x => val(x) !== '' && +val(x) > 0 && +val(x) <= x.b
  const on = x => !off.has(x.i.id)
  const pilih = p.items.filter(on)
  const salah = pilih.filter(x => !okq(x))
  const shown = useMemo(() => (key ? p.items.filter(x => (x.m.n + ' ' + x.i.kode + ' ' + x.srl).toLowerCase().includes(key)) : p.items), [p.items, key])

  const grups = useMemo(() => grupSrl(shown), [shown])
  const vis = grups.slice(0, lim)
  const isi = x => !on(x) || okq(x) // barang yang dicentang tapi jumlahnya salah
  const terbuka = g => !!key || buka.has(g.no) || !g.a.every(isi) // pencarian dan galat selalu terlihat
  const toggle = no => setBuka(s => { const n = new Set(s); n.has(no) ? n.delete(no) : n.add(no); return n })
  const semuaBuka = grups.length > 0 && grups.every(terbuka)

  const flip = id => setOff(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const semua = v => setOff(v ? new Set() : new Set(p.items.map(x => x.i.id)))
  const setSrl = (a, v) => setOff(s => { const n = new Set(s); a.forEach(x => (v ? n.delete(x.i.id) : n.add(x.i.id))); return n })

  const serahkan = async () => {
    const ids = pilih.map(x => x.i.id)
    const qtys = {}
    pilih.forEach(x => { if (+val(x) != x.b) qtys[x.i.id] = +val(x) })
    setBusy(true)
    try {
      const ok = await act('serahAll', ids, qtys)
      if (ok !== false) { setOff(new Set()); setQty({}) }
    } finally { setBusy(false) }
  }
  const wa = () => {
    const lst = p.items.slice(0, 6).map(x => '- ' + x.b + ' ' + x.m.sat + ' ' + x.m.n).join('\n')
    const msg = 'Halo ' + p.name + ', ' + p.items.length + ' barang sudah siap diambil di Warehouse:\n' + lst + (p.items.length > 6 ? '\n...dan ' + (p.items.length - 6) + ' barang lainnya.' : '')
    act('ingatAll', p.items.map(x => x.i.id), me.id)
    window.open('https://wa.me/' + hp + '?text=' + encodeURIComponent(msg), '_blank', 'noopener')
  }
  const totalPilih = pilih.length

  return (
    <section className="sh-det" aria-label={'Barang siap untuk ' + p.name}>
      <div className="sh-dh">
        <button className="sh-back" onClick={onBack} aria-label="Kembali ke daftar penerima">‹ Penerima</button>
        <div className="sh-dn">
          <b>{p.name}</b>
          <small className="mut">{p.dept}, {p.items.length} barang di {p.srls.size} SRL</small>
        </div>
        {hp ? <button className="btn alt" onClick={wa}>Ingatkan via WA</button> : null}
      </div>

      <div className="sh-tools">
        {p.items.length > 6 ? (
          <input type="search" value={q} onChange={e => { setQ(e.target.value); setLim(GPAGE) }} placeholder="Cari barang, kode, atau nomor SRL" aria-label="Cari barang penerima ini" />
        ) : null}
        <span className="grow" />
        <small className="mut" aria-live="polite">{totalPilih} dari {p.items.length} dipilih</small>
        {grups.length > 1 && !key ? (
          <button className="lnk" onClick={() => setBuka(semuaBuka ? new Set() : new Set(allGrups.map(g => g.no)))}>{semuaBuka ? 'Tutup semua SRL' : 'Buka semua SRL'}</button>
        ) : null}
        <button className="lnk" onClick={() => semua(true)}>Pilih semua</button>
        <button className="lnk" onClick={() => semua(false)}>Kosongkan</button>
      </div>

      {vis.map(gr => {
        const n = gr.a.filter(on).length
        const open = terbuka(gr)
        const telat = !!(gr.est && gr.est < TODAY)
        const rusak = gr.a.some(x => !isi(x))
        const lama = Math.max(...gr.a.map(x => x.wait))
        return (
          <div key={gr.no} className={'sh-g' + (open ? ' open' : '')}>
            <div className="sh-gh">
              <Tri n={n} of={gr.a.length} onChange={v => setSrl(gr.a, v)} label={'Pilih semua barang di ' + gr.no} />
              <button className="sh-gt" aria-expanded={open} aria-controls={'g-' + gr.no} onClick={() => toggle(gr.no)} disabled={!!key}>
                <span className="sh-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span className="sh-gn">
                  <b>{gr.no}</b>
                  <small className="mut">est. {D(gr.est)}, {n} dari {gr.a.length} barang dipilih</small>
                </span>
                <span className="sh-gm">
                  {rusak ? <Pill t="t-bad">Jumlah salah</Pill> : null}
                  {telat ? <Pill t="t-bad">Terlambat</Pill> : null}
                  {lama >= LAMA ? <Pill t="t-warn">{lama} hari</Pill> : null}
                </span>
              </button>
            </div>
            {open ? (
              <div id={'g-' + gr.no}>
                {gr.a.map(x => (
                  <div key={x.i.id} className={'sh-i' + (on(x) ? '' : ' off')}>
                    <input type="checkbox" checked={on(x)} onChange={() => flip(x.i.id)} aria-label={'Serahkan ' + x.m.n} />
                    <span className="sh-it">
                      <b>{x.m.n}</b>
                      <small className="mut">{x.i.kode}, pakai {D(x.i.pakai)}, dipesan {x.i.qty}</small>
                      {x.wait >= LAMA ? <Pill t="t-warn">Di gudang {x.wait} hari</Pill> : null}
                    </span>
                    <span className="sh-q">
                      <input
                        type="number" inputMode="decimal" min="0" max={x.b} step="any" value={val(x)} disabled={!on(x)}
                        aria-label={'Jumlah ' + x.m.n} aria-invalid={on(x) && !okq(x) ? 'true' : undefined}
                        onChange={e => setQty(s => ({ ...s, [x.i.id]: e.target.value }))}
                      />
                      <small className="mut">dari {fmt(x.b)} {x.m.sat}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      {grups.length > vis.length ? (
        <button className="btn alt sh-more" onClick={() => setLim(l => l + GPAGE)}>Tampilkan {Math.min(GPAGE, grups.length - vis.length)} SRL lagi (sisa {grups.length - vis.length})</button>
      ) : null}
      {key && !shown.length ? <Empty>Tidak ada barang yang cocok dengan "{q.trim()}".</Empty> : null}

      <div className="sh-bar">
        {salah.length ? (
          <div className="hint" role="alert">Jumlah {salah.length} barang tidak valid. Isi 1 sampai jumlah yang siap.</div>
        ) : null}
        {totalPilih && !salah.length && !busy ? (
          <Confirm className="btn sh-go" onConfirm={serahkan}>Serahkan {totalPilih} barang ke {first}</Confirm>
        ) : (
          <button className="btn sh-go" disabled>{busy ? 'Menyimpan...' : 'Pilih barang yang diserahkan'}</button>
        )}
      </div>
    </section>
  )
}

export function SerahPenerima() {
  const all = usePenerima()
  const [f, setF] = useState({ q: '', dept: '', sort: 'wait', lama: false, lim: PAGE })
  const [cur, setCur] = useState('')
  const set = p => setF(x => ({ ...x, ...('lim' in p ? {} : { lim: PAGE }), ...p }))
  const q = useDeferredValue(f.q).trim().toLowerCase()

  const depts = useMemo(() => [...new Set(all.map(p => p.dept).filter(Boolean))].sort(), [all])
  const lamaN = useMemo(() => all.filter(p => p.wait >= LAMA).length, [all])
  const list = useMemo(() => {
    const cmp = {
      wait: (a, b) => b.wait - a.wait || a.name.localeCompare(b.name),
      need: (a, b) => (a.need < b.need ? -1 : a.need > b.need ? 1 : a.name.localeCompare(b.name)),
      many: (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    }[f.sort]
    return all.filter(p => (!q || p.hay.includes(q)) && (!f.dept || p.dept == f.dept) && (!f.lama || p.wait >= LAMA)).sort(cmp)
  }, [all, q, f.dept, f.sort, f.lama])

  const p = all.find(x => x.by == cur) // hilang sendiri setelah semua barangnya diserahkan
  const nBarang = useMemo(() => all.reduce((a, x) => a + x.items.length, 0), [all])
  const aktif = !!(f.q || f.dept || f.lama)
  const vis = list.slice(0, f.lim)

  if (!all.length) return <Empty>Belum ada barang yang siap diserahkan.</Empty>
  return (
    <div className={'sh-wrap' + (p ? ' on' : '')}>
      <div className="sh-lc">
        <div className="sh-tools">
          <input
            type="search" value={f.q} onChange={e => set({ q: e.target.value })} aria-label="Cari penerima"
            placeholder="Cari nama, departemen, barang, atau SRL"
            autoFocus={typeof window != 'undefined' && window.innerWidth >= 1024}
          />
        </div>
        <div className="sh-tools">
          <select value={f.dept} onChange={e => set({ dept: e.target.value })} aria-label="Departemen">
            <option value="">Semua departemen</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={f.sort} onChange={e => set({ sort: e.target.value })} aria-label="Urutkan">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="sh-tools">
          {lamaN > 0 && <button className="chip" aria-pressed={f.lama} onClick={() => set({ lama: !f.lama })}>Menunggu {LAMA}+ hari ({lamaN})</button>}
          <small className="mut">{list.length == all.length ? all.length + ' penerima, ' + nBarang + ' barang' : list.length + ' dari ' + all.length + ' penerima'}</small>
          {aktif && <button className="lnk" onClick={() => set({ q: '', dept: '', lama: false })}>Hapus filter</button>}
        </div>
        <div role="listbox" aria-label="Daftar penerima" className="sh-list">
          {vis.map(x => (
            <button key={x.by} role="option" aria-selected={x.by == cur} className={'sh-p' + (x.by == cur ? ' on' : '')} onClick={() => setCur(x.by)}>
              <span className="sh-av" aria-hidden="true">{ini(x.name)}</span>
              <span className="sh-pt">
                <b>{x.name}</b>
                <small className="mut">{x.dept}, {x.items.length} barang, {x.srls.size} SRL</small>
              </span>
              <span className="sh-pm">{x.wait >= LAMA ? <Pill t="t-warn">{x.wait} hari</Pill> : <small className="mut">{x.wait} hari</small>}</span>
            </button>
          ))}
          {!list.length ? <Empty>Tidak ada penerima yang cocok.</Empty> : null}
        </div>
        {list.length > vis.length ? (
          <button className="btn alt sh-more" onClick={() => set({ lim: f.lim + PAGE })}>Tampilkan {Math.min(PAGE, list.length - vis.length)} lagi (sisa {list.length - vis.length})</button>
        ) : null}
      </div>
      <div className="sh-dc">
        {p ? <Detail key={p.by} p={p} onBack={() => setCur('')} /> : <div className="sh-hint">Pilih penerima di daftar untuk melihat barang yang siap diserahkan.</div>}
      </div>
    </div>
  )
}
