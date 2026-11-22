import { useApp } from '../store'
import { Hd, Empty, ReqCard, Confirm } from '../components/ui'

export function VAppr() {
  const { db, sel, me, act } = useApp()
  const l = db.R.filter(r => r.st == 'Menunggu Approval' && me.id == sel.user(r.by)?.boss)
  return (
    <>
      <Hd t="Perlu disetujui" s={l.length + ' request menunggu keputusan Anda.'} />
      {l.length > 1 && (
        <div className="acts" style={{ gridColumn: '1/-1' }}>
          <Confirm className="btn grow" onConfirm={() => act('setujuAll', me.id, l.map(r => r.id))}>Setujui semua ({l.length})</Confirm>
        </div>
      )}
      {l.length ? l.map(r => <ReqCard key={r.id} r={r} mode="appr" />) : <Empty>Tidak ada request yang menunggu.</Empty>}
    </>
  )
}

export function VTim() {
  const { db, sel, ui } = useApp()
  const l = db.R.filter(r => sel.user(r.by)?.boss == ui.me && r.st != 'Draft').sort((a, b) => (b.tgl < a.tgl ? -1 : 1))
  return (
    <>
      <Hd t="Request tim" s="Semua request anggota tim Anda." />
      {l.length ? l.map(r => <ReqCard key={r.id} r={r} mode="tim" />) : <Empty>Belum ada request dari tim.</Empty>}
    </>
  )
}
