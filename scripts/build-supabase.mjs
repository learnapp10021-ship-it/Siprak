// Membangun Edge Function Supabase dari kode bisnis yang SAMA dengan klien dan Apps Script:
//   supabase/functions/api/index.ts   (satu berkas; hasil build, jangan diedit langsung)
// Sumber: src/lib/{utils,selectors,actions}.js, backend/src/server.gs (hanya bagian murni: skema, hak akses, diff),
// backend/src/rules.gs, backend/supabase/handler.js.
//   node scripts/build-supabase.mjs          -> tulis berkas
//   node scripts/build-supabase.mjs --check  -> gagal jika belum diperbarui
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst } from 'rollup/parseAst'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rd = f => fs.readFileSync(path.join(root, f), 'utf8')
const strip = s => s.replace(/^import .*$/gm, '').replace(/^export /gm, '')
const GAS = /\b(SpreadsheetApp|PropertiesService|CacheService|LockService|ContentService|Utilities|Session|Logger|ScriptApp|HtmlService|UrlFetchApp)\b/

// ---- 1. Zona waktu: Edge Function berjalan di UTC, aturan tanggal aplikasi memakai WIB (APP_TZ) ----
const TZ_BLOCK = `// Edge Function berjalan di UTC; aturan tanggal aplikasi (tgl datang minimal, terlambat) memakai zona APP_TZ (WIB).
const APP_TZ = (typeof Deno !== 'undefined' && Deno.env.get('APP_TZ')) || 'Asia/Jakarta'
const WIB_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const wibParts_ = () => Object.fromEntries(WIB_FMT.formatToParts(new Date()).map(p => [p.type, p.value]))
export const todayStr = () => {
  const p = wibParts_()
  return \`\${p.year}-\${p.month}-\${p.day}\`
}
export const nowStr = () => {
  const p = wibParts_()
  return \`\${p.year}-\${p.month}-\${p.day}T\${p.hour}:\${p.minute}\`
}
`
const RE_TZ = /export const todayStr = \(\) => \{[\s\S]*?\n\}\nexport const nowStr = \(\) => \{[\s\S]*?\n\}\n/
let utils = rd('src/lib/utils.js')
if (!RE_TZ.test(utils)) throw new Error('src/lib/utils.js: todayStr/nowStr berubah bentuk; perbarui build-supabase.mjs')
utils = utils.replace(RE_TZ, () => TZ_BLOCK)

// ---- 2. Ambil hanya deklarasi murni dari server.gs (beserta ketergantungannya) ----
const srv = rd('backend/src/server.gs')
const body = parseAst(srv).body
const namesOf = n =>
  n.type === 'FunctionDeclaration' ? [n.id.name] : n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.name).filter(Boolean) : []
const decl = new Map()
body.forEach(n => namesOf(n).forEach(nm => decl.set(nm, n)))
const SEEDS = ['SCHEMA', 'TABLES', 'ser_', 'same_', 'snapJson_', 'diff_', 'ADMIN_ROLES', 'WH_ROLES', 'deptOfItem_', 'PERM', 'BIND']
const want = new Set()
const queue = [...SEEDS]
while (queue.length) {
  const nm = queue.pop()
  const n = decl.get(nm)
  if (!n) throw new Error('server.gs tidak lagi mendefinisikan ' + nm)
  if (want.has(n)) continue
  want.add(n)
  const text = srv.slice(n.start, n.end)
  for (const [other, on] of decl) if (!want.has(on) && new RegExp('\\b' + other + '\\b').test(text)) queue.push(other)
}
const picked = [...want].sort((a, b) => a.start - b.start)
for (const n of picked) {
  const t = srv.slice(n.start, n.end)
  if (GAS.test(t)) throw new Error('Bagian server.gs ini memakai API Google dan tidak bisa masuk Supabase: ' + namesOf(n).join(','))
}
const serverPart = picked.map(n => srv.slice(n.start, n.end)).join('\n\n')

const rules = rd('backend/src/rules.gs')
if (GAS.test(rules)) throw new Error('rules.gs memakai API Google; tidak bisa dipakai di Supabase')

const out =
  [
    '// @ts-nocheck',
    '// ============================================================================',
    '// FILE HASIL BUILD -- JANGAN DIEDIT LANGSUNG.',
    '// Sumber: src/lib/utils.js, selectors.js, actions.js, backend/src/server.gs (bagian murni), backend/src/rules.gs,',
    '//         backend/supabase/handler.js. Bangun ulang: npm run build:supabase',
    '// ============================================================================',
    "import { createClient } from 'npm:@supabase/supabase-js@2'",
    ...[
      ['src/lib/utils.js', utils],
      ['src/lib/selectors.js', rd('src/lib/selectors.js')],
      ['src/lib/actions.js', rd('src/lib/actions.js')],
    ].map(([f, s]) => `\n// ---------- ${f} ----------\n` + strip(s)),
    '\n// ---------- backend/src/server.gs (bagian murni: skema, hak akses, diff) ----------\n' + serverPart,
    '\n// ---------- backend/src/rules.gs ----------\n' + rules,
    '\n// ---------- backend/supabase/handler.js ----------\n' + rd('backend/supabase/handler.js'),
  ].join('\n') + '\n'

const dest = path.join(root, 'supabase/functions/api/index.ts')
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : ''
  if (cur !== out) {
    console.error('supabase/functions/api/index.ts belum diperbarui. Jalankan: npm run build:supabase')
    process.exit(1)
  }
  console.log('supabase/functions/api/index.ts sudah terbaru.')
} else {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out)
  console.log('Tulis', path.relative(root, dest), '(' + out.split('\n').length + ' baris;', picked.length, 'deklarasi dari server.gs)')
}
