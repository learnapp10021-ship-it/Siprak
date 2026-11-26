-- NRB di Supabase: jalankan SEKALI di SQL Editor (aman diulang). Urutan: bagian 1, lalu 2.
-- Tidak mengubah atau menghapus data yang sudah ada.

-- 1) Kolom pendukung (versi baris, jejak transaksi, waktu). Semua teks, sama dengan sheet lama.
do $$
declare t text; c text;
begin
  foreach t in array array['users','master','request','item','konsolidasi','srl','kedatangan','serahterima','pengingat'] loop
    foreach c in array array['_v','tx'] loop
      execute format('alter table public.%I add column if not exists %I text', t, c);
    end loop;
  end loop;
  foreach t in array array['request','kedatangan','serahterima','pengingat'] loop
    execute format('alter table public.%I add column if not exists at text', t);
  end loop;
  -- tabel transaksi: tx, action, actor, at, status, msg, ms
  foreach c in array array['action','actor','at','status','msg','ms'] loop
    execute format('alter table public.tx add column if not exists %I text', c);
  end loop;
end $$;

-- 2) Keamanan: hanya pengguna yang sudah login (Supabase Auth) yang boleh membaca/menulis.
--    Pengguna anonim (siapa pun yang membuka situs) ditolak sepenuhnya.
do $$
declare t text;
begin
  foreach t in array array['master','request','item','konsolidasi','srl','kedatangan','serahterima','pengingat','tx','meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "auth_select" on public.%I', t);
    execute format('drop policy if exists "auth_insert" on public.%I', t);
    execute format('drop policy if exists "auth_update" on public.%I', t);
    execute format('drop policy if exists "auth_delete" on public.%I', t);
    execute format('create policy "auth_select" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "auth_insert" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "auth_update" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "auth_delete" on public.%I for delete to authenticated using (true)', t);
  end loop;
  -- users: baca, tambah, ubah (profil/peran/nonaktif lewat aplikasi); tidak ada hapus.
  alter table public.users enable row level security;
  drop policy if exists "auth_select" on public.users;
  drop policy if exists "auth_insert" on public.users;
  drop policy if exists "auth_update" on public.users;
  create policy "auth_select" on public.users for select to authenticated using (true);
  create policy "auth_insert" on public.users for insert to authenticated with check (true);
  create policy "auth_update" on public.users for update to authenticated using (true) with check (true);
end $$;

-- Catatan keamanan: kebijakan di atas memercayai semua pengguna login. Aturan per peran (siapa boleh ubah apa)
-- ditegakkan di aplikasi (perm.js). Untuk penegakan di database, pindahkan penulisan ke fungsi Postgres (RPC).

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
