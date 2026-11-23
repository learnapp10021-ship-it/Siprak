# SIPRAK — Request Barang (React)

Aplikasi request barang: pengajuan → persetujuan atasan → pembuatan SRL di ERO → kedatangan → serah terima,
dengan dashboard Warehouse untuk OPR mingguan. Versi React dari `legacy/Request_Barang_v2.html`.

## Menjalankan

```bash
npm install
npm run dev            # pengembangan
npm run build          # hasil di dist/ (base './', aman untuk GitHub Pages)
npm test               # sinkronisasi build backend + simulasi backend + audit multi-user + uji klien
npm run build:backend  # bangun ulang backend/dist/Code.gs (wajib setelah mengubah src/lib atau src/data)
```

## Dua mode data

- **Demo lokal** (default, `VITE_API_URL` kosong): data contoh ada di memori browser dan hilang saat refresh.
- **Terhubung backend** (`VITE_API_URL` diisi): data disimpan di Google Spreadsheet lewat Google Apps Script,
  banyak pengguna sekaligus, dengan antrean kirim ulang yang aman (tidak menulis ganda). Cara memasang ada di
  [`backend/README.md`](backend/README.md). Salin `.env.example` ke `.env` untuk mengatur `VITE_API_URL` dan `VITE_API_KEY`.

## Struktur

```
src/
  data/seed.js          data contoh (juga dipakai backend untuk seedDemo)
  lib/selectors.js      logika turunan: jatah, sisa, status per barang
  lib/actions.js        semua perubahan data + validasi (immer), dipakai klien DAN server
  lib/utils.js          tanggal, WhatsApp, helper (TODAY disegarkan saat ganti hari)
  lib/api.js            klien backend Apps Script (sync + tulis dengan retry)
  lib/outbox.js         antrean transaksi belum pasti di perangkat (ID transaksi tetap sama saat kirim ulang)
  config.js             URL API dan interval polling
  store.jsx             state global (data + UI), polling, toast
  components/           ui kecil, drawer, sheet, layar masuk, ErrorBoundary
  views/                layar per peran
  test/                 uji klien (vitest + Testing Library) dan uji selector
  styles.css            CSS aplikasi
backend/
  src/server.gs         pintu masuk web app, hak akses, penguncian, pemulihan transaksi
  dist/Code.gs          HASIL BUILD (jangan diedit langsung; tempel ke Apps Script)
  test/                 simulasi dan audit di atas tiruan Google Sheets
scripts/build-backend.mjs   menggabungkan src/lib + seed + server.gs menjadi satu Code.gs
```

Aturan bisnis hanya ditulis sekali di `src/lib/*.js`, lalu digabung ke `backend/dist/Code.gs` supaya browser dan server
selalu identik. `npm test` gagal bila `Code.gs` belum dibangun ulang.

Peran: User, Atasan, Admin Dept, Admin Warehouse, Spv Warehouse. Layar masuk masih **mode uji coba**: pilih salah satu
pengguna terdaftar (password belum diperiksa), dan sesi diingat di perangkat. Untuk berpindah pengguna, pakai tombol
"Keluar" di menu samping.

## Catatan keamanan

- Password di layar masuk belum diperiksa, dan server menentukan hak akses dari ID pengguna yang dikirim klien.
  Jadi sebelum dipakai di luar uji coba, tambahkan autentikasi sungguhan (mis. password/PIN per pengguna di server
  dan token sesi).
- `VITE_API_KEY` ikut tertanam di berkas JS hasil build sehingga bisa dibaca siapa pun yang membuka aplikasi.
  Anggap ini pembatas ringan, bukan rahasia.
- Jangan menaruh token atau kata sandi di repository ini, juga tidak di `.env.example`.
