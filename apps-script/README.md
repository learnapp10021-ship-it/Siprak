# Backend SIPRAK: Apps Script + Google Sheets

Spreadsheet menjadi database. Aplikasi React membaca/menulis lewat Web App Apps Script.

## Pasang (sekitar 5 menit)

1. Buat Google Spreadsheet baru (nama bebas, mis. `SIPRAK DB`).
2. Menu **Extensions → Apps Script**. Buat file `Code.gs`, `Fonnte.gs`, `Seed.gs` (Script) dan `Settings.html` (HTML), tempel isi dari folder ini.
   (Disarankan: Project Settings → centang "Show appsscript.json" lalu tempel `appsscript.json`, agar zona waktu Asia/Jakarta.)
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
Cek versi yang sedang aktif: buka `…/exec?fn=info` (harus menampilkan `"gs":"2.1.0"`).

Menuju produksi (data sungguhan, WhatsApp, jadwal): ikuti **[GOLIVE.md](GOLIVE.md)**.

## Sheet

| Sheet | Isi | Kunci |
|---|---|---|
| Users | id (email), n, dept, role, boss, hp, off (`Y` = nonaktif) | id |
| Master | k, n, sat, buf, kons, lead | k |
| Request | id, by, tgl, st, cat | id |
| Item | id, req, kode, qty, datang, pakai, status, appr, kon, tahan, alasan | id |
| Konsolidasi | id, dept, by, kode, tahap, srl, ero, tutup, alasan | id |
| SRL | no, dept, est | no |
| Kedatangan, SerahTerima, Pengingat | log, hanya bertambah | — |
| LogWA | log kirim WhatsApp (dibuat otomatis, tidak dibaca aplikasi) | — |

Semua kolom berformat teks agar `2026-11-16` tidak berubah menjadi tanggal. Edit manual di sheet boleh;
trigger `onEdit` otomatis membuang cache, dan aplikasi mengambil data baru pada pengecekan berikutnya (±15 detik).

## Alur proses ditegakkan di server

Aplikasi memeriksa alur di layar, tetapi layar bisa usang (dua orang bekerja bersamaan) atau URL dipanggil langsung.
Karena itu `mutate` menolak (sebagai `conflict`, aplikasi memuat ulang data) bila:

- status tidak mengikuti alur: Request `Draft → Menunggu Approval → Disetujui/Ditolak` (Draft/Menunggu bisa `Dibatalkan`);
  Barang `… → Approved → Validasi Warehouse → Sudah di ERO` (Warehouse boleh mengeluarkan kembali ke `Approved`);
  SRL `Validasi Warehouse → Sudah di ERO / Dikeluarkan`. Status awal baris baru juga dibatasi;
- kolom inti diubah (pemohon, qty, kode barang, SRL, dll.) atau rujukan antar tabel tidak ada;
- kedatangan dicatat pada SRL yang belum divalidasi, atau melebihi sisa (dua admin mencatat bersamaan);
- serah terima melebihi jatah barang yang sudah datang, atau pada barang yang belum di ERO.

Satu panggilan `mutate` bersifat atomik: bila satu operasi ditolak, tidak ada yang tertulis.
Server belum tahu *siapa* yang memanggil (belum ada login), jadi aturan "hanya atasan yang menyetujui" masih di layar.

## Pengingat WhatsApp (Fonnte)

Tiap departemen menyambungkan WhatsApp Admin Dept-nya ke Fonnte; token perangkat disimpan di Script Properties
(tidak di sheet, tidak pernah dikirim ke aplikasi). Menu **SIPRAK → Pengaturan WA dan Go Live** membuka dialog untuk:
token + nomor pengirim per departemen (dengan **Tes kirim**), aturan pengingat, mode, jadwal, dan **Cek kesiapan go live**.
Menu hanya muncul bila script dibuat lewat *Extensions → Apps Script* dari spreadsheet (container-bound).

| Pengingat | Penerima | Pengirim (urutan perangkat) |
|---|---|---|
| Barang sudah di gudang, belum diambil | PIC pemohon | dept PIC, Warehouse, dept lain |
| Request menunggu persetujuan | Atasan | dept atasan, Warehouse, dept lain |
| Barang disetujui belum dibuat di ERO | Admin Dept | Warehouse, dept lain, dept sendiri |
| SRL menunggu validasi | Admin Warehouse | dept pemilik SRL, dept lain, Warehouse |

Perangkat yang nomornya sama dengan penerima dilewati. Pengingat barang dicatat per barang di sheet `Pengingat`
(pengirim `WA Otomatis`), jadi hitungan "diingatkan N kali" di dashboard tetap berlaku; tombol manual "Ingatkan via WA" tetap berfungsi.
Semua percobaan kirim (termasuk simulasi dan kegagalan) tercatat di sheet `LogWA` tanpa token.

Mode awal adalah **SIMULASI**: tidak ada pesan yang dikirim, hanya dicatat di `LogWA`. Ganti ke LIVE setelah tes kirim berhasil.

## Kenapa tidak lemot

- Satu tabel dibaca dengan **satu** `getValues()`, bukan per sel/baris, lalu di-cache (`CacheService`) per tabel.
- Menulis satu tabel hanya membuang cache tabel itu. Banyak perubahan digabung jadi satu `setValues()`.
- Aplikasi tampil langsung dari cache lokal browser, lalu memeriksa nomor versi (`?fn=ver`, sangat ringan);
  data penuh hanya diunduh bila versinya berubah.
- Simpan bersifat optimistis: layar langsung berubah, penyimpanan berjalan di belakang.

## Batasan yang perlu diketahui

- Web App "Anyone" berarti siapa pun yang tahu URL `/exec` bisa membaca/menulis data (termasuk nomor WA pengguna). Aplikasi ini belum punya login
  (pemilihan pengguna masih menu "Lihat sebagai"). Rahasiakan URL, dan tambahkan autentikasi sebelum dipakai luas.
  Token Fonnte tidak ikut terbaca lewat URL itu, dan fungsi WhatsApp tidak bisa dipanggil dari URL itu.
- Apps Script punya kuota harian dan latensi ±0,3–1,5 detik untuk penulisan; cocok untuk puluhan pengguna, bukan ribuan.
- Dua orang membuat request di detik yang sama: yang kedua ditolak dengan pesan jelas dan data dimuat ulang, lalu ia tinggal mengulang.
