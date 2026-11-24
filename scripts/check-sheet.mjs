// Periksa berkas spreadsheet SIPRAK (.xlsx) sebelum go live.
//   node scripts/check-sheet.mjs [berkas.xlsx] [--izinkan-transaksi]
// Tanpa argumen: memeriksa templat di backend/template/SIPRAK-Spreadsheet.xlsx.
// Untuk data asli: di Google Sheets pilih File > Download > Microsoft Excel (.xlsx), simpan DI LUAR repo
// (atau di folder data-asli/ yang diabaikan git), lalu jalankan skrip ini. Keluar dengan kode 1 bila ada galat.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bacaXlsx } from './lib/xlsx-mini.mjs'
import { periksa } from './lib/sheet-rules.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const izinkanTransaksi = args.includes('--izinkan-transaksi')
const file = args.find(a => !a.startsWith('--')) || path.join(root, 'backend/template/SIPRAK-Spreadsheet.xlsx')

let sheets
try {
  sheets = bacaXlsx(file)
} catch (e) {
  console.error('Tidak bisa membaca ' + file + ': ' + e.message)
  process.exit(2)
}
const { galat, peringatan, ringkas } = periksa(sheets, { izinkanTransaksi })
console.log(`Berkas: ${path.relative(process.cwd(), file) || file}`)
console.log(`Pengguna ${ringkas.pengguna} (aktif ${ringkas.aktif}), departemen ${ringkas.dept}, barang master ${ringkas.barang}`)
if (peringatan.length) console.log('\nPeringatan (' + peringatan.length + '):\n' + peringatan.map(m => '  - ' + m).join('\n'))
if (galat.length) {
  console.log('\nGALAT (' + galat.length + '):\n' + galat.map(m => '  x ' + m).join('\n'))
  console.log('\nBELUM SIAP. Perbaiki galat di atas, unduh ulang, lalu periksa lagi.')
  process.exit(1)
}
console.log('\nOK: struktur dan data siap diunggah. Setelah dipasang di Google Sheets, jalankan juga auditData() di Apps Script.')
