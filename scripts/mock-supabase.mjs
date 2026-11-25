// Edge Function Supabase + Postgres LOKAL (PGlite) untuk uji coba tanpa akun Supabase. Bukan untuk produksi.
//   node scripts/mock-supabase.mjs                      # data contoh (pengguna + master)
//   node scripts/mock-supabase.mjs --users users.json   # mulai kosong + pengguna awal [[id,nama,dept,role,atasan,hp],...]
//   lalu: VITE_API_URL=http://127.0.0.1:4181/functions/v1/api npm run build   (atau npm run dev)
// Endpoint bantu: /__rows?table=users, /__net?mode=ok|down|slow
import http from 'node:http'
import fs from 'node:fs'
import { createSupabaseBackend } from '../backend/test/supabase-harness.mjs'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1] }
const port = +arg('port', 4181)
const uf = arg('users', '')
const B = await createSupabaseBackend({ seed: !uf, env: {} })
if (uf) {
  for (const u of JSON.parse(fs.readFileSync(uf, 'utf8')))
    await B.db.query('insert into public.users ("id","n","dept","role","boss","hp") values ($1,$2,$3,$4,$5,$6)', u)
}
let net = 'ok'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/__net') { net = u.searchParams.get('mode') || 'ok'; res.writeHead(200, cors); return res.end(net) }
  if (u.pathname === '/__rows') {
    const r = await B.db.query(`select * from public.${u.searchParams.get('table').replace(/[^a-z]/g, '')} order by seq`)
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r.rows))
  }
  if (!/\/(functions\/v1\/)?api$/.test(u.pathname) && u.pathname !== '/exec') { res.writeHead(404, cors); return res.end('{}') }
  if (net === 'down') return req.socket.destroy()
  let body = ''
  for await (const c of req) body += c
  const r = await B.handler(new Request('http://x' + req.url, { method: req.method, body: req.method === 'POST' ? body : undefined }))
  if (net === 'slow') await new Promise(ok => setTimeout(ok, 4000))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(await r.text())
}).listen(port, '127.0.0.1', () => console.log(`Supabase lokal siap: http://127.0.0.1:${port}/functions/v1/api` + (uf ? ' (mulai kosong + pengguna awal)' : ' (data contoh)')))
