import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { D, TODAY, addDays } from '../lib/utils'

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

export function ItemCard({ it }) {
  const { sel, db } = useApp()
  const m = sel.mi(it.kode)
  const [g, t, l] = sel.st(it)
  const dead = g < 0
  const pct = sel.progress(it)
  const ss = db.SR.filter(s => s.item == it.id)
  const k = sel.KN(it.kon)
  const srl = k && sel.SRLof(k.srl)
  const q = sel.antrian(it)
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

  return (
    <div className="item itm">
      <div className="itm-top">
        <Ring pct={pct} tone={t} dead={dead} wait={wait} />
        <div className="itm-main">
          <div className="between"><b>{m.n}</b><span className="itm-q">{it.qty} {m.sat}</span></div>
          <div className={`lbl ${t}`}>{l}</div>
        </div>
      </div>
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
  )
}

const TONE = { Draft: 't-gray', 'Menunggu Approval': 't-warn', Disetujui: 't-ok', Ditolak: 't-bad', Dibatalkan: 't-gray' }

// mode: 'own' (milik sendiri), 'appr' (untuk atasan menyetujui), 'tim' (hanya lihat)
export function ReqCard({ r, mode }) {
  const { db, sel, act } = useApp()
  const [cat, setCat] = useState('')
  const its = db.I.filter(i => i.req == r.id)
  return (
    <div className="row">
      <div className="between">
        <div><b>{r.id}</b> <small>{D(r.tgl)}{mode != 'own' ? ', ' + sel.nm(r.by) : ''}</small></div>
        <Pill t={TONE[r.st]}>{r.st}</Pill>
      </div>
      {r.cat ? <small className="mut">Catatan atasan: {r.cat}</small> : null}
      {its.map(i => <ItemCard key={i.id} it={i} />)}
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
}

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

// Pemilih SRL untuk jumlah banyak (ratusan SRL): cari (juga lewat tombol "/"), chip filter dengan jumlah
// (terlambat, hari ini, 7 hari ke depan, belum mulai, sebagian), urutkan, daftar bertahap, panah atas/bawah di
// kolom cari untuk pindah SRL, dan otomatis lanjut ke SRL berikutnya saat yang dikerjakan selesai.
// HP: satu kartu "SRL aktif" + tombol sebelumnya/berikutnya; daftar dibuka lewat "Cari / ganti SRL".
// Desktop: daftar selalu tampil di kolom kiri.
// g = { [noSRL]: [item, ...] }. SRL teratas hasil filter otomatis terpilih.
// prog(no) opsional -> { pct, text } untuk bilah progres dan filter progres.
// key opsional: nama untuk mengingat pencarian dan filter selama sesi (sessionStorage), mis. saat pindah tab.
const PAGE = 20
const SORTS = { est: 'Estimasi terdekat', new: 'SRL terbaru', big: 'Barang terbanyak', prog: 'Progres terendah' }
const FKEYS = ['q', 'dept', 'when', 'prg', 'sort']
const BLANK = { pick: '', q: '', dept: '', when: '', prg: '', sort: 'est', lim: PAGE, open: false }

const readPk = key => {
  if (!key) return {}
  try {
    const v = JSON.parse(sessionStorage.getItem('siprak.pk.' + key))
    if (!v || typeof v != 'object') return {}
    const o = {}
    FKEYS.forEach(k => {
      if (typeof v[k] == 'string' && (k != 'sort' || SORTS[v[k]])) o[k] = v[k]
    })
    return o
  } catch { return {} }
}
const writePk = (key, f) => {
  if (!key) return
  try { sessionStorage.setItem('siprak.pk.' + key, JSON.stringify(Object.fromEntries(FKEYS.map(k => [k, f[k]])))) } catch { /* mode privat: abaikan */ }
}

function goDetail() {
  if (typeof window == 'undefined' || window.innerWidth >= 1024) return
  const sm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  requestAnimationFrame(() => document.getElementById('srl-detail')?.scrollIntoView({ block: 'start', behavior: sm }))
}

export function useSrlPick(g, sel, prog, key) {
  const [f, setF] = useState(() => ({ ...BLANK, ...readPk(key) }))
  const last = useRef(0)
  useEffect(() => writePk(key, f), [key, f.q, f.dept, f.when, f.prg, f.sort]) // eslint-disable-line react-hooks/exhaustive-deps
  // Mengubah cari/filter/urutan kembali ke SRL teratas hasilnya dan panjang daftar awal; pindah, buka-tutup, dan tampilkan lagi tidak.
  const set = p => setF(x => ({ ...x, ...(FKEYS.some(k => k in p) ? { pick: '', lim: PAGE } : {}), ...p }))
  const t7 = addDays(TODAY, 7)
  const meta = {}
  Object.keys(g).forEach(no => {
    const r = sel.SRLof(no)
    const names = g[no].map(x => (sel.mi(x.kode)?.n || '') + ' ' + (x.kode || '')).join(' ')
    const est = r?.est || ''
    meta[no] = {
      no, dept: r?.dept || '', est, n: g[no].length, p: prog ? prog(no) : null,
      late: !!(est && est < TODAY), today: est == TODAY, week: !!(est && est >= TODAY && est <= t7),
      hay: (no + ' ' + (r?.dept || '') + ' ' + names).toLowerCase(),
    }
  })
  const all = Object.values(meta)
  const depts = [...new Set(all.map(m => m.dept).filter(Boolean))].sort()
  const q = f.q.trim().toLowerCase()
  const e9 = m => m.est || '9'
  const cmp = {
    est: (a, b) => (e9(a) < e9(b) ? -1 : e9(a) > e9(b) ? 1 : a.no < b.no ? -1 : 1),
    new: (a, b) => (a.no < b.no ? 1 : -1),
    big: (a, b) => b.n - a.n || (a.no < b.no ? -1 : 1),
    prog: (a, b) => (a.p?.pct ?? 0) - (b.p?.pct ?? 0) || (e9(a) < e9(b) ? -1 : e9(a) > e9(b) ? 1 : a.no < b.no ? -1 : 1),
  }[f.sort]
  const zero = m => !!m.p && m.p.pct === 0
  const part = m => !!m.p && m.p.pct > 0 && m.p.pct < 100
  const list = all
    .filter(m => (!q || m.hay.includes(q)) && (!f.dept || m.dept == f.dept) && (!f.when || m[f.when]) && (!f.prg || (f.prg == 'zero' ? zero(m) : part(m))))
    .sort(cmp)
  const nos = list.map(m => m.no)
  // SRL yang sedang dikerjakan selesai (hilang dari daftar): lanjut ke SRL di posisi yang sama, bukan loncat ke paling atas
  const cur = nos.includes(f.pick) ? f.pick : f.pick ? nos[Math.min(last.current, nos.length - 1)] : nos[0]
  const idx = nos.indexOf(cur)
  useEffect(() => { if (idx >= 0) last.current = idx })
  const cnt = {
    late: all.filter(m => m.late).length, today: all.filter(m => m.today).length, week: all.filter(m => m.week).length,
    zero: all.filter(zero).length, part: all.filter(part).length,
  }
  const go = no => { set({ pick: no, open: false }); goDetail() }
  // pindah SRL lewat keyboard: tanpa menutup daftar dan tanpa menggulir halaman; daftar diperpanjang bila perlu
  const move = no => setF(x => ({ ...x, pick: no, lim: Math.max(x.lim, nos.indexOf(no) + 6) }))
  const reset = () => set({ q: '', dept: '', when: '', prg: '' })
  const active = !!(q || f.dept || f.when || f.prg)
  return { list, cur, idx, prev: nos[idx - 1], next: nos[idx + 1], go, move, f, set, depts, cnt, hasProg: !!prog, lateN: cnt.late, total: all.length, active, reset }
}

export function SrlPicker({ list, cur, idx, prev, next, go, move, f, set, depts, cnt, hasProg, total, active, reset, unit = 'barang' }) {
  const box = useRef()
  // "/" memindahkan fokus ke kolom cari (seperti di banyak aplikasi web), kecuali sedang mengetik
  useEffect(() => {
    if (!total) return
    const h = e => {
      if (e.key != '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      const el = box.current?.querySelector('input[type=search]')
      if (el) { e.preventDefault(); set({ open: true }); el.focus() }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [total]) // eslint-disable-line react-hooks/exhaustive-deps
  // SRL terpilih lewat keyboard harus tetap terlihat di daftar
  useEffect(() => { box.current?.querySelector('.pk-row.on')?.scrollIntoView?.({ block: 'nearest' }) }, [cur])
  if (!total) return null
  const vis = list.slice(0, f.lim)
  const rest = list.length - vis.length
  const fold = total > 5 // SRL sedikit: cukup daftar saja, tanpa cari, filter, dan lipat
  const c = list.find(m => m.no == cur)
  const hide = fold && !f.open && !!c
  const onKey = e => {
    if (e.key == 'ArrowDown' && next) { e.preventDefault(); move(next) }
    else if (e.key == 'ArrowUp' && prev) { e.preventDefault(); move(prev) }
    else if (e.key == 'Enter' && cur) {
      e.preventDefault()
      go(cur)
      requestAnimationFrame(() => document.querySelector('[data-first-input]')?.focus())
    } else if (e.key == 'Escape' && f.q) { e.stopPropagation(); set({ q: '' }) }
  }
  const chip = (k, v, label, n) =>
    n > 0 || f[k] == v ? (
      <button key={v} className="chip" aria-pressed={f[k] == v} onClick={() => set({ [k]: f[k] == v ? '' : v })}>{label} ({n})</button>
    ) : null
  return (
    <div className="f srlpick" style={{ gridColumn: '1/-1' }} ref={box}>
      {fold && (
        <div className="pk-tools">
          <label>Cari SRL
            <input type="search" value={f.q} placeholder="No. SRL, departemen, atau barang (tekan / untuk mencari)" aria-keyshortcuts="/"
              onChange={e => set({ q: e.target.value, open: true })} onKeyDown={onKey} />
          </label>
          <div className="chips" role="group" aria-label="Filter SRL" style={{ marginTop: 0, alignItems: 'center' }}>
            {chip('when', 'late', 'Terlambat', cnt.late)}
            {chip('when', 'today', 'Hari ini', cnt.today)}
            {chip('when', 'week', '7 hari ke depan', cnt.week)}
            {hasProg && chip('prg', 'zero', 'Belum mulai', cnt.zero)}
            {hasProg && chip('prg', 'part', 'Sebagian', cnt.part)}
            {active && <button className="lnk" onClick={reset}>Hapus filter</button>}
          </div>
          <small className="mut pk-keys">Di kolom cari: panah atas/bawah pindah SRL, Enter mulai mencatat.</small>
        </div>
      )}
      {fold && c && (
        <div className="pk-cur">
          <button className="pk-nav" disabled={!prev} onClick={() => go(prev)} aria-label="SRL sebelumnya">‹</button>
          <button className="pk-main" aria-expanded={f.open} onClick={() => set({ open: !f.open })}>
            <small>SRL {idx + 1} dari {list.length}{list.length < total ? ' (terfilter)' : ''}</small>
            <b>{c.no}</b>
            <small>{c.dept || '-'}, est. {D(c.est)}, {c.n} {unit}{c.late ? ', terlambat' : ''}</small>
            <span className="pk-chg">{f.open ? 'Tutup daftar' : 'Lihat daftar SRL'}</span>
          </button>
          <button className="pk-nav" disabled={!next} onClick={() => go(next)} aria-label="SRL berikutnya">›</button>
        </div>
      )}
      <div className={'pk-body' + (hide ? ' pk-hide' : '')}>
        {fold && (
          <div className="grid" style={{ marginTop: 0 }}>
            <label>Departemen
              <select value={f.dept} onChange={e => set({ dept: e.target.value })}>
                <option value="">Semua</option>
                {depts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label>Urutkan
              <select value={f.sort} onChange={e => set({ sort: e.target.value })}>
                {Object.entries(SORTS).filter(([k]) => k != 'prog' || hasProg).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
        )}
        <small className="mut">{list.length == total ? total + ' SRL' : list.length + ' dari ' + total + ' SRL'}</small>
        {list.length ? (
          <>
            <div role="listbox" aria-label="Daftar SRL">
              {vis.map(m => (
                <button key={m.no} role="option" aria-selected={m.no == cur} className={'pk-row' + (m.no == cur ? ' on' : '')} onClick={() => go(m.no)}>
                  <span className="pk-l">
                    <b>{m.no}</b>
                    <small className="mut">{m.dept || '-'}, est. {D(m.est)}</small>
                    {m.p ? <span className="pbar" aria-hidden="true"><i style={{ width: m.p.pct + '%' }} /></span> : null}
                  </span>
                  <span className="pk-r">
                    {m.late ? <Pill t="t-bad">Terlambat</Pill> : m.today ? <Pill t="t-warn">Hari ini</Pill> : null}
                    <small className="mut">{m.n} {unit}</small>
                    {m.p ? <small className="mut">{m.p.text}</small> : null}
                  </span>
                </button>
              ))}
            </div>
            {rest > 0 && (
              <div className="acts" style={{ marginTop: 0, alignItems: 'center' }}>
                <button className="btn alt grow" onClick={() => set({ lim: f.lim + PAGE })}>
                  Tampilkan {Math.min(PAGE, rest)} lagi ({rest} tersisa)
                </button>
                {rest > PAGE * 2 && <button className="lnk" onClick={() => set({ lim: list.length })}>Tampilkan semua</button>}
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            Tidak ada SRL yang cocok. Ubah kata kunci atau filter.
            {active ? <div className="acts" style={{ justifyContent: 'center' }}><button className="btn alt" onClick={reset}>Hapus filter</button></div> : null}
          </div>
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
