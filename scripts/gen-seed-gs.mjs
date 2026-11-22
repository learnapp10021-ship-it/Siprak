// Membuat ulang SEED_DB di apps-script/Seed.gs dari src/data/seed.js: `npm run gen:seed`
import fs from 'node:fs'
import { buildSeed } from '../src/data/seed.js'

const path = 'apps-script/Seed.gs'
const src = fs.readFileSync(path, 'utf8')
const next = src.replace(/var SEED_DB = .*;\s*$/s, 'var SEED_DB = ' + JSON.stringify(buildSeed()) + ';\n')
if (next === src) console.log('Seed.gs sudah sesuai.')
fs.writeFileSync(path, next)
console.log('Seed.gs diperbarui dari src/data/seed.js')
