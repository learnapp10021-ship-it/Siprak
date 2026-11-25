-- USULAN policy RLS untuk project "siprak". BELUM DITERAPKAN ke database.
-- Saat ini 11 tabel punya RLS aktif tanpa policy, jadi Publishable Key tidak bisa baca/tulis apa pun.
--
-- Pilih SATU opsi sesuai cara login aplikasi:
--
-- OPSI A (disarankan): login memakai Supabase Auth. Hanya pengguna yang sudah login
-- (role "authenticated") boleh mengakses data. Pengguna anonim ditolak sepenuhnya.
--
-- OPSI B: login memakai tabel "users" buatan sendiri (ID/PIN dicek di aplikasi).
-- JANGAN membuka tabel untuk role "anon": siapa pun yang punya key di browser bisa
-- membaca/mengubah semua data, termasuk kolom hp/role/boss di tabel users.
-- Untuk kasus ini, akses lewat Edge Function atau pindahkan login ke Supabase Auth.

-- ===== OPSI A =====
do $$
declare
  t text;
begin
  -- Tabel operasional: baca + tulis untuk pengguna yang sudah login.
  foreach t in array array[
    'master','request','item','konsolidasi','srl',
    'kedatangan','serahterima','pengingat','tx','meta'
  ] loop
    execute format('drop policy if exists "auth_select" on public.%I', t);
    execute format('drop policy if exists "auth_insert" on public.%I', t);
    execute format('drop policy if exists "auth_update" on public.%I', t);
    execute format('drop policy if exists "auth_delete" on public.%I', t);
    execute format('create policy "auth_select" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "auth_insert" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "auth_update" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "auth_delete" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- Tabel users (data karyawan): hanya baca untuk pengguna login, tanpa tulis dari klien.
-- Perketat lagi (mis. hanya baris milik sendiri) setelah ada pemetaan auth.uid() -> users.id.
drop policy if exists "auth_select" on public.users;
create policy "auth_select" on public.users for select to authenticated using (true);
