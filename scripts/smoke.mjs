// Tes asap: me-render setiap layar untuk setiap peran + dialog, agar galat runtime (variabel hilang, data tak lengkap) ketahuan.
// `npm run smoke`
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { AppProvider, TABS } from '../src/store.jsx'
import { Shell } from '../src/App.jsx'
import { buildSeed } from '../src/data/seed.js'

let pass = 0, fail = 0
const render = (label, ui) => {
  try {
    const html = renderToString(h(AppProvider, { initialUi: ui }, h(Shell)))
    if (!html || html.length < 200) throw new Error('keluaran kosong')
    pass++
  } catch (e) {
    fail++
    console.log('  GAGAL:', label, '->', e.message.split('\n')[0])
  }
}

render('layar login', {})

const db = buildSeed()
const roleUser = Object.fromEntries(db.U.map(u => [u.role, u.id]))
for (const u of db.U) {
  const tabs = TABS[u.role]
  for (const [tab] of tabs) render(`${u.id} / ${tab}`, { me: u.id, tab })
  render(`${u.id} / menu`, { me: u.id, tab: tabs[0][0], menu: true })
  render(`${u.id} / bantuan`, { me: u.id, tab: tabs[0][0], help: true })
  render(`${u.id} / profil`, { me: u.id, tab: tabs[0][0], eu: u.id, self: true })
}
// Dialog dengan data: tambah/ubah pengguna, detail barang (tiap status), PIC
const admin = roleUser['Admin Dept'], wh = roleUser['Admin Warehouse'], spv = roleUser['Spv Warehouse']
render('tambah pengguna (Admin Dept)', { me: admin, tab: 'usr', eu: 'new' })
render('ubah pengguna (Admin Warehouse)', { me: wh, tab: 'usr', eu: 'andi.prod' })
for (const i of db.I) render(`detail ${i.id} (${i.status})`, { me: spv, tab: 'dash', di: i.id })
for (const u of db.U.filter(x => x.role === 'User')) render(`PIC ${u.id}`, { me: wh, tab: 'srh', dpic: u.id })
render('ganti password', { me: wh, tab: 'dtg', pw: true })
// Dashboard: tiap periode
for (const dp of ['w0', 'w1']) render('dashboard ' + dp, { me: spv, tab: 'dash', dp })

console.log(`${pass} layar OK, ${fail} gagal`)
process.exit(fail ? 1 : 0)
