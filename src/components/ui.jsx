import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import { D, TODAY } from '../lib/utils'

export const Pill = ({ t, children }) => <span className={`pill ${t}`}>{children}</span>
export const Hd = ({ t, s }) => (
  <div className="hd">
    <h2>{t}</h2>
    {s ? <p className="mut">{s}</p> : null}
  </div>
)
export const Empty = ({ children }) => <div className="empty">{children}</div>
export const Srl = ({ children, ...p }) => <div className="srl" {...p}>{children}</div>

// Tombol dua ketukan: ketukan pertama minta konfirmasi, kedua menjalankan.
export function Confirm({ onConfirm, className = 'btn bad', children }) {
  const [armed, setArmed] = useState(false)
  const t = useRef()
  useEffect(() => () => clearTimeout(t.current), [])
  const click = () => {
    if (!armed) {
      setArmed(true)
      t.current = setTimeout(() => setArmed(false), 4000)
      return
    }
    clearTimeout(t.current)
    setArmed(false)
    onConfirm()
  }
  return (
    <button className={className + (armed ? ' cfm' : '')} onClick={click}>
      {armed ? 'Yakin? Ketuk lagi' : children}
    </button>
  )
}

const STAGES = ['Diajukan', 'Disetujui', 'Validasi', 'Di ERO', 'Ambil']

// Cincin progres bulat: busur = persen proses; cincin putus-putus berputar pelan saat masih menunggu
function Ring({ pct, tone, dead, wait }) {
  const r = 24, c = 2 * Math.PI * r
  return (
    <div className={`rg ${tone}`} role="img" aria-label={dead ? 'Tidak diproses' : `Proses ${pct} persen`}>
      <svg viewBox="0 0 60 60" width="56" height="56" aria-hidden="true">
        <circle className="rg-t" cx="30" cy="30" r={r} />
        {dead ? null : <circle className="rg-p" cx="30" cy="30" r={r} strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 30 30)" />}
        {wait ? <circle className="rg-w" cx="30" cy="30" r="28.5" /> : null}
      </svg>
      <span>{dead ? '\u2715' : pct + '%'}</span>
    </div>
  )
}

export const ItemCard = memo(function ItemCard({ it }) {
  const { sel } = useApp()
  // Kode yang tidak ada di master (salah ketik di spreadsheet) tidak boleh mematikan kartu
  const m = sel.mi(it.kode) || { n: it.kode, sat: '' }
  const [g, t, l] = sel.st(it)
  const dead = g < 0
  const pct = sel.progress(it)
  const ss = sel.takenOf(it.id)
  const k = sel.KN(it.kon)
  const srl = k && sel.SRLof(k.srl)
  const q = sel.antrian(it)
  const [open, setOpen] = useState(false)
  const mid = useId()
  const got = sel.berhak(it)
  const took = sel.diambil(it)
  const done = !dead && g == 4 && took >= +it.qty
  // Masih menunggu sesuatu (persetujuan, proses ERO, barang datang): cincin berputar pelan
  const wait = !dead && !done && g <= 3 && it.status != 'Draft' && !(g == 1 && it.tahan)

  const facts = []
  if (!dead) {
    if (g >= 3) facts.push(['Barang datang', `${got} dari ${it.qty} ${m.sat}`])
    if (took) facts.push(['Sudah diambil', `${took} dari ${it.qty} ${m.sat}`])
    if (q && q.n > 1 && got < +it.qty) facts.push(['Urutan antrian', `#${q.pos} dari ${q.n}${q.ahead ? `, ${q.ahead} ${m.sat} di depan` : ', paling awal'}`])
    if (g == 3 && srl?.est) facts.push(['Estimasi tiba', D(srl.est)])
    facts.push(['Butuh datang', D(it.datang)])
    if (it.pakai) facts.push(['Dipakai', D(it.pakai)])
  }
  const hasMore = !dead || ss.length > 0

  return (
    <div className={'item itm' + (open ? ' open' : '')}>
      {/* Ringkas: cincin progres + nama + status. Tahapan dan rincian dibuka lewat ketukan (tidak memanjangkan daftar). */}
      <button type="button" className="itm-top" aria-expanded={hasMore ? open : undefined} aria-controls={hasMore ? mid : undefined} disabled={!hasMore} onClick={() => setOpen(o => !o)}>
        <Ring pct={pct} tone={t} dead={dead} wait={wait} />
        <span className="itm-main">
          <span className="between"><b>{m.n}</b><span className="itm-q">{it.qty} {m.sat}</span></span>
          <span className={`lbl ${t}`}>{l}</span>
        </span>
        {hasMore ? <i className="itm-ch" aria-hidden="true" /> : null}
      </button>
      {hasMore ? (
        <div className="itm-more" id={mid}>
          <div className="itm-in">
            {dead ? null : (
              <ol className="itm-steps" aria-label="Tahapan proses">
                {STAGES.map((s, n) => (
                  <li key={s} className={n < g || done ? 'on' : n == g ? 'cur ' + t : ''} aria-current={n == g && !done ? 'step' : undefined}>
                    <i />
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            )}
            {facts.length ? (
              <dl className="itm-facts">
                {facts.map(([a, b]) => (
                  <div key={a}><dt>{a}</dt><dd>{b}</dd></div>
                ))}
              </dl>
            ) : null}
            {ss.map((s, n) => (
              <div key={n}><small className="mut">Diambil {s.qty} oleh {sel.nm(s.to)}</small></div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
})

const TONE = { Draft: 't-gray', 'Menunggu Approval': 't-warn', Disetujui: 't-ok', Ditolak: 't-bad', Dibatalkan: 't-gray' }

// mode: 'own' (milik sendiri), 'appr' (untuk atasan menyetujui), 'tim' (hanya lihat)
export const ReqCard = memo(function ReqCard({ r, mode }) {
  const { sel, act } = useApp()
  const [cat, setCat] = useState('')
  const [showDone, setShowDone] = useState(false)
  // Fokus ke yang belum tuntas: barang yang sudah 100% dilipat di bawah satu baris ringkas
  const all = sel.itemsOf(r.id)
  const its = all.filter(i => !sel.itemDone(i) || i.status != 'Sudah di ERO')
  const fin = all.filter(i => sel.itemDone(i) && i.status == 'Sudah di ERO')
  const doneId = useId()
  return (
    <div className="row">
      <div className="between">
        <div><b>{r.id}</b> <small>{D(r.tgl)}{mode != 'own' ? ', ' + sel.nm(r.by) : ''}</small></div>
        <Pill t={TONE[r.st]}>{r.st}</Pill>
      </div>
      {r.cat ? <small className="mut">Catatan atasan: {r.cat}</small> : null}
      {its.map(i => <ItemCard key={i.id} it={i} />)}
      {fin.length ? (
        <div className="fin">
          <button type="button" className="fin-btn" aria-expanded={showDone} aria-controls={doneId} onClick={() => setShowDone(o => !o)}>
            <span>{fin.length} barang sudah selesai (100%)</span>
            <i className="itm-ch" aria-hidden="true" />
          </button>
          {showDone ? <div id={doneId}>{fin.map(i => <ItemCard key={i.id} it={i} />)}</div> : null}
        </div>
      ) : null}
      {mode == 'own' && r.st == 'Draft' && (
        <div className="acts">
          <button className="btn" onClick={() => act('ajukan', r.id)}>Ajukan</button>
          <Confirm onConfirm={() => act('batal', r.id)}>Batalkan</Confirm>
        </div>
      )}
      {mode == 'own' && r.st == 'Menunggu Approval' && (
        <div className="acts"><Confirm onConfirm={() => act('batal', r.id)}>Batalkan</Confirm></div>
      )}
      {mode == 'appr' && (
        <div className="acts">
          <div className="f" style={{ flex: '1 0 100%' }}>
            <textarea rows="2" value={cat} onChange={e => setCat(e.target.value)} placeholder="Catatan (wajib jika menolak)" aria-label="Catatan untuk pemohon" />
          </div>
          <button className="btn grow" onClick={() => act('setuju', r.id)}>Setujui</button>
          <Confirm className="btn bad grow" onConfirm={() => act('tolak', r.id, cat.trim())}>Tolak</Confirm>
        </div>
      )}
    </div>
  )
})

// Salin ke clipboard dengan fallback execCommand
export function copyText(t, toast) {
  const ok = () => toast('Disalin ke clipboard.')
  const fb = () => {
    const a = document.createElement('textarea')
    a.value = t
    a.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(a)
    a.select()
    try { document.execCommand('copy'); ok() } catch { toast('Gagal menyalin. Salin manual.', true) }
    a.remove()
  }
  try { navigator.clipboard.writeText(t).then(ok, fb) } catch { fb() }
}

// Pemilih SRL untuk jumlah banyak (puluhan SRL): cari, filter dept / terlambat, urutkan, daftar bertahap.
// HP: hanya satu kartu "SRL aktif" + tombol sebelumnya/berikutnya; daftar & pencarian dibuka lewat "Cari / ganti SRL".
// Desktop: daftar selalu tampil di kolom kiri.
// g = { [noSRL]: [item, ...] }. SRL teratas hasil filter otomatis terpilih.
// prog(no) opsional -> { pct, text } untuk bilah progres tiap SRL.
const PAGE = 8
const SORTS = { est: 'Estimasi terdekat', new: 'SRL terbaru', big: 'Barang terbanyak' }

function goDetail() {
  if (typeof window == 'undefined' || window.innerWidth >= 1024) return
  const sm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  requestAnimationFrame(() => document.getElementById('srl-detail')?.scrollIntoView({ block: 'start', behavior: sm }))
}

// Fokus ke kolom jumlah pertama di detail SRL (alur cepat dengan keyboard atau pemindai barcode)
export function fokusJumlah() {
  if (typeof document == 'undefined') return
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector('#srl-detail ~ * input[type=number]:not(:disabled)')
    if (el) el.focus({ preventScroll: false })
  }))
}

export function useSrlPick(g, sel, prog) {
  const [f, setF] = useState({ pick: '', q: '', dept: '', late: false, sort: 'est', lim: PAGE, open: false })
  // ganti pilihan / buka-tutup / tampilkan lagi tidak mereset panjang daftar; ubah filter mereset
  const set = p => setF(x => ({ ...x, ...('pick' in p || 'lim' in p || 'open' in p ? {} : { lim: PAGE }), ...p }))
  // dihitung ulang hanya saat data berubah (bukan tiap ketikan); caller wajib memo-kan g dan prog
  const meta = useMemo(() => {
    const o = {}
    Object.keys(g).forEach(no => {
      const r = sel.SRLof(no)
      o[no] = { no, dept: r?.dept || '', est: r?.est || '', n: g[no].length, p: prog ? prog(no) : null,
        late: !!(r?.est && r.est < TODAY) }
    })
    return o
  }, [g, sel, prog])
  const depts = useMemo(() => [...new Set(Object.values(meta).map(m => m.dept).filter(Boolean))].sort(), [meta])
  const lateN = useMemo(() => Object.values(meta).filter(m => m.late).length, [meta])
  // teks pencarian dibuat sekali, malas: hanya saat ada kata kunci pertama kali
  const q = useDeferredValue(f.q).trim().toLowerCase()
  const hay = useMemo(() => {
    if (!q) return null
    const h = {}
    Object.keys(meta).forEach(no => {
      h[no] = (no + ' ' + meta[no].dept + ' ' + g[no].map(x => sel.mi(x.kode)?.n || '').join(' ')).toLowerCase()
    })
    return h
  }, [!!q, meta, g, sel]) // eslint-disable-line react-hooks/exhaustive-deps
  const cmp = {
    est: (a, b) => ((a.est || '9') < (b.est || '9') ? -1 : (a.est || '9') > (b.est || '9') ? 1 : a.no < b.no ? -1 : 1),
    new: (a, b) => (a.no < b.no ? 1 : -1),
    big: (a, b) => b.n - a.n || (a.no < b.no ? -1 : 1),
  }[f.sort]
  const list = useMemo(
    () => Object.values(meta).filter(m => (!q || !hay || hay[m.no].includes(q)) && (!f.dept || m.dept == f.dept) && (!f.late || m.late)).sort(cmp),
    [meta, hay, q, f.dept, f.late, f.sort], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Enter di kolom cari: cari dari teks TERAKHIR (pemindai barcode mengetik lalu Enter dalam milidetik,
  // sebelum daftar tertunda sempat diperbarui). Nomor yang persis sama didahulukan.
  const pickFirst = txt => {
    const t = txt.trim().toLowerCase()
    const hit = Object.values(meta).filter(m =>
      (!t || (m.no + ' ' + m.dept + ' ' + g[m.no].map(x => sel.mi(x.kode)?.n || '').join(' ')).toLowerCase().includes(t)) &&
      (!f.dept || m.dept == f.dept) && (!f.late || m.late))
    return hit.find(m => m.no.toLowerCase() == t) || hit.sort(cmp)[0]
  }
  const nos = list.map(m => m.no)
  const cur = nos.includes(f.pick) ? f.pick : nos[0]
  const idx = nos.indexOf(cur)
  const go = no => { set({ pick: no, open: false }); goDetail() }
  const reset = () => set({ q: '', dept: '', late: false })
  const active = !!(f.q.trim() || f.dept || f.late)
  return { list, cur, idx, prev: nos[idx - 1], next: nos[idx + 1], go, f, set, depts, lateN, total: Object.keys(g).length, active, reset, pickFirst }
}

// Daftar gulir tervirtualisasi: ribuan SRL tetap mulus karena hanya baris yang terlihat yang dirender.
const ROW = 72 // tinggi tetap satu baris (termasuk jarak)
const VIEW = 432 // tinggi jendela daftar (6 baris)
const OVER = 4 // baris cadangan di atas/bawah agar tidak berkedip saat menggulir cepat

function SrlList({ list, cur, go, unit, resetKey }) {
  const box = useRef(null)
  const raf = useRef(0)
  const [top, setTop] = useState(0)
  const h = Math.min(VIEW, list.length * ROW)
  const ci = list.findIndex(m => m.no == cur)
  const a = Math.max(0, Math.floor(top / ROW) - OVER)
  const z = Math.min(list.length, Math.ceil((top + h) / ROW) + OVER)

  // filter/urutan berubah: kembali ke atas. Data berubah (mis. selesai catat): posisi gulir dipertahankan.
  useEffect(() => { if (box.current) box.current.scrollTop = 0; setTop(0) }, [resetKey])
  // baris terpilih (mis. lewat tombol sebelum/berikutnya atau panah) selalu terlihat
  useEffect(() => {
    const el = box.current
    if (!el || ci < 0) return
    const y = ci * ROW
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + ROW > el.scrollTop + h) el.scrollTop = y + ROW - h
  }, [ci, h])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const onScroll = e => {
    const t = e.currentTarget.scrollTop
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => setTop(t))
  }
  const onKey = e => {
    const d = { ArrowDown: 1, ArrowUp: -1, PageDown: 6, PageUp: -6 }[e.key]
    const to = d ? Math.min(list.length - 1, Math.max(0, (ci < 0 ? 0 : ci) + d)) : e.key == 'Home' ? 0 : e.key == 'End' ? list.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    go(list[to].no)
    requestAnimationFrame(() => box.current?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }))
  }

  return (
    <div ref={box} role="listbox" aria-label="Daftar SRL" className="pk-vl" style={{ height: h }} onScroll={onScroll} onKeyDown={onKey}>
      <div style={{ height: list.length * ROW, position: 'relative' }}>
        {list.slice(a, z).map((m, k) => (
          <button
            key={m.no} role="option" aria-selected={m.no == cur} aria-setsize={list.length} aria-posinset={a + k + 1} tabIndex={m.no == cur || (ci < 0 && a + k == 0) ? 0 : -1}
            className={'pk-row' + (m.no == cur ? ' on' : '')} style={{ top: (a + k) * ROW }} onClick={() => go(m.no)}
          >
            <span className="pk-l">
              <b>{m.no}</b>
              <small className="mut">{m.dept || '-'}, est. {D(m.est)}</small>
              {m.p ? <span className="pbar" aria-hidden="true"><i style={{ width: m.p.pct + '%' }} /></span> : null}
            </span>
            <span className="pk-r">
              {m.late ? <Pill t="t-bad">Terlambat</Pill> : null}
              <small className="mut">{m.n} {unit}{m.p ? ', ' + m.p.pct + '%' : ''}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function SrlPicker({ list, cur, idx, prev, next, go, f, set, depts, lateN, total, active, reset, pickFirst, unit = 'barang' }) {
  if (!total) return null
  const fold = total > 5 // SRL sedikit: cukup daftar saja, tanpa cari, filter, dan lipat
  const c = list.find(m => m.no == cur)
  const hide = fold && !f.open && !!c
  return (
    <div className="f srlpick" style={{ gridColumn: '1/-1' }}>
      {fold && c && (
        <div className="pk-cur">
          <button className="pk-nav" disabled={!prev} onClick={() => go(prev)} aria-label="SRL sebelumnya">‹</button>
          <button className="pk-main" aria-expanded={f.open} onClick={() => set({ open: !f.open })}>
            <small>SRL {idx + 1} dari {list.length}{list.length < total ? ' (terfilter)' : ''}</small>
            <b>{c.no}</b>
            <small>{c.dept || '-'}, est. {D(c.est)}, {c.n} {unit}{c.late ? ', terlambat' : ''}</small>
            <span className="pk-chg">{f.open ? 'Tutup daftar' : 'Cari / ganti SRL'}</span>
          </button>
          <button className="pk-nav" disabled={!next} onClick={() => go(next)} aria-label="SRL berikutnya">›</button>
        </div>
      )}
      <div className={'pk-body' + (hide ? ' pk-hide' : '')}>
        {fold && (
          <>
            <label>Cari SRL
              <input
                type="search" value={f.q} placeholder="No. SRL, departemen, atau nama barang. Enter = buka" enterKeyHint="go"
                autoFocus={typeof window != 'undefined' && window.innerWidth >= 1024}
                onChange={e => set({ q: e.target.value })}
                onKeyDown={e => {
                  if (e.key != 'Enter') return
                  e.preventDefault()
                  const m = pickFirst ? pickFirst(e.currentTarget.value) : list[0]
                  if (m) { go(m.no); fokusJumlah() }
                }}
              />
            </label>
            <div className="grid" style={{ marginTop: 0 }}>
              <label>Departemen
                <select value={f.dept} onChange={e => set({ dept: e.target.value })}>
                  <option value="">Semua</option>
                  {depts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>Urutkan
                <select value={f.sort} onChange={e => set({ sort: e.target.value })}>
                  {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
          </>
        )}
        <div className="chips" style={{ marginTop: 0, alignItems: 'center' }}>
          {fold && lateN > 0 && (
            <button className="chip" aria-pressed={f.late} onClick={() => set({ late: !f.late })}>Terlambat ({lateN})</button>
          )}
          <small className="mut">{list.length == total ? total + ' SRL' : list.length + ' dari ' + total + ' SRL'}</small>
          {fold && active && <button className="lnk" onClick={reset}>Hapus filter</button>}
        </div>
        {list.length ? (
          <SrlList list={list} cur={cur} go={go} unit={unit} resetKey={f.q + '|' + f.dept + '|' + f.late + '|' + f.sort} />
        ) : (
          <div className="empty">Tidak ada SRL yang cocok. Ubah kata kunci atau filter.</div>
        )}
      </div>
    </div>
  )
}

// Kepala SRL terpilih (menempel di atas saat menggulir di HP & desktop). children = tombol aksi massal.
export function SrlHead({ no, s, pct, sub, children }) {
  const late = !!(s?.est && s.est < TODAY)
  return (
    <>
      <div className="srlhd" id="srl-detail">
        <div className="srlhd-t">
          <span><b>{no}</b> <small className="mut">{s ? s.dept + ', est. ' + D(s.est) : ''}</small></span>
          {late ? <Pill t="t-bad">Terlambat</Pill> : null}
        </div>
        {pct != null ? <div className="pbar" role="progressbar" aria-label={'Progres ' + no} aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: pct + '%' }} /></div> : null}
        {sub ? <small className="mut">{sub}</small> : null}
      </div>
      {children ? <div className="srlact">{children}</div> : null}
    </>
  )
}

// Daftar bertahap untuk tabel/daftar panjang. Mengembalikan [baris tampil, tombol "tampilkan lagi"].
export function useMore(list, step = 15) {
  const [n, setN] = useState(step)
  useEffect(() => setN(step), [list.length, step])
  const left = list.length - n
  const btn = left > 0 ? (
    <div style={{ gridColumn: '1/-1', marginTop: 8 }}>
      <button className="btn alt" style={{ width: '100%' }} onClick={() => setN(n + step)}>
        Tampilkan {Math.min(step, left)} lagi ({left} tersisa)
      </button>
    </div>
  ) : null
  return [list.slice(0, n), btn]
}
