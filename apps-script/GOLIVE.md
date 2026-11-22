# Checklist go live SIPRAK

Urutan kerja dari data contoh sampai dipakai sungguhan. Semua langkah Apps Script ada di menu **SIPRAK** pada spreadsheet.
Dialog **SIPRAK → Pengaturan WA dan Go Live → Cek kesiapan go live** memeriksa sebagian besar butir di bawah secara otomatis.

## 1. Pasang kode terbaru
- [ ] Tempel `Code.gs`, `Fonnte.gs`, `Seed.gs`, `Settings.html` (dan `appsscript.json`). Jalankan `setup()` sekali (menyetujui izin).
- [ ] **Deploy → Manage deployments → Edit → New version**. Buka `…/exec?fn=info`, harus `"gs":"2.1.0"`.
- [ ] Muat ulang spreadsheet; menu **SIPRAK** muncul.

## 2. Data sungguhan
- [ ] Sheet `Users`: satu baris per orang. Kolom `id` (email), `n` nama, `dept`, `role` (`User`, `Atasan`, `Admin Dept`, `Admin Warehouse`, `Spv Warehouse`), `boss` (id atasan, wajib untuk `User`), `hp` (08xx atau 628xx), `off` kosong.
- [ ] Setiap departemen punya minimal 1 `Admin Dept` aktif; Warehouse punya `Admin Warehouse` dan `Spv Warehouse`.
- [ ] Sheet `Master`: isi item sungguhan (kode, nama, satuan, buffer, konsinyasi, lead time hari). Bisa tempel dari Excel lewat layar Master item di aplikasi.
- [ ] Hapus pengguna dan nomor contoh (`hendra.mgr`, nomor `62812345600xx`, dst.).
- [ ] Jika sudah ada data uji: **SIPRAK → Kosongkan data transaksi** (ketik `RESET`). Pengguna dan Master tidak ikut terhapus.

## 3. WhatsApp Fonnte
- [ ] Tiap Admin Dept menyambungkan nomor WA-nya di fonnte.com (scan QR) dan menyalin **token perangkat**. Warehouse juga (dipakai untuk pengingat ke Admin Dept).
- [ ] Dialog Pengaturan → **Perangkat WhatsApp**: tempel token + nomor pengirim per departemen → **Simpan** → **Tes kirim** ke HP sendiri. Pastikan pesan masuk.
- [ ] Bagian **Aturan pengingat**: jam kirim, hari kirim, jarak ulang, batas jumlah. Bawaan: 08:00 WIB, Senin–Sabtu.
- [ ] Biarkan mode **SIMULASI** dulu, tekan **Kirim pengingat sekarang**, lalu baca sheet `LogWA`: siapa menerima apa, dari perangkat mana. Perbaiki bila ada `NOMOR TIDAK VALID` atau `TANPA PERANGKAT`.
- [ ] Praktik aman WhatsApp: gunakan nomor yang sudah dipakai normal, pesan berisi data pribadi penerima (sudah begitu), jeda antar pesan 2–5 detik (bawaan), jangan menaikkan batas kirim sembarangan. Pastikan penerima tahu akan menerima pengingat ini.

## 4. Uji alur dengan data nyata kecil (UAT)
Jalankan sekali dengan 2–3 orang, satu departemen:
- [ ] User membuat request → muncul di Atasan → disetujui.
- [ ] Admin Dept: barang muncul di Pool → salin ke ERO → simpan nomor SRL.
- [ ] Admin Warehouse: validasi SRL (coba juga **keluarkan** satu barang; ia kembali ke Pool).
- [ ] Warehouse catat kedatangan (sebagian, lalu sisanya; coba tutup sisa).
- [ ] Serah terima ke PIC. Dashboard Spv Warehouse menampilkan angka yang sama.
- [ ] Buka aplikasi di dua HP sekaligus, lakukan aksi bersamaan pada barang yang sama: yang kedua harus mendapat pesan "Data dimuat ulang".

## 5. Aplikasi (frontend)
- [ ] Salin URL `/exec`, bangun aplikasi: `VITE_API_URL="https://script.google.com/macros/s/XXXX/exec" npm run build`, lalu publikasikan isi `dist/` (mis. GitHub Pages).
- [ ] Buka dari HP dan desktop, login sebagai tiap peran, pastikan data muncul.

## 6. Hidupkan
- [ ] Dialog Pengaturan: ubah mode ke **LIVE** → Simpan. Tekan **Pasang jadwal harian** (menyetujui izin trigger).
- [ ] **Cek kesiapan go live** harus menyatakan siap (tidak ada butir merah).
- [ ] Hari pertama: pantau sheet `LogWA` (status `TERKIRIM` / `GAGAL`) dan tanyakan ke beberapa penerima apakah pesan masuk.

## Risiko yang perlu diputuskan
| Risiko | Keterangan | Langkah |
|---|---|---|
| Tanpa login | URL Web App "Anyone": siapa pun yang tahu URL bisa membaca/menulis data dan melihat nomor WA | Rahasiakan URL; rencanakan login (mis. PIN per pengguna atau Google Sign-In) sebelum pemakaian luas |
| WhatsApp tidak resmi | Fonnte memakai WA Web; nomor bisa dibatasi WhatsApp bila dianggap spam | Volume kecil, pesan relevan, jangan broadcast; siapkan jalur cadangan (tombol manual "Ingatkan via WA") |
| Kuota/paket Fonnte | Pesan gagal bila kuota habis (`insufficient quota` di `LogWA`) | Pantau kuota; perangkat dengan token tidak valid dilewati otomatis |
| Kuota Apps Script | Latensi tulis ±0,3–1,5 detik; cocok puluhan pengguna | Pantau bila pengguna bertambah |
| Backup | Spreadsheet adalah satu-satunya database | Aktifkan version history; salin spreadsheet berkala (File → Make a copy) |

## Rollback
- Kode: **Deploy → Manage deployments → Edit → pilih versi sebelumnya**.
- Pengingat bermasalah: dialog Pengaturan → mode **SIMULASI** (berhenti mengirim seketika) atau **Hapus jadwal**.
- Cache aneh: jalankan `resetCache()` (data di sheet tidak disentuh).
