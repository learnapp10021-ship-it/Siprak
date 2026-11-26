# NRB di Supabase (tanpa mode demo)

Aplikasi memakai Supabase bila `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` terisi. Build produksi **tanpa** database
menampilkan galat konfigurasi, bukan mode demo (demo hanya jika `VITE_ALLOW_DEMO=1`).

## Langkah (sekali, dikerjakan di akun Supabase Anda)
1. **SQL Editor**: jalankan `supabase/setup.sql` (menambah kolom `_v`/`tx`/`at` bila belum ada, mengaktifkan RLS: hanya pengguna login yang boleh akses).
   Setup juga membuat fungsi `login_users()` supaya layar login menampilkan **daftar pilihan pengguna** (id, nama, dept, peran; tanpa hp/atasan). Untuk database yang sudah berjalan cukup jalankan `supabase/login_users.sql`. Tanpa fungsi ini layar login memakai kotak ketik ID.
2. **Akun login**: di komputer Anda jalankan
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=sb_secret_... node scripts/create-auth-users.mjs`
   Skrip membuat akun `<id>@login.siprak.app` + PIN acak 6 digit untuk tiap baris `users` dan mencetaknya sekali. Secret key hanya untuk skrip ini, jangan di `.env` berawalan `VITE_`.
3. **Authentication > Providers > Email**: matikan *Confirm email* dan *Allow new users to sign up* (akun hanya dibuat admin).
4. Isi secret GitHub `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY`, lalu jalankan workflow deploy.
5. Data awal: isi tabel `users` (id, n, dept, role, boss, hp) dan `master`; selain itu aplikasi membuat baris sendiri.

## Cara kerja dan batasnya
- Login: ID + PIN (Supabase Auth). Identitas pelaku diambil dari sesi login, bukan dari klien; hak akses per peran memakai `src/lib/perm.js` (sama dengan server Apps Script).
- Tulis: tiap perubahan dijaga "nilai lama masih sama" (tidak menimpa perubahan orang lain, otomatis diulang), rencana tulis dicatat di tabel `tx` (PENDING lalu OK), kirim ulang dengan tx sama tidak menggandakan data.
- Batas: tanpa transaksi database, putus koneksi di tengah rencana menunggu klien yang sama mengirim ulang. RLS saat ini memercayai semua pengguna login; penegakan peran di database butuh fungsi Postgres (RPC), langkah lanjutan yang disarankan.
- Cakupan skema yang diasumsikan: nama kolom sama dengan sheet lama (lihat `SCHEMA` di `backend/src/server.gs`) dan tiap tabel punya `seq` identity. Belum dites ke database asli (server saya tidak bisa menjangkau Supabase); uji dulu dengan beberapa akun sebelum dipakai massal.
