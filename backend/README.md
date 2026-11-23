# Backend SIPRAK (Google Apps Script + Google Spreadsheet)

## Deploy (sekali, ±10 menit)
1. Buat Google Spreadsheet kosong. Buka **Extensions > Apps Script**.
2. Tempel isi `backend/dist/Code.gs` ke `Code.gs`. Di Project Settings aktifkan "Show appsscript.json", lalu salin isi `backend/dist/appsscript.json` (zona waktu Asia/Jakarta).
3. Jalankan `setup()` (beri izin). Lalu `seedDemo()` untuk data contoh, atau isi sheet **Users** dan **Master** sendiri.
4. (Disarankan) Project Settings > Script Properties: tambah `API_KEY` = kata acak. Jalankan `installTriggers()` sekali.
5. **Deploy > New deployment > Web app**: Execute as *Me*, Who has access *Anyone*. Salin URL `/exec`.
6. Frontend: salin `.env.example` ke `.env`, isi `VITE_API_URL` (dan `VITE_API_KEY`), lalu `npm run build`.
7. Setiap `Code.gs` diubah: Deploy > Manage deployments > Edit > New version.

## Aturan
- Jangan ubah/urut ulang kolom header. Jangan hapus baris data. Master barang boleh diedit langsung.
- Edit manual terlihat di aplikasi setelah beberapa detik. Jalankan `auditData()` bila curiga ada data janggal.
- Kode bisnis ada di `src/lib/*.js`; setelah mengubahnya jalankan `npm run build:backend` dan deploy ulang.
- Pengujian: `npm test` (sinkronisasi build, simulasi dan audit backend, uji klien end-to-end).
