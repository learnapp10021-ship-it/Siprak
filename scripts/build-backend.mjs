// Menggabungkan logika bersama (src/lib + seed) dengan server.gs menjadi SATU file Apps Script:
//   backend/dist/Code.gs   (tempel ke editor Apps Script, atau deploy dengan clasp)
// Dengan begitu aturan bisnis di browser dan di server selalu identik (satu sumber kebenaran).
//   node scripts/build-backend.mjs          -> tulis file
//   node scripts/build-backend.mjs --check  -> gagal jika dist/Code.gs belum diperbarui
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rd = f => fs.readFileSync(path.join(root, f), 'utf8')
const strip = s => s.replace(/^import .*$/gm, '').replace(/^export /gm, '')

const parts = [
  '// ============================================================================',
  '// FILE HASIL BUILD -- JANGAN DIEDIT LANGSUNG.',
  '// Sumber: src/lib/utils.js, selectors.js, actions.js, src/data/seed.js, backend/src/server.gs, backend/src/rules.gs',
  '// Bangun ulang: npm run build:backend',
  '// ============================================================================',
  ...['src/lib/utils.js', 'src/lib/selectors.js', 'src/lib/actions.js', 'src/data/seed.js'].map(
    f => `\n// ---------- ${f} ----------\n` + strip(rd(f))
  ),
  '\n// ---------- backend/src/server.gs ----------\n' + rd('backend/src/server.gs'),
  '\n// ---------- backend/src/rules.gs ----------\n' + rd('backend/src/rules.gs'),
]
const out = parts.join('\n') + '\n'
const dest = path.join(root, 'backend/dist/Code.gs')

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : ''
  if (cur !== out) {
    console.error('backend/dist/Code.gs belum diperbarui. Jalankan: npm run build:backend')
    process.exit(1)
  }
  console.log('backend/dist/Code.gs sudah terbaru.')
} else {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out)
  fs.copyFileSync(path.join(root, 'backend/appsscript.json'), path.join(root, 'backend/dist/appsscript.json'))
  console.log('Tulis', path.relative(root, dest), '(' + out.split('\n').length + ' baris)')
}
