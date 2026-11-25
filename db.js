// Helper CRUD terpusat untuk 11 tabel Siprak di Supabase.
// File ini murni logic (tidak mengimpor supabase-js) supaya mudah diuji.
// Semua kolom data bertipe text; kolom `seq` adalah identity otomatis dan
// TIDAK boleh dikirim saat insert/update.

// Primary key tiap tabel (sesuai skema project "siprak").
export const TABLES = {
  users: 'id',
  master: 'k',
  request: 'id',
  item: 'id',
  konsolidasi: 'id',
  srl: 'no',
  kedatangan: 'id',
  serahterima: 'id',
  pengingat: 'id',
  tx: 'tx',
  meta: 'id',
};

// ID unik dari sisi klien. Dipakai sebagai kunci idempotensi:
// kirim ulang baris yang sama = menimpa baris yang sama, bukan menambah baris baru.
export function newId(prefix = '') {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return prefix ? `${prefix}-${rand}` : rand;
}

function unwrap(result, ctx) {
  const { data, error } = result;
  if (error) {
    const err = new Error(`[${ctx}] ${error.message}`);
    err.code = error.code;
    err.details = error.details;
    err.cause = error;
    throw err;
  }
  return data;
}

// Buang kolom yang dikelola database (identity) dan nilai undefined.
function clean(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'seq' || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function createDb(client) {
  // Satu operasi tulis per kunci pada satu waktu: klik ganda / kirim ganda
  // memakai promise yang sama, jadi tidak ada permintaan dobel ke server.
  const inflight = new Map();
  function once(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve()
      .then(fn)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  function table(name) {
    const pk = TABLES[name];
    return {
      name,
      pk,

      // filters: { kolom: nilai } -> eq. Paginasi lewat from/limit.
      async list({ filters = {}, orderBy = 'seq', ascending = true, limit = 1000, from = 0 } = {}) {
        let q = client.from(name).select('*');
        for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
        q = q.order(orderBy, { ascending }).range(from, from + limit - 1);
        return unwrap(await q, `${name}.list`) ?? [];
      },

      async get(id) {
        const res = await client.from(name).select('*').eq(pk, id).maybeSingle();
        return unwrap(res, `${name}.get`);
      },

      // Simpan idempoten: insert jika baru, timpa jika PK sudah ada.
      async upsert(row) {
        const data = clean(row);
        if (data[pk] === undefined || data[pk] === null || data[pk] === '') {
          throw new Error(`[${name}.upsert] kolom kunci "${pk}" wajib diisi (gunakan newId())`);
        }
        return once(`${name}:${data[pk]}`, async () =>
          unwrap(
            await client.from(name).upsert(data, { onConflict: pk }).select().single(),
            `${name}.upsert`,
          ),
        );
      },

      // Simpan banyak baris sekaligus (satu request, atomik di sisi server).
      async upsertMany(rows) {
        if (!rows.length) return [];
        const data = rows.map(clean);
        for (const r of data) {
          if (r[pk] === undefined || r[pk] === null || r[pk] === '') {
            throw new Error(`[${name}.upsertMany] ada baris tanpa kolom kunci "${pk}"`);
          }
        }
        const ids = data.map((r) => r[pk]).sort().join('|');
        return once(`${name}:many:${ids}`, async () =>
          unwrap(await client.from(name).upsert(data, { onConflict: pk }).select(), `${name}.upsertMany`),
        );
      },

      // Ubah sebagian kolom. Error jika baris tidak ditemukan (bukan diam-diam gagal).
      async update(id, patch) {
        const data = clean(patch);
        delete data[pk];
        return once(`${name}:${id}`, async () => {
          const rows = unwrap(
            await client.from(name).update(data).eq(pk, id).select(),
            `${name}.update`,
          );
          if (!rows || rows.length === 0) {
            throw new Error(`[${name}.update] baris "${id}" tidak ditemukan atau tidak diizinkan oleh RLS`);
          }
          return rows[0];
        });
      },

      async remove(id) {
        return once(`${name}:del:${id}`, async () => {
          const rows = unwrap(await client.from(name).delete().eq(pk, id).select(), `${name}.remove`);
          return (rows?.length ?? 0) > 0;
        });
      },
    };
  }

  return Object.fromEntries(Object.keys(TABLES).map((n) => [n, table(n)]));
}
