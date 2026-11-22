import { useState } from 'react'
import { useApp } from '../store'
import { Hd, Empty, Confirm, SrlPicker, SrlHead, useSrlPick } from '../components/ui'
import { D, sum } from '../lib/utils'

// Keluarkan satu atau beberapa baris barang dari SRL; alasan wajib, barang kembali ke Pool Admin Dept.
function TakeOut({ ids, label = 'Keluarkan dari SRL' }) {
  const { me, act } = useApp()
  const [open, setOpen] = useState(false)
  const [a, setA] = useState('')
  const close = () => { setOpen(false); setA('') }
  if (!open) return <button className="lnk" onClick={() => setOpen(true)}>{label}</button>
  const go = () => { if (act('keluarkan', { ids, alasan: a.trim(), by: me.n })) close() }
  return (
    <div className="f">
      <label>Alasan dikeluarkan (wajib)
        <input autoFocus value={a} onChange={e => setA(e.target.value)} placeholder="Contoh: salah artikel, stok masih ada" />
      </label>
      <div className="acts">
        <button className="btn bad grow" disabled={!a.trim()} onClick={go}>Keluarkan{ids.length > 1 ? ` ${ids.length} baris` : ''}</button>
        <button className="btn alt" onClick={close}>Batal</button>
      </div>
    </div>
  )
}

function ValSrl({ no, items }) {
  const { sel, me, act } = useApp()
  const [q, setQ] = useState('')
  const key = q.trim().toLowerCase()
  const ks = new Map()
  items.forEach(i => { if (!ks.has(i.kon)) ks.set(i.kon, []); ks.get(i.kon).push(i) })
  const groups = [...ks.entries()].filter(([, a]) => !key || (sel.mi(a[0].kode).n + ' ' + a[0].kode).toLowerCase().includes(key))
  const k0 = sel.KN(items[0].kon)
  return (
    <>
      <SrlHead no={no} s={sel.SRLof(no)} sub={`${ks.size} barang, ${items.length} request. Dibuat ${k0?.by ? sel.nm(k0.by) : '-'} (${k0?.dept || '-'}).`}>
        <Confirm className="btn" onConfirm={() => act('validasiSrl', no, me.n)}>Validasi SRL ({ks.size} barang)</Confirm>
      </SrlHead>
      {ks.size > 6 && (
        <div className="f itemq">
          <label>Cari barang di SRL ini
            <input type="search" value={q} placeholder="Nama barang atau kode" onChange={e => setQ(e.target.value)} />
          </label>
        </div>
      )}
      {groups.map(([kid, a]) => {
        const m = sel.mi(a[0].kode)
        return (
          <div className="row" key={kid}>
            <div className="between"><b>{m.n}</b><span>{sum(a, i => i.qty)} {m.sat}</span></div>
            <small className="mut">{m.k}, {a.length} request, {m.buf == '1' ? 'buffer' : 'non buffer'}</small>
            {a.map(i => {
              const r = sel.RQ(i.req)
              return (
                <div className="item" key={i.id}>
                  <div className="between"><span>{sel.nm(r.by)} <small className="mut">{sel.user(r.by).dept}</small></span><b>{i.qty} {m.sat}</b></div>
                  <small className="mut">{i.req}, datang {D(i.datang)}, pakai {D(i.pakai)}</small>
                  <TakeOut ids={[i.id]} />
                </div>
              )
            })}
            {a.length > 1 && <TakeOut ids={a.map(i => i.id)} label="Keluarkan semua baris barang ini" />}
          </div>
        )
      })}
      {key && !groups.length ? <Empty>Tidak ada barang yang cocok dengan "{q.trim()}".</Empty> : null}
    </>
  )
}

export function VVal() {
  const { db, sel } = useApp()
  const l = db.I.filter(i => i.status == 'Validasi Warehouse').sort(sel.ord)
  const g = {}
  l.forEach(i => {
    const no = sel.KN(i.kon)?.srl || '-'
    ;(g[no] = g[no] || []).push(i)
  })
  const pk = useSrlPick(g, sel)
  return (
    <>
      <Hd t="Validasi SRL" s="Periksa barang di SRL dari Admin Dept. Keluarkan yang tidak sesuai, lalu validasi." />
      {l.length ? (
        <>
          <SrlPicker {...pk} />
          {pk.cur ? <ValSrl key={pk.cur} no={pk.cur} items={g[pk.cur]} /> : null}
        </>
      ) : (
        <Empty>Tidak ada SRL yang menunggu validasi.</Empty>
      )}
    </>
  )
}
