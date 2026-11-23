import { memo, useDeferredValue, useId, useMemo, useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Pill, ItemCard, useMore } from '../components/ui'
import { useOwnRequests } from '../lib/useOwnRequests'
import { D, monthLabel } from '../lib/utils'

const KINDS = ['Selesai', 'Ditolak', 'Dibatalkan']
const TONE = { Selesai: 't-ok', Ditolak: 't-bad', Dibatalkan: 't-gray' }
const STEP = 20

const namesOf = (sel, id) => sel.itemsOf(id).map(i => sel.mi(i.kode)?.n || i.kode)
const brief = names => (names.length > 2 ? `${names[0]}, ${names[1]} +${names.length - 2}` : names.join(', ')) || 'Tanpa barang'

// Satu baris ringkas. Rincian barang baru digambar saat dibuka, jadi ratusan histori tetap ringan.
const HisRow = memo(function HisRow({ h }) {
  const { sel } = useApp()
  const [open, setOpen] = useState(false)
  const id = useId()
  const { r, end } = h
  return (
    <li className="his-row">
      <button className="his-sum" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        <span className="his-l">
          <b>{r.id}</b>
          <small className="mut">{D(r.tgl)} · {brief(namesOf(sel, r.id))}</small>
        </span>
        <span className="his-r">
          <Pill t={TONE[end]}>{end}</Pill>
          <i className="his-ch" aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div id={id} className="his-det">
          {r.cat ? <small className="mut">Catatan atasan: {r.cat}</small> : null}
          {sel.itemsOf(r.id).map(i => <ItemCard key={i.id} it={i} />)}
        </div>
      )}
    </li>
  )
})

export function VHis() {
  const { sel } = useApp()
  const { histori } = useOwnRequests()
  const [f, setF] = useState({ q: '', kind: '', ym: '' })
  const set = p => setF(x => ({ ...x, ...p }))

  const counts = useMemo(() => {
    const c = Object.fromEntries(KINDS.map(k => [k, 0]))
    for (const h of histori) c[h.end]++
    return c
  }, [histori])
  const months = useMemo(() => [...new Set(histori.map(h => h.ym).filter(Boolean))].sort().reverse(), [histori])

  // Teks pencarian dibuat malas: baru saat ada kata kunci, dan hanya ulang bila data berubah
  const q = useDeferredValue(f.q).trim().toLowerCase()
  const hay = useMemo(() => {
    if (!q) return null
    const o = new Map()
    for (const h of histori) o.set(h.r.id, (h.r.id + ' ' + namesOf(sel, h.r.id).join(' ')).toLowerCase())
    return o
  }, [!!q, histori, sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(
    () => histori.filter(h => (!f.kind || h.end == f.kind) && (!f.ym || h.ym == f.ym) && (!hay || hay.get(h.r.id).includes(q))),
    [histori, hay, q, f.kind, f.ym],
  )
  const [rows, more] = useMore(list, STEP)
  const filtered = !!(f.q.trim() || f.kind || f.ym)

  if (!histori.length)
    return (
      <>
        <Hd t="Histori" s="Request yang sudah selesai, ditolak, atau dibatalkan." />
        <Empty>Belum ada histori. Request yang sudah 100% selesai akan pindah ke sini.</Empty>
      </>
    )

  return (
    <>
      <Hd t="Histori" s="Request yang sudah selesai, ditolak, atau dibatalkan." />
      <div className="his-bar">
        <label>Cari request
          <input type="search" value={f.q} placeholder="No. request atau nama barang" onChange={e => set({ q: e.target.value })} />
        </label>
        <div className="chips" style={{ marginTop: 0 }}>
          {KINDS.filter(k => counts[k]).map(k => (
            <button key={k} className="chip" aria-pressed={f.kind == k} onClick={() => set({ kind: f.kind == k ? '' : k })}>
              {k} ({counts[k]})
            </button>
          ))}
        </div>
        {months.length > 1 && (
          <label>Bulan
            <select value={f.ym} onChange={e => set({ ym: e.target.value })}>
              <option value="">Semua bulan</option>
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="mut his-cnt" role="status">
        {filtered ? `${list.length} dari ${histori.length} request` : `${histori.length} request`}
        {filtered && <> · <button className="lnk" onClick={() => setF({ q: '', kind: '', ym: '' })}>Hapus filter</button></>}
      </p>
      {list.length ? (
        <ul className="his" aria-label="Daftar histori request">
          {rows.map(h => <HisRow key={h.r.id} h={h} />)}
        </ul>
      ) : (
        <Empty>Tidak ada request yang cocok. Ubah kata kunci atau filter.</Empty>
      )}
      {more}
    </>
  )
}
