// URL Web App Apps Script (hasil Deploy → Web app, berakhiran /exec).
// Kosongkan untuk mode demo: data contoh di memori, tidak ada yang disimpan.
export const API_URL = import.meta.env.VITE_API_URL || ''

// Seberapa sering (ms) aplikasi mengecek perubahan dari pengguna lain saat tab terbuka.
export const POLL_MS = 15000
