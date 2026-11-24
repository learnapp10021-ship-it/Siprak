# Panduan Go Live — NRB / SIPRAK

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

Keterbatasan: semua uji berjalan di tiruan Google Sheets dan browser headless, belum di Google dan HP asli.
Karena itu langkah D (uji dengan beberapa orang sekaligus) wajib sebelum dibuka untuk semua.

## B. Penghalang yang harus diputuskan

**Login belum memeriksa password.** Layar masuk memakai pilihan nama; kolom password diabaikan. Server memeriksa
peran dan kepemilikan data (misalnya hanya atasan yang bisa menyetujui, hanya Admin Warehouse yang bisa mencatat
kedatangan), tetapi tidak bisa membuktikan siapa orangnya. Untuk data sungguhan, tambahkan login Google/SSO atau PIN
per pengguna sebelum dibuka ke semua karyawan. Jika dipakai terbatas (tim kecil yang saling percaya), boleh jalan
dulu dengan risiko ini disadari.

## C. Pasang backend (sekali, sekitar 15 menit)

1. **Cadangkan** spreadsheet (File, Make a copy). Jika sudah ada data dari backend lama, lanjut ke langkah 2;
   jika kosong, ikuti "Pasang baru" di `backend/README.md`.
2. Apps Script: tempel isi `backend/dist/Code.gs` dan `backend/dist/appsscript.json`.
3. Jalankan `migrate()` (hanya jika spreadsheet lama), lalu `setup()`, lalu `auditData()` (harus "OK").
4. Script Properties: isi `API_KEY` dengan kata acak panjang. Jalankan `installTriggers()`.
5. Deploy, New deployment, Web app: Execute as **Me**, access **Anyone**. Salin URL berakhiran `/exec`.
6. Isi sheet **Users** (id, nama, dept, role, atasan, nomor WA) dan **Master** (kode, nama, satuan, buffer, lead time).

## D. Bangun dan terbitkan aplikasi

```bash
VITE_API_URL="https://script.google.com/macros/s/XXXX/exec" VITE_API_KEY="kata-acak-tadi" npm run build
```

Terbitkan isi `dist/` (GitHub Pages: branch `gh-pages`). Setelah terbit, label DEMO harus **hilang**. Jika masih
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
- Cabut token GitHub yang pernah dibagikan di percakapan, dan buat yang baru bila masih perlu.
