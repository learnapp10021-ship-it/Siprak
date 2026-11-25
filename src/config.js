// URL Web App Apps Script (hasil Deploy → Web app, berakhiran /exec).
// Kosongkan untuk mode demo: data contoh di memori, tidak ada yang disimpan.
export const API_URL = import.meta.env.VITE_API_URL || ''

// Seberapa sering (ms) aplikasi mengecek perubahan dari pengguna lain saat tab terbuka.
export const POLL_MS = +import.meta.env.VITE_POLL_MS || 15000

// Supabase: hanya Project URL dan Publishable Key (aman untuk browser; keamanan data dijaga RLS + login).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

// Mode demo (data contoh di memori) hanya untuk pengembangan. Build produksi menolaknya kecuali VITE_ALLOW_DEMO=1.
export const DEMO_OK = !import.meta.env.PROD || import.meta.env.VITE_ALLOW_DEMO === '1'
