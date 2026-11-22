# SIPRAK — Request Barang (React)

Aplikasi request barang: pengajuan → persetujuan atasan → pembuatan SRL di ERO → kedatangan → serah terima,
dengan dashboard Warehouse untuk OPR mingguan. Versi React dari `legacy/Request_Barang_v2.html`.

## Menjalankan

```bash
npm install
npm run dev      # pengembangan
npm run build    # hasil di dist/ (base './', aman untuk GitHub Pages)
```

## Struktur

```
src/
  data/seed.js          data contoh (ganti dengan API saat produksi)
  lib/selectors.js      logika turunan: jatah, sisa, status per barang
  lib/actions.js        semua perubahan data + validasi (immer)
  lib/utils.js          tanggal, WhatsApp, helper
  store.jsx             state global (data + UI) dan toast
  components/           ui kecil, drawer, sheet detail/pengguna/bantuan
  views/                layar per peran
  styles.css            CSS asli, tidak diubah
```

Peran: User, Atasan, Admin Dept, Admin Warehouse, Spv Warehouse. Menu "Lihat sebagai (demo)" di drawer
untuk berpindah peran. Data masih di memori (hilang saat refresh).
