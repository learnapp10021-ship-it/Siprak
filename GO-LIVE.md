# Panduan Go Live — NRB (Nota Request Barang)

Status per dokumen ini: kode sudah diuji dan siap. Yang tersisa adalah langkah yang hanya bisa dilakukan pemilik
akun Google (Apps Script) dan satu keputusan keamanan (login).

## A. Sudah diverifikasi (otomatis, ulangi dengan `npm test`)

| Pemeriksaan | Hasil |
|---|---|
| Simulasi backend Google Sheets (lock, ID transaksi, retry, rollback, migrasi, hak akses) | 107 skenario lulus |
| Audit multi-user dan relasi data | 56 skenario lulus |
| Uji klien (klik berkali-kali, respons hilang, offline, notifikasi, layar malas) | 114 tes lulus |
| Build produksi di sub-folder `/Siprak/` | 0 galat konsol, 0 file 404, tanpa scroll samping, 5 peran x HP/desktop |
| Rahasia (token, kunci API) di kode dan seluruh riwayat git | tidak ada |
| Mode demo | ditandai label **DEMO** di header dan layar masuk |
| Templat spreadsheet (`backend/template/`) | header sama persis dengan `SCHEMA` di `server.gs`; 18 tes validator data |

Keterbatasan: semua uji berjalan di tiruan Google Sheets dan browser headless, belum di Google dan HP asli.
Karena itu langkah D (uji dengan beberapa orang sekaligus) wajib sebelum dibuka untuk semua.

## B. Penghalang yang harus diputuskan

**Login belum memeriksa password.** Layar masuk memakai pilihan nama; kolom password diabaikan. Server memeriksa
peran dan kepemilikan data (misalnya hanya atasan yang bisa menyetujui, hanya Admin Warehouse yang bisa mencatat
kedatangan), tetapi tidak bisa membuktikan siapa orangnya. Untuk data sungguhan, tambahkan login Google/SSO atau PIN
per pengguna sebelum dibuka ke semua karyawan. Jika dipakai terbatas (tim kecil yang saling percaya), boleh jalan
dulu dengan risiko ini disadari.

**Repo ini publik, dan URL deployment lama ada di riwayatnya.** Commit `6085e4c` dan `a1ecbbb` pernah memuat URL web app
Apps Script yang sebenarnya (di kolom `VITE_API_URL` dan `VITE_API_KEY` pada `.env.example`). Berkasnya sudah dibersihkan,
tetapi riwayat git tetap bisa dibaca siapa pun. Karena belum ada login, anggap URL itu **sudah diketahui orang lain**:

1. Apps Script: *Deploy > Manage deployments*, **arsipkan** deployment lama (URL-nya langsung mati).
2. Pastikan Script Property `API_KEY` terisi (kata acak panjang), lalu *Deploy > New deployment* untuk URL baru.
3. Simpan URL dan kunci baru **hanya** sebagai GitHub Secrets (langkah D) atau di `.env` lokal (diabaikan git). Jangan
   tempel di berkas yang di-commit, termasuk `.env.example`.

Menulis ulang riwayat git tidak diperlukan jika URL lama sudah diarsipkan. Dan **data asli** (nama, nomor WhatsApp,
master) tidak boleh masuk repo; simpan di Google Sheets, dan salinan unduhan hanya di folder `data-asli/` (diabaikan git).

## C. Pasang backend (sekali, sekitar 15 menit)

1. **Cadangkan** spreadsheet (File, Make a copy). Jika sudah ada data dari backend lama, lanjut ke langkah 2;
   jika kosong, ikuti "Pasang baru" di `backend/README.md`, memakai templat `backend/template/SIPRAK-Spreadsheet.xlsx`
   (sudah berisi 11 sheet dengan header yang benar; baca sheet *Petunjuk* di dalamnya).
2. Apps Script: tempel isi `backend/dist/Code.gs` dan `backend/dist/appsscript.json`.
3. Jalankan `migrate()` (hanya jika spreadsheet lama), lalu `setup()`, lalu `auditData()` (harus "OK").
4. Script Properties: isi `API_KEY` dengan kata acak panjang. Jalankan `installTriggers()`.
5. Deploy, New deployment, Web app: Execute as **Me**, access **Anyone**. Salin URL berakhiran `/exec`.
6. Isi sheet **Users** (id, nama, dept, role, atasan, nomor WA 628…) dan **Master** (kode, nama, satuan, buffer, lead time),
   hapus semua baris contoh, dan biarkan sheet lain kosong. **Sebelum** mengunggah, unduh sebagai `.xlsx` ke `data-asli/` lalu
   periksa:
   ```bash
   npm run check:sheet -- data-asli/SIPRAK-Spreadsheet.xlsx
   ```
   Harus berakhir `OK`. Yang diperiksa: header, id ganda/huruf besar, role, rantai atasan, format WhatsApp, kode barang,
   Admin Dept untuk tiap departemen yang punya User, minimal satu Admin Warehouse, dan sheet transaksi masih kosong.
   Setelah dipasang di Google Sheets, jalankan juga `auditData()`.

## D. Bangun dan terbitkan aplikasi

```bash
VITE_API_URL="https://script.google.com/macros/s/XXXX/exec" VITE_API_KEY="kata-acak-tadi" npm run build
```

**Cara otomatis (disarankan):** pasang workflow sekali: di GitHub *Add file > Create new file*, nama
`.github/workflows/deploy.yml`, tempel isi `scripts/deploy.workflow.yml` (tidak bisa di-push dengan token tanpa izin
`workflow`). Lalu *Settings > Secrets and variables > Actions*, tambah secret `VITE_API_URL` dan `VITE_API_KEY`
(opsional variable `VITE_POLL_MS`), dan *Actions > Deploy ke GitHub Pages > Run workflow*. Workflow menjalankan `npm test`, membangun dengan secret tadi, dan menerbitkan ke `gh-pages`. Tanpa
secret hasilnya mode demo. Perhatian: setelah secret terisi, **setiap push ke `main` ikut tayang** dengan data asli.

**Cara manual:** terbitkan isi `dist/` (GitHub Pages: branch `gh-pages`). Setelah terbit, label DEMO harus **hilang**. Jika masih
tampil, URL backend belum tertanam; ulangi build.

Uji sebelum dibuka ke semua (3 sampai 5 orang, bersamaan, dari HP masing-masing):
- semua menekan Simpan di detik yang sama, lalu cek sheet **Request**: tidak ada ID kembar;
- matikan data seluler sebentar saat menyimpan, lalu nyalakan dan tekan Coba lagi: tetap satu baris;
- dua admin memvalidasi/menyerahkan barang yang sama: hanya satu yang berhasil;
- cek sheet **Tx**: tidak ada baris `PENDING` yang menggantung.

## E. Rencana mundur

- Aplikasi: terbitkan ulang build sebelumnya (riwayat branch `gh-pages`), atau build tanpa `VITE_API_URL` (mode demo).
- Data: kembalikan salinan spreadsheet dari langkah C.1. Backend tidak menghapus data; semua perubahan tercatat di
  sheet **Tx** dan **Journal** (14 hari).

## F. Setelah live

- Mingguan: jalankan `auditData()` dan lihat sheet **Tx** untuk status `FAILED`.
- Jika banyak pengguna melihat "server sibuk": penulisan diantre satu per satu (sekitar 2 sampai 3 detik per transaksi),
  cukup untuk 40 pengguna dengan beban normal. Jika sering terjadi, jadwalkan input massal di luar jam sibuk.
- Biaya: **Rp0** (Google Sheets, Apps Script, GitHub Pages gratis). Batas yang relevan: 30 eksekusi Apps Script bersamaan
  per pemilik skrip dan 6 menit per eksekusi ([kuota resmi](https://developers.google.com/apps-script/guides/services/quotas)).
  Halaman kuota itu tidak mencantumkan batas harian jumlah permintaan web app. Aplikasi mengecek data baru tiap 15 detik per
  tab terbuka; jika pengguna aktif bersamaan lebih dari ±60, isi variable `VITE_POLL_MS` = 30000.
- Cadangan gratis: *File > Version history*, atau *File > Make a copy* tiap pekan.
- Cabut token GitHub yang pernah dibagikan di percakapan, dan buat yang baru bila masih perlu.
