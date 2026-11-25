// Hak akses dan pengikatan identitas pelaku. Satu sumber untuk server Apps Script dan klien Supabase.
// ---------- hak akses (server tidak percaya peran/identitas dari klien) ----------
export const ADMIN_ROLES = ['Admin Dept', 'Admin Warehouse']
export const WH_ROLES = ['Admin Warehouse', 'Spv Warehouse']
export function deptOfItem_(d, sel, id) {
  const i = d.I.find(x => x.id === id)
  if (!i) return null
  const r = sel.RQ(i.req)
  return r ? sel.user(r.by) && sel.user(r.by).dept : null
}
export const PERM = {
  saveUser(a, args, d, sel) {
    const f = args[0] || {}
    if (f.mode === 'new') {
      if (!ADMIN_ROLES.includes(a.role)) return 'Hanya admin yang boleh menambah pengguna.'
      if (a.role === 'Admin Dept' && WH_ROLES.includes(f.role)) return 'Role tersebut tidak diizinkan untuk Anda.'
      return ''
    }
    if (f.self) return f.id === a.id ? '' : 'Anda hanya boleh mengubah profil sendiri.'
    if (!ADMIN_ROLES.includes(a.role)) return 'Hanya admin yang boleh mengubah pengguna.'
    const u = sel.user(f.id)
    if (!u) return 'Pengguna tidak ditemukan.'
    if (a.role === 'Admin Dept' && (u.dept !== a.dept || WH_ROLES.includes(f.role))) return 'Anda hanya boleh mengubah pengguna di departemen Anda.'
    return ''
  },
  saveRequest: a => (a.role === 'User' ? '' : 'Hanya user yang boleh membuat request.'),
  ajukan(a, args, d, sel) {
    const r = sel.RQ(args[0])
    return !r ? 'Request tidak ditemukan.' : r.by === a.id ? '' : 'Ini bukan request Anda.'
  },
  batal(a, args, d, sel) {
    const r = sel.RQ(args[0])
    return !r ? 'Request tidak ditemukan.' : r.by === a.id ? '' : 'Ini bukan request Anda.'
  },
  setuju(a, args, d, sel) {
    const r = sel.RQ(args[0])
    if (!r) return 'Request tidak ditemukan.'
    const u = sel.user(r.by)
    return u && u.boss === a.id ? '' : 'Anda bukan atasan pemilik request ini.'
  },
  tolak(a, args, d, sel) {
    return PERM.setuju(a, args, d, sel)
  },
  setujuAll: a => (a.role === 'Atasan' ? '' : 'Hanya atasan yang boleh menyetujui.'),
  tahan(a, args, d, sel) {
    return a.role === 'Admin Dept' && deptOfItem_(d, sel, args[0]) === a.dept ? '' : 'Barang ini bukan di departemen Anda.'
  },
  lepas(a, args, d, sel) {
    return PERM.tahan(a, args, d, sel)
  },
  simpanSrl: a => (a.role === 'Admin Dept' ? '' : 'Hanya Admin Dept yang boleh membuat SRL.'),
  tutup(a, args, d, sel) {
    const k = sel.KN(args[0])
    return a.role === 'Admin Dept' && k && k.dept === a.dept ? '' : 'Konsolidasi ini bukan di departemen Anda.'
  },
  datang: a => (a.role === 'Admin Warehouse' ? '' : 'Hanya Admin Warehouse yang boleh mencatat kedatangan.'),
  saveMaster: a => (a.role === 'Admin Warehouse' ? '' : 'Hanya Admin Warehouse yang boleh mengubah master item.'),
  importMaster: a => PERM.saveMaster(a),
  keluarkan: a => PERM.saveMaster(a),
  validasiSrl: a => PERM.saveMaster(a),
  serahAll: a => PERM.saveMaster(a),
  datangAll: a => PERM.datang(a),
  serah: a => PERM.datang(a),
  ingat: a => PERM.datang(a),
  ingatAll: a => PERM.datang(a),
}
// Identitas pelaku selalu diambil dari server, bukan dari argumen klien
export const BIND = {
  // departemen hanya boleh ditentukan Admin Warehouse
  saveUser: (a, x) => [Object.assign({}, x[0], { me: a, dept: a.role === 'Admin Warehouse' ? x[0].dept : undefined })],
  saveRequest: (a, x) => [{ status: x[0].status, lines: x[0].lines, me: a }],
  simpanSrl: (a, x) => [Object.assign({}, x[0], { me: a })],
  datang: (a, x) => [Object.assign({}, x[0], { by: a.id })],
  datangAll: (a, x) => [x[0], a.id],
  keluarkan: (a, x) => [Object.assign({}, x[0], { by: a.n })],
  ingat: (a, x) => [x[0], a.id],
  ingatAll: (a, x) => [x[0], a.id],
  setujuAll: (a, x) => [a.id, x[1]],
}
