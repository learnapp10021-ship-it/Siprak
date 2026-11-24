import { Suspense, startTransition, useEffect, useMemo } from 'react'
import { AppProvider, TABS, useApp, useStatus } from './store'
import { ThemeSwitch } from './components/ThemeSwitch'
import { Drawer, UserSheet, PicSheet, DetailSheet, HelpSheet } from './components/Overlays'
import { SaveBar } from './components/SaveBar'
import { badgeCounts } from './lib/notes'
import { VIEWS, preloadTabs } from './views/registry'

// Menu bawah (HP/tablet) hanya untuk pekerjaan harian; menu lain ada di menu samping (hamburger). Desktop tetap menampilkan semua.
const BOTTOM = { 'Admin Warehouse': ['dtg', 'srh'], 'Admin Dept': ['pool', 'kon'], User: ['req', 'new'] }

export function Shell() {
  const { db, sel, ui, setUi, me } = useApp()
  const { toastS, sync, saving, dismissToast } = useStatus()
  const tabs = TABS[me.role]
  const tab = tabs.find(t => t[0] == ui.tab) ? ui.tab : BOTTOM[me.role]?.[0] || tabs[0][0]
  const View = VIEWS[tab]

  // badge menu hanya bergantung pada data (bukan pada ketikan di kotak pencarian)
  const cnt = useMemo(() => badgeCounts(db, sel, me), [db, sel, me.id, me.dept, me.role]) // eslint-disable-line react-hooks/exhaustive-deps

  const bottom = BOTTOM[me.role]
  const hidden = k => (bottom && !bottom.includes(k) ? 'nv-x' : undefined)
  const hamCnt = bottom ? tabs.filter(t => !bottom.includes(t[0])).reduce((a, t) => a + (cnt[t[0]] || 0), 0) : 0

  // Setelah layar pertama tampil: muat kode semua tab peran ini saat browser senggang, sehingga pindah tab terasa instan.
  useEffect(() => {
    const keys = tabs.map(t => t[0])
    const ric = window.requestIdleCallback
    const h = ric ? ric(() => preloadTabs(keys), { timeout: 2500 }) : setTimeout(() => preloadTabs(keys), 800)
    return () => (ric ? window.cancelIdleCallback(h) : clearTimeout(h))
  }, [me.role]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pindah tab -> kembali ke atas. Esc menutup overlay.
  useEffect(() => { window.scrollTo(0, 0) }, [tab, ui.me])
  useEffect(() => {
    const h = e => {
      if (e.key !== 'Escape') return
      if (ui.di) setUi({ di: null })
      else if (ui.menu || ui.eu || ui.help || ui.dpic) setUi({ menu: false, eu: null, self: false, help: false, dpic: null })
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [ui.di, ui.menu, ui.eu, ui.help, ui.dpic, setUi])

  return (
    <>
      <SaveBar />
      <div id="app" className={saving ? 'saving' : undefined} aria-busy={saving ? 'true' : undefined}>
        <header>
          <button className="ham" onClick={() => setUi({ menu: true })} aria-label={hamCnt ? 'Buka menu, ' + hamCnt + ' menunggu' : 'Buka menu'} style={{ position: 'relative' }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h16M3 11h16M3 16h16" /></svg>
            {hamCnt ? <span className="bdg ham-bdg">{hamCnt}</span> : null}
          </button>
          <div style={{ flex: 1 }}><h1>Request barang</h1><small>{me.n}, {me.role}{me.role.endsWith(me.dept) ? '' : ' ' + me.dept}{sync.pending ? ' · menyimpan…' : sync.err ? ' · offline' : ''}</small></div>
          <div className="hd-tema"><ThemeSwitch /></div>
          <button className="ham" onClick={() => setUi({ help: true, menu: false })} aria-label="Cara pakai" style={{ margin: '0 -8px 0 0', fontSize: 20, fontWeight: 700 }}>?</button>
        </header>
        {ui.menu && <Drawer cnt={cnt} />}
        {ui.eu && <UserSheet key={ui.eu + ui.self} />}
        {ui.help && <HelpSheet />}
        {ui.dpic && <PicSheet />}
        {ui.di && <DetailSheet />}
        {/* Suspense di LUAR main yang ber-key: saat pindah tab, layar lama tetap tampil sampai layar baru siap */}
        <Suspense fallback={<main className="v-load" aria-busy="true" aria-label="Memuat tampilan"><div className="skel" /><div className="skel" /><div className="skel s" /></main>}>
          <main key={tab} className={'v-' + tab}><View /></main>
        </Suspense>
        <nav aria-label="Menu utama">
          {tabs.map(t => (
            <button
              key={t[0]} className={hidden(t[0])} aria-current={t[0] == tab ? 'true' : undefined}
              onPointerDown={() => VIEWS[t[0]]?.preload()} onClick={() => setUi({ tab: t[0], menu: false, eu: null })}
            >
              {t[1]}{cnt[t[0]] ? <span className="bdg" aria-label={cnt[t[0]] + ' menunggu'}>{cnt[t[0]]}</span> : null}
            </button>
          ))}
        </nav>
      </div>
      <div
        id="toast" role={toastS.kind == 'err' ? 'alert' : 'status'} aria-live={toastS.kind == 'err' ? 'assertive' : 'polite'}
        className={toastS.show ? 'show ' + toastS.kind : ''} onClick={dismissToast}
      >
        <span className="msg">{toastS.text}</span>
        {toastS.show ? <span className="tx" aria-hidden="true">ketuk untuk tutup</span> : null}
      </div>
    </>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
