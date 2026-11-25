# Backend Supabase (Postgres + Edge Function)

Pengganti Google Apps Script/Spreadsheet. **Protokol HTTP sama persis**, jadi klien React tidak berubah; hanya `VITE_API_URL` yang berbeda.

```
Peramban --HTTP--> Edge Function "api" --service_role--> Postgres (RLS terkunci)
```

- `migrations/0001_nrb.sql`: 9 tabel data + `tx` (log transaksi) + `meta` (versi). RLS aktif tanpa kebijakan dan hak `anon`/`authenticated`
  dicabut, jadi **hanya Edge Function** yang bisa membaca/menulis. Peramban tidak pernah menyentuh database langsung.
  Fungsi `nrb_load`, `nrb_ver`, `nrb_apply` (penulisan atomik dengan kunci versi dan replay transaksi).
- `functions/api/index.ts`: HASIL BUILD (`npm run build:supabase`), jangan diedit. Dibangun dari kode bisnis yang sama dengan klien
  dan Apps Script (`src/lib`, `backend/src/rules.gs`, hak akses di `backend/src/server.gs`) plus `backend/supabase/handler.js`.
- Zona waktu aturan tanggal dipaksa WIB (`APP_TZ`, bawaan `Asia/Jakarta`); Edge Function sendiri berjalan di UTC.
- `seed-demo.sql`: pengguna + master contoh (tanpa request). **Hanya untuk uji coba.**

## Pasang (sekali)

```bash
npm i -g supabase            # atau: npx supabase ...
supabase login
supabase link --project-ref <project-ref>
supabase db push                                   # menerapkan migrations/0001_nrb.sql
supabase secrets set API_KEY=<rahasia-opsional>    # opsional; samakan dengan VITE_API_KEY saat build
supabase functions deploy api --no-verify-jwt      # (config.toml sudah verify_jwt=false)
```

Data awal **sungguhan**: jangan jalankan `seed-demo.sql`. Isi tabel `users` lewat SQL Editor (minimal satu `Admin Warehouse`;
kolom `boss` berisi ID atasan, bukan nama), lalu impor master item dari menu Master item di aplikasi.

```sql
insert into public.users ("id","n","dept","role","boss","hp") values
  ('wati.wh','Wati Handayani','Warehouse','Admin Warehouse','','6281200000001');
```

Cek: `curl "https://<project-ref>.supabase.co/functions/v1/api?action=ping"` harus menjawab `{"ok":true,"time":"..."}`.

## Build aplikasi

`.env.production` sudah berisi `VITE_API_URL`, jadi `npm run build` otomatis menghasilkan **mode sebenarnya**.

## Uji lokal tanpa akun Supabase

```bash
npm run test:supabase                      # 83 uji di atas Postgres sungguhan (PGlite)
node scripts/mock-supabase.mjs             # server lokal + data contoh: http://127.0.0.1:4181/functions/v1/api
VITE_API_URL=http://127.0.0.1:4181/functions/v1/api npm run dev
```

## Catatan konkurensi

Penulisan memakai antrean per isolate + kunci versi di database (`nrb_apply` mengunci baris `meta`). Dua isolate yang menulis bersamaan
tidak pernah menimpa satu sama lain: yang kalah menghitung ulang atas data terbaru; transaksi yang sama (ID `tx`) tidak pernah tertulis dua kali.
