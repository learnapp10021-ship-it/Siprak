import { memo } from 'react'

// Tiap layar dimuat sebagai kode terpisah, hanya saat dibutuhkan (layar masuk tidak perlu memuat layar semua peran).
// - Bila modul sudah dimuat, layar dirender sinkron (tanpa kedip); bila belum, <Suspense> menahan layar lama.
// - preload() dipanggil saat senggang (dan saat menu disentuh) sehingga pindah tab terasa instan.
// - Gagal memuat (mis. berkas lama sudah diganti setelah deploy baru): muat ulang halaman satu kali untuk mengambil versi terbaru.
function lazyView(load, pick) {
  let C = null
  let p = null
  let err = null
  const preload = () =>
    (p =
      p ||
      load().then(
        m => {
          C = pick(m)
          try { sessionStorage.removeItem('siprak-chunk-reload') } catch (e) {}
        },
        e => {
          p = null
          err = e
          try {
            if (!sessionStorage.getItem('siprak-chunk-reload')) {
              sessionStorage.setItem('siprak-chunk-reload', '1')
              location.reload()
            }
          } catch (e2) {}
        }
      ))
  const View = props => {
    if (err) throw err
    if (!C) throw preload()
    return <C {...props} />
  }
  const M = memo(View) // berubahnya status simpan/toast di Shell tidak menggambar ulang daftar yang berat
  M.preload = preload
  return M
}

export const VIEWS = {
  dash: lazyView(() => import('./DashboardView'), m => m.VDash),
  allr: lazyView(() => import('./AdminDeptViews'), m => m.VAll),
  pool: lazyView(() => import('./AdminDeptViews'), m => m.VPool),
  kon: lazyView(() => import('./AdminDeptViews'), m => m.VKon),
  usr: lazyView(() => import('./UsersView'), m => m.VUsr),
  req: lazyView(() => import('./UserViews'), m => m.VReq),
  new: lazyView(() => import('./UserViews'), m => m.VNew),
  his: lazyView(() => import('./HistoriView'), m => m.VHis),
  appr: lazyView(() => import('./AtasanViews'), m => m.VAppr),
  tim: lazyView(() => import('./AtasanViews'), m => m.VTim),
  dtg: lazyView(() => import('./WarehouseViews'), m => m.VDtg),
  srh: lazyView(() => import('./WarehouseViews'), m => m.VSrh),
  mst: lazyView(() => import('./MasterView'), m => m.VMst),
  val: lazyView(() => import('./ValidasiView'), m => m.VVal),
}

export const preloadTabs = tabs => Promise.all(tabs.map(k => VIEWS[k]?.preload()))
export const preloadAll = () => preloadTabs(Object.keys(VIEWS))
