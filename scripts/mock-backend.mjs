// Backend tiruan LOKAL untuk uji coba tanpa Google. Menjalankan backend/dist/Code.gs ASLI di atas Sheets tiruan
// di memori, dilayani lewat HTTP seperti Web App Apps Script. Bukan untuk produksi.
//
//   node scripts/mock-backend.mjs --demo                 # data contoh (seedDemo)
//   node scripts/mock-backend.mjs --users users.json     # mulai kosong + pengguna awal [[id,nama,dept,role,atasan,hp],...]
//   node scripts/mock-backend.mjs --demo --port 4180
//   lalu: VITE_API_URL=http://127.0.0.1:4180/exec npm run build  (atau npm run dev)
//
// Endpoint bantu uji: /__rows?sheet=Users, /__audit, /__net?mode=ok|down|slow (simulasi koneksi buruk).
import http from 'node:http'
import fs from 'node:fs'
import { createBackend } from '../backend/test/mock-gas.mjs'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]) }
const port = +arg('port', 4180)
const { env, ctx } = createBackend()
ctx.setup()
if (arg('demo', false)) ctx.seedDemo()
const uf = arg('users', '')
if (uf && uf !== true) {
  const us = JSON.parse(fs.readFileSync(uf, 'utf8'))
  const sh = env.sheets.get('Users')
  us.forEach((u, i) => { sh.cells[i + 1] = [...u, '', '', ''] }) // diketik manual: off, _v, tx kosong
}
let net = 'ok'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { ...cors, 'Content-Type': type + '; charset=utf-8' }); res.end(body) }
const rows = name => { const sh = env.sheets.get(name); const h = sh.cells[0]; return sh.cells.slice(1).filter(r => r && r[0] !== '' && r[0] !== undefined).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]]))) }

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') return send(res, 204, '')
  if (u.pathname === '/__net') { net = u.searchParams.get('mode') || 'ok'; return send(res, 200, JSON.stringify({ net })) }
  if (u.pathname === '/__audit') return send(res, 200, JSON.stringify({ audit: ctx.auditData() }))
  if (u.pathname === '/__rows') return send(res, 200, JSON.stringify(rows(u.searchParams.get('sheet'))))
  if (u.pathname !== '/exec') return send(res, 404, '{}')
  if (net === 'down') return req.socket.destroy() // seolah koneksi terputus
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    const run = () => {
      try {
        const out = req.method === 'POST'
          ? ctx.doPost({ postData: { contents: body } })
          : ctx.doGet({ parameter: Object.fromEntries(u.searchParams) })
        send(res, 200, out.getContent())
      } catch (e) { send(res, 500, JSON.stringify({ ok: false, err: String(e.message || e) })) }
    }
    net === 'slow' ? setTimeout(run, 4000) : run()
  })
}).listen(port, '127.0.0.1', () => console.log(`Backend tiruan siap: http://127.0.0.1:${port}/exec` + (arg('demo', false) ? ' (data contoh)' : uf ? ' (mulai kosong + pengguna awal)' : ' (kosong)')))
