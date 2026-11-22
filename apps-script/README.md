# Backend SIPRAK: Apps Script + Google Sheets

Spreadsheet menjadi database. Aplikasi React membaca/menulis lewat Web App Apps Script.

## Pasang (sekitar 5 menit)

1. Buat Google Spreadsheet baru (nama bebas, mis. `SIPRAK DB`).
2. Menu **Extensions → Apps Script**. Buat satu file untuk tiap file `.gs` di folder ini (`Code`, `Schema`, `Db`, `Mutate`, `Validate`, `Migrate`, `Seed`) lalu tempel isinya. Urutan file tidak penting.
   (Opsional: Project Settings → centang "Show appsscript.json" lalu tempel `appsscript.json`.)
3. Pilih fungsi `setup` → **Run** → setujui izin. Ini membuat 9 sheet beserta header.
4. Pilih fungsi `seedDemo` → **Run**. Mengisi data contoh. **Menghapus isi sheet data**, jadi hanya untuk pertama kali.
   Untuk data sungguhan, lewati langkah ini dan isi sheet `Users` serta `Master` sendiri.
5. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Salin URL yang berakhiran `/exec`.
6. Bangun aplikasi dengan URL itu:
   ```bash
   VITE_API_URL="https://script.google.com/macros/s/XXXX/exec" npm run build
   ```
   (atau isi `API_URL` di `src/config.js`). Tanpa URL, aplikasi berjalan sebagai demo di memori.

Setelah mengubah kode Apps Script, buat **New deployment / Manage deployments → Edit → New version**; URL `/exec` tetap sama.

## Memperbarui dari versi lama

Dulu kolom pengguna di `Konsolidasi.by`, `Kedatangan.by`, `SerahTerima.to`, dan `Pengingat.by` berisi **nama**; sekarang semua berisi **ID** pengguna.
Setelah menempel kode baru dan membuat versi deployment baru, jalankan **`migrate`** sekali, lalu **`audit`** untuk memastikan hasilnya bersih.
Sebelum `migrate`, perubahan pada baris lama akan ditolak server dengan pesan yang menyebutkan kolom yang salah.

## Relasi dan validasi

Setiap perubahan dari aplikasi diperiksa server sebelum ditulis (atomik: satu salah, semua dibatalkan). Yang diperiksa:
format ID, tanggal, angka, nilai status yang diperbolehkan, kunci asing (`Item.req → Request`, `Item.kode → Master`, `Konsolidasi.srl → SRL`, dst),
kesesuaian status barang dengan tahap SRL-nya, departemen Konsolidasi dengan SRL-nya, serta jumlah:
barang datang + ditutup tidak boleh melebihi total request, dan serah terima tidak boleh melebihi yang sudah datang.
Diagram relasi ada di komentar `Schema.gs`. Fungsi **`audit`** memeriksa seluruh database (berguna setelah edit manual di sheet) tanpa mengubah data.

## Sheet

| Sheet | Isi | Kunci |
|---|---|---|
| Users | id, n, dept, role, boss, hp, off (`Y` = nonaktif) | id |
| Master | k, n, sat, buf, kons, lead | k |
| Request | id, by, tgl, st, cat | id |
| Item | id, req, kode, qty, datang, pakai, status, appr, kon, tahan, alasan | id |
| Konsolidasi | id, dept, by, kode, tahap, srl, ero, tutup, alasan | id |
| SRL | no, dept, est | no |
| Kedatangan, SerahTerima, Pengingat | log, hanya bertambah | — |

Semua kolom berformat teks agar `2026-11-16` tidak berubah menjadi tanggal. Edit manual di sheet boleh;
trigger `onEdit` otomatis membuang cache, dan aplikasi mengambil data baru pada pengecekan berikutnya (±15 detik).

## Kenapa tidak lemot

- Satu tabel dibaca dengan **satu** `getValues()`, bukan per sel/baris, lalu di-cache (`CacheService`) per tabel.
- Menulis satu tabel hanya membuang cache tabel itu. Banyak perubahan digabung jadi satu `setValues()`.
- Aplikasi tampil langsung dari cache lokal browser, lalu memeriksa nomor versi (`?fn=ver`, sangat ringan);
  data penuh hanya diunduh bila versinya berubah.
- Simpan bersifat optimistis: layar langsung berubah, penyimpanan berjalan di belakang.

## Batasan yang perlu diketahui

- Web App "Anyone" berarti siapa pun yang tahu URL `/exec` bisa membaca/menulis data. Aplikasi ini belum punya login
  (pemilihan pengguna masih menu "Lihat sebagai"). Untuk produksi, batasi ke akun Google perusahaan atau tambahkan autentikasi.
- Apps Script punya kuota harian dan latensi ±0,3–1,5 detik untuk penulisan; cocok untuk puluhan pengguna, bukan ribuan.
- Dua orang membuat request di detik yang sama: yang kedua ditolak dengan pesan jelas dan data dimuat ulang, lalu ia tinggal mengulang.

## Pengujian tanpa Google

`npm run test:gs` menjalankan semua file `.gs` di VM dengan Spreadsheet/Cache/Lock palsu, mengirim alur nyata aplikasi
(buat request sampai serah terima) ke server, membandingkan isi sheet dengan data aplikasi, memastikan pelanggaran relasi ditolak,
dan menguji `migrate`. Setelah mengubah `src/data/seed.js`, jalankan `npm run gen:seed` untuk memperbarui `Seed.gs`.
