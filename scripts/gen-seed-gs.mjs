// Membuat apps-script/Seed.gs dari src/data/seed.js:  npm run gen:seed
import { createServer } from 'vite'
import { writeFileSync } from 'node:fs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { buildSeed } = await vite.ssrLoadModule('/src/data/seed.js')
const db = buildSeed()
await vite.close()

const out = `/**
 * Data contoh SIPRAK (dihasilkan dari src/data/seed.js dengan: npm run gen:seed).
 * Jalankan seedDemo() SEKALI dari editor Apps Script untuk mengisi spreadsheet.
 * PERINGATAN: seedDemo() MENGHAPUS isi semua sheet data lalu menggantinya dengan data contoh.
 */
function seedDemo() {
  setup();
  var ver = writeAll_(SEED_DB);
  return 'Data contoh terisi. Versi: ' + ver;
}

var SEED_DB = ${JSON.stringify(db)};
`
writeFileSync('apps-script/Seed.gs', out)
console.log('Seed.gs ditulis:', Object.entries(db).map(([k, v]) => k + '=' + (Array.isArray(v) ? v.length : Object.keys(v).length)).join(' '))
