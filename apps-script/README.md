# Backend SIPRAK: Apps Script + Google Sheets

Spreadsheet menjadi database. Aplikasi React membaca/menulis lewat Web App Apps Script.

## Pasang (sekitar 5 menit)

1. Buat Google Spreadsheet baru (nama bebas, mis. `SIPRAK DB`).
2. Menu **Extensions → Apps Script**. Buat file `Code.gs` dan `Seed.gs`, tempel isi dari folder ini.
   (Opsional: Project Settings → centang "Show appsscript.json" lalu tempel `appsscript.json`.)
3. Pilih fungsi `setup` → **Run** → setujui izin. Ini membuat 9 sheet beserta header (aman diulang; juga menambah kolom `pw` pada sheet lama).
4. Pilih fungsi `seedDemo` → **Run**. Mengisi data contoh. **Menghapus isi sheet data**, jadi hanya untuk pertama kali.
   Semua pengguna contoh berpassword `demo1234`. Untuk data sungguhan, lewati langkah ini, isi sheet `Users` serta
   `Master` sendiri, lalu atur password (lihat **Login** di bawah).
5. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Salin URL yang berakhiran `/exec`.
6. Bangun aplikasi dengan URL itu:
   ```bash
   VITE_API_URL="https://script.google.com/macros/s/XXXX/exec" npm run build
   ```
   (atau isi `API_URL` di `src/config.js`). Tanpa URL, aplikasi berjalan sebagai demo di memori.

Setelah mengubah kode Apps Script, buat **New deployment / Manage deployments → Edit → New version**; URL `/exec` tetap sama.

## Sheet

| Sheet | Isi | Kunci |
|---|---|---|
| Users | id (username/email), n, dept, role, boss, hp, off (`Y` = nonaktif), pw (hash, jangan diedit) | id |
| Master | k, n, sat, buf, kons, lead | k |
| Request | id, by, tgl, st, cat | id |
| Item | id, req, kode, qty, datang, pakai, status, appr, kon, tahan, alasan | id |
| Konsolidasi | id, dept, by (id pengguna), kode, tahap, srl, ero, tutup, alasan | id |
| SRL | no, dept, est | no |
| Kedatangan (kon, qty, lebih, **by**, cat, tgl), SerahTerima (item, qty, **to**, tgl), Pengingat (item, **by**, at) | log, hanya bertambah. Kolom tebal berisi **id pengguna** | — |

Semua kolom berformat teks agar `2026-11-16` tidak berubah menjadi tanggal. Edit manual di sheet boleh;
trigger `onEdit` otomatis membuang cache, dan aplikasi mengambil data baru pada pengecekan berikutnya (±15 detik).

## Login

Aplikasi menampilkan layar login (username + password + logo DBC). Username = kolom `id` di sheet **Users**
(huruf besar/kecil tidak dibedakan). Pengguna tetap sama dengan daftar yang sudah ada.

- Password disimpan sebagai hash bergaram di kolom `pw` (tidak pernah dikirim ke aplikasi). **Jangan mengisi kolom `pw` manual**;
  atur lewat fungsi di bawah.
- Login menghasilkan token bertanda tangan (berlaku 30 hari). Tanpa token sah, server menolak membaca atau menulis data.
- Gagal login 5 kali dalam 10 menit mengunci akun itu 10 menit.
- Pengguna yang dinonaktifkan (`off` = `Y`) langsung tidak bisa login, dan sesinya yang berjalan ikut tidak berlaku.
- Server memastikan pelaku sesuai: request hanya atas nama sendiri, persetujuan/penolakan hanya oleh atasan langsung,
  pengajuan/pembatalan hanya oleh pembuat, kedatangan dan pengingat hanya atas nama pencatat sendiri.
- Pengguna mengganti password sendiri lewat menu **Ganti password**.

| Fungsi (editor Apps Script) | Fungsinya |
|---|---|
| `aturPasswordSemua('password-awal')` | Memberi password awal yang sama ke semua pengguna yang belum punya. Minta mereka menggantinya. |
| `aturPassword('andi.prod', 'password-baru')` | Mengatur/reset password satu pengguna (mis. bila lupa). |
| `resetSesi()` | Memaksa semua pengguna login ulang. |

## Relasi antar sheet

```
Users.boss ──────────► Users.id          (atasan, berperan Atasan, tanpa rantai berputar)
Request.by ──────────► Users.id
Item.req ────────────► Request.id
Item.kode ───────────► Master.k
Item.kon ────────────► Konsolidasi.id    (wajib terisi bila status "Sudah di ERO")
Konsolidasi.kode ────► Master.k          (sama dengan kode semua Item di dalamnya)
Konsolidasi.srl ─────► SRL.no            (dept Konsolidasi = dept SRL = dept peminta)
Konsolidasi.by ──────► Users.id
Kedatangan.kon ──────► Konsolidasi.id
Kedatangan.by ───────► Users.id          (Admin Warehouse)
SerahTerima.item ────► Item.id
SerahTerima.to ──────► Users.id          (harus peminta barang itu)
Pengingat.item ──────► Item.id
Pengingat.by ────────► Users.id          (Admin Warehouse)
```

Kolom `by`/`to` menyimpan **id** pengguna, bukan nama, jadi mengganti nama seseorang tidak memutus riwayat.

## Validasi di server

Setiap tulisan (`mutate`) divalidasi **sebelum** menyentuh sheet; bila ada pelanggaran, tidak ada baris yang ditulis.

- Kunci asing sesuai diagram di atas, enum status/role, format tanggal, nomor WhatsApp, angka tidak negatif.
- Status hanya maju lewat jalur sah (mis. request yang sudah dibatalkan tidak bisa disetujui). Kolom identitas
  (`req`, `kode`, `qty`, `ero`, ...) tidak bisa diubah setelah dibuat.
- Kedatangan + sisa ditutup tidak boleh melebihi jumlah ERO; serah terima tidak boleh melebihi jatah (dibagi menurut
  urutan kebutuhan: tgl pakai, waktu approve, lalu id).
- Bila layar pengguna basi (data sudah diubah orang lain), server menjawab **konflik**; aplikasi memuat ulang data
  dan pengguna tinggal mengulang.

Aturan ini tidak mengenal siapa yang login (belum ada autentikasi), jadi pembatasan per peran masih dijaga di aplikasi.

## Fungsi perawatan (jalankan dari editor Apps Script)

| Fungsi | Fungsinya |
|---|---|
| `cekIntegritas()` | Memeriksa seluruh relasi dan angka di spreadsheet, hasilnya di Execution log. Tidak mengubah data. Jalankan setelah mengedit sheet manual. |
| `migrasiRelasi()` | Mengubah kolom `by`/`to` yang masih berisi nama menjadi id. Aman dijalankan berulang. Nama kembar atau tak dikenal dilaporkan, tidak ditebak. |
| `resetCache()` | Membuang cache bila data di aplikasi terasa tidak sinkron dengan sheet. |

## Memperbarui deployment yang sudah berjalan

1. Tempel `Code.gs` terbaru (dan `Seed.gs` bila perlu) ke editor Apps Script.
2. Jalankan `setup()` (menambah kolom `pw`), `migrasiRelasi()`, lalu `cekIntegritas()`; pastikan hasilnya `OK`.
   Jalankan `aturPasswordSemua('password-awal')` agar semua pengguna bisa login.
3. **Deploy → Manage deployments → Edit → New version**. URL `/exec` tidak berubah.

Data lama (log berisi nama) tetap tampil dan tetap bisa dipakai sebelum migrasi; migrasi hanya merapikan relasinya.

## Menguji

Dari root repo: `npm run check` (verifikasi relasi + semua aksi terhadap validator server, tes tampilan semua peran, lalu build).
`npm run gen:seed` membuat ulang `Seed.gs` dari `src/data/seed.js`.

## Kenapa tidak lemot

- Satu tabel dibaca dengan **satu** `getValues()`, bukan per sel/baris, lalu di-cache (`CacheService`) per tabel.
- Menulis satu tabel hanya membuang cache tabel itu. Banyak perubahan digabung jadi satu `setValues()`.
- Aplikasi tampil langsung dari cache lokal browser, lalu memeriksa nomor versi (`?fn=ver`, sangat ringan);
  data penuh hanya diunduh bila versinya berubah.
- Simpan bersifat optimistis: layar langsung berubah, penyimpanan berjalan di belakang.

## Batasan yang perlu diketahui

- Web App "Anyone" berarti siapa pun yang tahu URL `/exec` bisa memanggilnya, tetapi tanpa username/password yang benar
  server tidak memberi atau menerima data (hanya nomor versi yang terbuka). Pembatasan menurut peran (mis. hanya Admin
  Dept yang membuat SRL) masih dijaga di aplikasi; server baru menegakkan kesesuaian pelaku seperti di bagian **Login**.
- Sheet berisi hash password: batasi siapa yang boleh membuka spreadsheet-nya.
- Apps Script punya kuota harian dan latensi ±0,3–1,5 detik untuk penulisan; cocok untuk puluhan pengguna, bukan ribuan.
- Dua orang membuat request di detik yang sama: yang kedua ditolak dengan pesan jelas dan data dimuat ulang, lalu ia tinggal mengulang.
