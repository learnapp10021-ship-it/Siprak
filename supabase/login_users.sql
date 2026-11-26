-- Daftar pengguna untuk layar login (pengguna MEMILIH namanya, tidak mengetik ID).
-- Jalankan di SQL Editor Supabase (aman dijalankan berulang). Juga sudah termasuk di setup.sql.
--
-- Keamanan: tabel users tetap tertutup untuk anon (RLS). Fungsi ini security definer dan HANYA mengembalikan
-- id, nama, departemen, dan peran pengguna yang aktif. Tanpa hp, atasan, atau kolom internal. PIN tetap diperiksa
-- Supabase Auth saat login. Jika Anda tidak ingin nama karyawan terlihat sebelum login, jangan jalankan berkas ini:
-- layar login otomatis kembali ke kotak ketik ID.
create or replace function public.login_users()
returns table (id text, n text, dept text, role text)
language sql stable security definer set search_path = public
as $$
  select u."id", u."n", u."dept", u."role"
  from public.users u
  where coalesce(u."off", '') <> 'Y'
  order by u."n"
$$;
revoke all on function public.login_users() from public;
grant execute on function public.login_users() to anon, authenticated;
