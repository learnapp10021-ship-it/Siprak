// Koneksi Supabase terpusat. Impor dari sini di seluruh modul:
//   import { supabase, db } from './lib/supabase';
// Hanya Project URL dan Publishable Key yang dipakai di frontend.
import { createClient } from '@supabase/supabase-js';
import { createDb } from './db.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY di file .env, lalu restart dev server.',
  );
}

// Pengaman: tolak Secret Key / Service Role Key agar tidak ikut terkirim ke browser.
function decodeJwtRole(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role;
  } catch {
    return undefined;
  }
}
if (key.startsWith('sb_secret_') || decodeJwtRole(key) === 'service_role') {
  throw new Error(
    'Key yang dipakai adalah Secret/Service Role Key. Jangan pernah dipakai di frontend. Gunakan Publishable Key (sb_publishable_...).',
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { headers: { 'x-client-info': 'siprak-web' } },
});

// Helper CRUD untuk 11 tabel: db.item.list(), db.request.upsert({...}), dst.
export const db = createDb(supabase);
