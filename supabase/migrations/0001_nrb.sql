-- ============================================================================================
-- NRB (Nota Request Barang) -- skema Postgres untuk Supabase. Pengganti Google Spreadsheet.
--
-- Semua kolom bertipe teks, sama persis dengan isi sheet sebelumnya (jumlah "12", tanggal "2026-11-20"),
-- supaya aturan bisnis yang sudah teruji tidak berubah. Urutan kolom/nama mengikuti SCHEMA di backend/src/server.gs;
-- uji backend/test/supabase.mjs memastikan keduanya selalu sama.
--
-- KEAMANAN: RLS aktif di semua tabel TANPA kebijakan, dan hak anon/authenticated dicabut. Hanya Edge Function
-- "api" (kunci service_role) yang bisa membaca/menulis. Peramban tidak pernah menyentuh database langsung.
-- ============================================================================================

-- Satu baris versi: dikunci (FOR UPDATE) oleh setiap penulisan => penulis dilayani satu per satu secara berurutan.
create table if not exists public.meta (
  id  int primary key default 1 check (id = 1),
  ver bigint not null default 1
);
insert into public.meta (id, ver) values (1, 1) on conflict (id) do nothing;

-- Log transaksi: kunci utama tx menjamin satu transaksi tidak pernah tertulis dua kali (kirim ulang => "replay").
create table if not exists public.tx (
  tx     text primary key,
  action text not null default '',
  actor  text not null default '',
  at     timestamptz not null default now(),
  status text not null default 'OK',
  msg    text not null default '',
  ms     text not null default ''
);

create table if not exists public.users (
  seq bigint generated always as identity unique,
  "id" text not null default '' primary key,
  "n" text not null default '',
  "dept" text not null default '',
  "role" text not null default '',
  "boss" text not null default '',
  "hp" text not null default '',
  "off" text not null default '',
  "_v" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.master (
  seq bigint generated always as identity unique,
  "k" text not null default '' primary key,
  "n" text not null default '',
  "sat" text not null default '',
  "buf" text not null default '',
  "kons" text not null default '',
  "lead" text not null default '',
  "_v" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.request (
  seq bigint generated always as identity unique,
  "id" text not null default '' primary key,
  "by" text not null default '',
  "tgl" text not null default '',
  "st" text not null default '',
  "cat" text not null default '',
  "at" text not null default '',
  "_v" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.item (
  seq bigint generated always as identity unique,
  "id" text not null default '' primary key,
  "req" text not null default '',
  "kode" text not null default '',
  "qty" text not null default '',
  "datang" text not null default '',
  "pakai" text not null default '',
  "status" text not null default '',
  "appr" text not null default '',
  "kon" text not null default '',
  "tahan" text not null default '',
  "alasan" text not null default '',
  "_v" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.konsolidasi (
  seq bigint generated always as identity unique,
  "id" text not null default '' primary key,
  "dept" text not null default '',
  "by" text not null default '',
  "kode" text not null default '',
  "tahap" text not null default '',
  "srl" text not null default '',
  "ero" text not null default '',
  "tutup" text not null default '',
  "alasan" text not null default '',
  "_v" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.srl (
  seq bigint generated always as identity unique,
  "no" text not null default '' primary key,
  "dept" text not null default '',
  "est" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.kedatangan (
  seq bigint generated always as identity unique,
  "kon" text not null default '',
  "qty" text not null default '',
  "lebih" text not null default '',
  "by" text not null default '',
  "cat" text not null default '',
  "tgl" text not null default '',
  "id" text not null default '' primary key,
  "at" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.serahterima (
  seq bigint generated always as identity unique,
  "item" text not null default '',
  "qty" text not null default '',
  "to" text not null default '',
  "tgl" text not null default '',
  "id" text not null default '' primary key,
  "at" text not null default '',
  "tx" text not null default ''
);
create table if not exists public.pengingat (
  seq bigint generated always as identity unique,
  "item" text not null default '',
  "by" text not null default '',
  "at" text not null default '',
  "id" text not null default '' primary key,
  "tx" text not null default ''
);

-- ---------- Keamanan: kunci semua tabel ----------
alter table public.meta enable row level security;
alter table public.tx enable row level security;
alter table public.users enable row level security;
alter table public.master enable row level security;
alter table public.request enable row level security;
alter table public.item enable row level security;
alter table public.konsolidasi enable row level security;
alter table public.srl enable row level security;
alter table public.kedatangan enable row level security;
alter table public.serahterima enable row level security;
alter table public.pengingat enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
    end if;
  end loop;
end $$;

-- ---------- Membaca ----------
create or replace function public.nrb_ver() returns bigint
language sql stable as $$ select ver from public.meta where id = 1 $$;

-- Seluruh data + versi dalam SATU pernyataan SQL => satu snapshot yang konsisten.
create or replace function public.nrb_load() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'ver', (select ver from public.meta where id = 1),
    'tables', jsonb_build_object(
      'users', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.users t),
      'master', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.master t),
      'request', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.request t),
      'item', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.item t),
      'konsolidasi', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.konsolidasi t),
      'srl', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.srl t),
      'kedatangan', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.kedatangan t),
      'serahterima', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.serahterima t),
      'pengingat', (select coalesce(jsonb_agg(to_jsonb(t) - 'seq' order by t.seq), '[]'::jsonb) from public.pengingat t)
    )
  )
$$;

-- ---------- Menulis (atomik) ----------
-- p_changes = { "<tabel>": { "add": [baris...], "upd": [baris...] }, ... }
-- Mengembalikan {status: ok|replay|conflict, ver, msg}. Semua perubahan, kenaikan versi, dan log tx ada dalam satu
-- transaksi Postgres; galat apa pun membatalkan semuanya.
create or replace function public.nrb_apply(
  p_tx text, p_action text, p_actor text, p_expected bigint, p_changes jsonb, p_msg text, p_ms text
) returns jsonb
language plpgsql as $$
declare
  v_ver bigint;
  v_prior record;
  v_n int;
  v_ver_new bigint;
begin
  select ver into v_ver from public.meta where id = 1 for update; -- giliran penulisan

  select status, msg into v_prior from public.tx where tx = p_tx;
  if found and v_prior.status = 'OK' then
    return jsonb_build_object('status', 'replay', 'msg', v_prior.msg, 'ver', v_ver);
  end if;

  if v_ver <> p_expected then
    return jsonb_build_object('status', 'conflict', 'ver', v_ver);
  end if;

  -- users
  if jsonb_array_length(coalesce(p_changes -> 'users' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.users ("id", "n", "dept", "role", "boss", "hp", "off", "_v", "tx")
    select r."id", r."n", r."dept", r."role", r."boss", r."hp", r."off", r."_v", r."tx" from jsonb_populate_recordset(null::public.users, p_changes -> 'users' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'users' -> 'upd', '[]'::jsonb)) > 0 then
    update public.users t set "n" = r."n", "dept" = r."dept", "role" = r."role", "boss" = r."boss", "hp" = r."hp", "off" = r."off", "_v" = r."_v", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.users, p_changes -> 'users' -> 'upd') r
    where t."id" = r."id";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'users' -> 'upd') then
      raise exception 'baris tidak ditemukan di users';
    end if;
  end if;

  -- master
  if jsonb_array_length(coalesce(p_changes -> 'master' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.master ("k", "n", "sat", "buf", "kons", "lead", "_v", "tx")
    select r."k", r."n", r."sat", r."buf", r."kons", r."lead", r."_v", r."tx" from jsonb_populate_recordset(null::public.master, p_changes -> 'master' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'master' -> 'upd', '[]'::jsonb)) > 0 then
    update public.master t set "n" = r."n", "sat" = r."sat", "buf" = r."buf", "kons" = r."kons", "lead" = r."lead", "_v" = r."_v", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.master, p_changes -> 'master' -> 'upd') r
    where t."k" = r."k";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'master' -> 'upd') then
      raise exception 'baris tidak ditemukan di master';
    end if;
  end if;

  -- request
  if jsonb_array_length(coalesce(p_changes -> 'request' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.request ("id", "by", "tgl", "st", "cat", "at", "_v", "tx")
    select r."id", r."by", r."tgl", r."st", r."cat", r."at", r."_v", r."tx" from jsonb_populate_recordset(null::public.request, p_changes -> 'request' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'request' -> 'upd', '[]'::jsonb)) > 0 then
    update public.request t set "by" = r."by", "tgl" = r."tgl", "st" = r."st", "cat" = r."cat", "at" = r."at", "_v" = r."_v", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.request, p_changes -> 'request' -> 'upd') r
    where t."id" = r."id";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'request' -> 'upd') then
      raise exception 'baris tidak ditemukan di request';
    end if;
  end if;

  -- item
  if jsonb_array_length(coalesce(p_changes -> 'item' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.item ("id", "req", "kode", "qty", "datang", "pakai", "status", "appr", "kon", "tahan", "alasan", "_v", "tx")
    select r."id", r."req", r."kode", r."qty", r."datang", r."pakai", r."status", r."appr", r."kon", r."tahan", r."alasan", r."_v", r."tx" from jsonb_populate_recordset(null::public.item, p_changes -> 'item' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'item' -> 'upd', '[]'::jsonb)) > 0 then
    update public.item t set "req" = r."req", "kode" = r."kode", "qty" = r."qty", "datang" = r."datang", "pakai" = r."pakai", "status" = r."status", "appr" = r."appr", "kon" = r."kon", "tahan" = r."tahan", "alasan" = r."alasan", "_v" = r."_v", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.item, p_changes -> 'item' -> 'upd') r
    where t."id" = r."id";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'item' -> 'upd') then
      raise exception 'baris tidak ditemukan di item';
    end if;
  end if;

  -- konsolidasi
  if jsonb_array_length(coalesce(p_changes -> 'konsolidasi' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.konsolidasi ("id", "dept", "by", "kode", "tahap", "srl", "ero", "tutup", "alasan", "_v", "tx")
    select r."id", r."dept", r."by", r."kode", r."tahap", r."srl", r."ero", r."tutup", r."alasan", r."_v", r."tx" from jsonb_populate_recordset(null::public.konsolidasi, p_changes -> 'konsolidasi' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'konsolidasi' -> 'upd', '[]'::jsonb)) > 0 then
    update public.konsolidasi t set "dept" = r."dept", "by" = r."by", "kode" = r."kode", "tahap" = r."tahap", "srl" = r."srl", "ero" = r."ero", "tutup" = r."tutup", "alasan" = r."alasan", "_v" = r."_v", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.konsolidasi, p_changes -> 'konsolidasi' -> 'upd') r
    where t."id" = r."id";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'konsolidasi' -> 'upd') then
      raise exception 'baris tidak ditemukan di konsolidasi';
    end if;
  end if;

  -- srl
  if jsonb_array_length(coalesce(p_changes -> 'srl' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.srl ("no", "dept", "est", "tx")
    select r."no", r."dept", r."est", r."tx" from jsonb_populate_recordset(null::public.srl, p_changes -> 'srl' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'srl' -> 'upd', '[]'::jsonb)) > 0 then
    update public.srl t set "dept" = r."dept", "est" = r."est", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.srl, p_changes -> 'srl' -> 'upd') r
    where t."no" = r."no";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'srl' -> 'upd') then
      raise exception 'baris tidak ditemukan di srl';
    end if;
  end if;

  -- kedatangan
  if jsonb_array_length(coalesce(p_changes -> 'kedatangan' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.kedatangan ("kon", "qty", "lebih", "by", "cat", "tgl", "id", "at", "tx")
    select r."kon", r."qty", r."lebih", r."by", r."cat", r."tgl", r."id", r."at", r."tx" from jsonb_populate_recordset(null::public.kedatangan, p_changes -> 'kedatangan' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'kedatangan' -> 'upd', '[]'::jsonb)) > 0 then
    update public.kedatangan t set "kon" = r."kon", "qty" = r."qty", "lebih" = r."lebih", "by" = r."by", "cat" = r."cat", "tgl" = r."tgl", "at" = r."at", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.kedatangan, p_changes -> 'kedatangan' -> 'upd') r
    where t."id" = r."id";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'kedatangan' -> 'upd') then
      raise exception 'baris tidak ditemukan di kedatangan';
    end if;
  end if;

  -- serahterima
  if jsonb_array_length(coalesce(p_changes -> 'serahterima' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.serahterima ("item", "qty", "to", "tgl", "id", "at", "tx")
    select r."item", r."qty", r."to", r."tgl", r."id", r."at", r."tx" from jsonb_populate_recordset(null::public.serahterima, p_changes -> 'serahterima' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'serahterima' -> 'upd', '[]'::jsonb)) > 0 then
    update public.serahterima t set "item" = r."item", "qty" = r."qty", "to" = r."to", "tgl" = r."tgl", "at" = r."at", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.serahterima, p_changes -> 'serahterima' -> 'upd') r
    where t."id" = r."id";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'serahterima' -> 'upd') then
      raise exception 'baris tidak ditemukan di serahterima';
    end if;
  end if;

  -- pengingat
  if jsonb_array_length(coalesce(p_changes -> 'pengingat' -> 'add', '[]'::jsonb)) > 0 then
    insert into public.pengingat ("item", "by", "at", "id", "tx")
    select r."item", r."by", r."at", r."id", r."tx" from jsonb_populate_recordset(null::public.pengingat, p_changes -> 'pengingat' -> 'add') r;
  end if;
  if jsonb_array_length(coalesce(p_changes -> 'pengingat' -> 'upd', '[]'::jsonb)) > 0 then
    update public.pengingat t set "item" = r."item", "by" = r."by", "at" = r."at", "tx" = r."tx"
    from jsonb_populate_recordset(null::public.pengingat, p_changes -> 'pengingat' -> 'upd') r
    where t."id" = r."id";
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(p_changes -> 'pengingat' -> 'upd') then
      raise exception 'baris tidak ditemukan di pengingat';
    end if;
  end if;

  update public.meta set ver = ver + 1 where id = 1 returning ver into v_ver_new;
  insert into public.tx (tx, action, actor, status, msg, ms) values (p_tx, p_action, p_actor, 'OK', coalesce(p_msg, ''), coalesce(p_ms, ''));
  return jsonb_build_object('status', 'ok', 'ver', v_ver_new);
end $$;

-- Hanya service_role (Edge Function) yang boleh memanggil fungsi.
do $$
declare f text;
begin
  foreach f in array array['nrb_ver()', 'nrb_load()', 'nrb_apply(text,text,text,bigint,jsonb,text,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function public.%s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function public.%s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;
