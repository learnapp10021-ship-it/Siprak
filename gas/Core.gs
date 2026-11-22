// FILE HASIL BUILD - jangan diedit. Jalankan: npm run build:gas (sumber: shared/)
var SiprakCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // shared/core.js
  var core_exports = {};
  __export(core_exports, {
    SYS: () => SYS,
    TABLES: () => TABLES,
    buildSeed: () => buildSeed,
    emptyState: () => emptyState,
    fromRow: () => fromRow,
    runAction: () => runAction,
    tableSig: () => tableSig,
    toRow: () => toRow,
    width: () => width
  });

  // shared/schema.js
  var SYS = ["_cr", "_ts", "_op", "_by"];
  var TABLES = {
    U: { sheet: "Users", key: "id", cols: ["id", "n", "dept", "role", "boss", "wa", "off"], bool: ["off"] },
    M: { sheet: "Master", key: "k", cols: ["k", "n", "sat", "buf", "kons", "lead"] },
    R: { sheet: "Requests", key: "id", cols: ["id", "by", "tgl", "st", "cat"] },
    I: { sheet: "Items", key: "id", cols: ["id", "req", "kode", "qty", "datang", "pakai", "status", "appr", "kon", "tahan", "alasan"] },
    K: { sheet: "Konsolidasi", key: "id", cols: ["id", "dept", "kode", "tahap", "srl", "ero", "tutup", "alasan", "by"] },
    L: { sheet: "SRL", key: "no", cols: ["no", "dept", "est"] },
    KD: { sheet: "Kedatangan", key: "id", cols: ["id", "kon", "qty", "lebih", "by", "cat", "tgl"] },
    SR: { sheet: "SerahTerima", key: "id", cols: ["id", "item", "qty", "to", "tgl"] },
    RM: { sheet: "Pengingat", key: "id", cols: ["id", "item", "by", "at"] }
  };
  var str = (v) => v == null ? "" : String(v);
  function toRow(t, o) {
    const T2 = TABLES[t];
    return [
      ...T2.cols.map((c) => T2.bool && T2.bool.includes(c) ? o[c] ? "1" : "" : str(o[c])),
      ...SYS.map((c) => str(o[c]))
    ];
  }
  function fromRow(t, a) {
    const T2 = TABLES[t];
    const o = {};
    T2.cols.forEach((c, i) => {
      o[c] = T2.bool && T2.bool.includes(c) ? str(a[i]) === "1" : str(a[i]);
    });
    SYS.forEach((c, i) => {
      o[c] = str(a[T2.cols.length + i]);
    });
    return o;
  }
  var width = (t) => TABLES[t].cols.length + SYS.length;
  var emptyState = () => Object.fromEntries(Object.keys(TABLES).map((k) => [k, []]));
  var tableSig = (t, rows) => JSON.stringify(rows.map((r) => toRow(t, r)));

  // shared/util.js
  var T = (s, k) => s.trim().split("\n").map((l) => Object.fromEntries(l.split("|").map((v, i) => [k[i], v])));
  var wa = (s) => {
    let d = String(s || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = "62" + d.slice(1);
    return /^628\d{8,11}$/.test(d) ? d : "";
  };
  var BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  var D = (d) => d ? `${+d.slice(8, 10)} ${BLN[+d.slice(5, 7) - 1]}` : "belum diisi";
  var addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
  var sum = (a, f) => a.reduce((s, x) => s + +f(x), 0);
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  var pad = (n, w = 2) => String(n).padStart(w, "0");

  // shared/selectors.js
  function makeSel(db) {
    const { U, M, R, I, K, L, KD, SR, RM } = db;
    const user = (id) => U.find((u) => u.id == id);
    const nm = (id) => {
      var _a;
      return ((_a = user(id)) == null ? void 0 : _a.n) || id;
    };
    const mi = (k) => M.find((m) => m.k == k);
    const KN = (id) => K.find((k) => k.id == id);
    const RQ = (id) => R.find((r) => r.id == id);
    const SRLof = (no) => L.find((l) => l.no == no);
    const live = (i) => !["Ditolak", "Dibatalkan"].includes(i.status);
    const total = (k) => sum(I.filter((i) => i.kon == k.id && live(i)), (i) => i.qty);
    const datang = (k) => sum(KD.filter((d) => d.kon == k.id), (d) => d.qty);
    const sisa = (k) => Math.max(0, total(k) - datang(k) - +k.tutup);
    const ord = (a, b) => (a.pakai || "9") < (b.pakai || "9") ? -1 : (a.pakai || "9") > (b.pakai || "9") ? 1 : a.appr < b.appr ? -1 : 1;
    const berhak = (it) => {
      const k = KN(it.kon);
      if (!k) return 0;
      let r = datang(k);
      for (const x of I.filter((i) => i.kon == k.id && live(i)).sort(ord)) {
        const g = Math.min(r, +x.qty);
        if (x.id == it.id) return g;
        r -= g;
      }
      return 0;
    };
    const diambil = (it) => sum(SR.filter((s) => s.item == it.id), (s) => s.qty);
    const siap = (it) => berhak(it) - diambil(it);
    const deptOf = (it) => user(RQ(it.req).by).dept;
    const lastArrival = (kon) => KD.filter((d) => d.kon == kon).map((d) => d.tgl).sort().pop();
    const firstArrival = (kon) => KD.filter((d) => d.kon == kon).map((d) => d.tgl).sort()[0];
    const st = (it) => {
      var _a;
      const s = it.status;
      const sat = mi(it.kode).sat;
      if (s == "Draft") return [0, "t-gray", "Draft, belum diajukan"];
      if (s == "Menunggu Approval") return [0, "t-warn", "Menunggu persetujuan atasan"];
      if (s == "Approved")
        return it.tahan ? [1, "t-warn", "Ditahan: " + it.alasan] : [1, "t-info", "Disetujui, menunggu diproses ke ERO"];
      if (s == "Masuk Konsolidasi") return [2, "t-vio", "Dikonsolidasi, belum masuk ERO"];
      if (s == "Sudah di ERO") {
        const b = berhak(it);
        const a = diambil(it);
        if (a >= +it.qty) return [4, "t-ok", "Sudah diambil semua"];
        if (b - a > 0) return [4, "t-ok", `Siap diambil ${b - a} dari ${it.qty} ${sat}`];
        const srl = SRLof((_a = KN(it.kon)) == null ? void 0 : _a.srl);
        return [
          3,
          "t-vio",
          "Sudah di ERO (" + KN(it.kon).srl + "), menunggu barang datang" + (srl ? " (est. " + D(srl.est) + ")" : "")
        ];
      }
      return [-1, s == "Ditolak" ? "t-bad" : "t-gray", s];
    };
    const poolAll = (d) => I.filter((i) => i.status == "Approved" && !i.kon && RQ(i.req) && deptOf(i) == d);
    const poolOf = (d) => poolAll(d).filter((i) => !i.tahan);
    return {
      user,
      nm,
      mi,
      KN,
      RQ,
      SRLof,
      live,
      total,
      datang,
      sisa,
      ord,
      berhak,
      diambil,
      siap,
      deptOf,
      lastArrival,
      firstArrival,
      st,
      poolAll,
      poolOf,
      reminders: (itemId) => RM.filter((x) => x.item == itemId)
    };
  }

  // shared/actions.js
  var EPS = 1e-9;
  var err = (m) => ({ err: m });
  var txt = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
  var num = (v) => v === "" || v == null ? NaN : Number(v);
  var fmt = (v) => String(Math.round(v * 1e6) / 1e6);
  var secs = (s) => Date.parse(s) / 1e3;
  var only = (c, ...roles) => roles.includes(c.actor.role) ? null : err("Peran Anda tidak berhak melakukan aksi ini.");
  var ALL_ROLES = ["User", "Atasan", "Admin Dept", "Admin Warehouse", "Spv Warehouse"];
  var DEPT_ROLES = ["User", "Atasan", "Admin Dept"];
  var setR = (d, id, s) => {
    d.R.find((r) => r.id == id).st = s;
    d.I.filter((i) => i.req == id).forEach((i) => {
      if (!["Ditolak", "Dibatalkan"].includes(i.status)) i.status = s;
    });
  };
  var recent = (rows, now, sec) => rows.filter((r) => r._cr && secs(now) - secs(r._cr) <= sec);
  var ACTIONS = {
    saveUser(c, a) {
      const { d, sel, actor } = c;
      const n = txt(a.n, 100);
      const rawWa = txt(a.rawWa, 30);
      const w = wa(rawWa);
      if (!n) return err("Isi nama.");
      if (rawWa && !w) return err("Nomor WhatsApp tidak valid. Contoh: 081234567890.");
      const aw = actor.role == "Admin Warehouse";
      const roles = aw ? ALL_ROLES : DEPT_ROLES;
      const checkBoss = (role, boss, dept2) => {
        if (role == "User" && !boss) return err("Pilih atasan untuk user, supaya request bisa disetujui.");
        if (boss) {
          const b = sel.user(boss);
          if (!b || b.role != "Atasan") return err("Atasan tidak valid.");
          if (!aw && b.dept != dept2) return err("Atasan harus dari departemen yang sama.");
        }
        return null;
      };
      if (a.mode == "new") {
        const g2 = only(c, "Admin Dept", "Admin Warehouse");
        if (g2) return g2;
        const e = txt(a.email, 120).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+$/.test(e)) return err("Isi email yang valid.");
        if (sel.user(e)) return err("Email sudah terdaftar.");
        if (!w) return err("Nomor WhatsApp wajib diisi untuk pengguna baru.");
        if (!roles.includes(a.role)) return err("Role tidak diizinkan.");
        const dept2 = aw ? txt(a.dept, 60) : actor.dept;
        if (!dept2) return err("Isi departemen.");
        const eb2 = checkBoss(a.role, a.boss, dept2);
        if (eb2) return eb2;
        d.U.push({ id: e, n, dept: dept2, role: a.role, boss: a.boss || "", wa: w, off: false });
        return { ok: "Pengguna ditambahkan.", ids: [e] };
      }
      const u = sel.user(a.id);
      if (!u) return err("Pengguna tidak ditemukan.");
      if (u.id == actor.id) {
        u.n = n;
        u.wa = w;
        return { ok: "Perubahan disimpan.", ids: [u.id] };
      }
      const g = only(c, "Admin Dept", "Admin Warehouse");
      if (g) return g;
      if (!aw && (u.dept != actor.dept || !roles.includes(u.role))) return err("Pengguna ini tidak bisa Anda ubah.");
      if (!roles.includes(a.role)) return err("Role tidak diizinkan.");
      const dept = aw && a.dept ? txt(a.dept, 60) : u.dept;
      const eb = checkBoss(a.role, a.boss, dept);
      if (eb) return eb;
      u.n = n;
      u.wa = w;
      u.role = a.role;
      u.boss = a.boss || "";
      u.dept = dept;
      if (typeof a.active == "boolean") u.off = !a.active;
      return { ok: "Perubahan disimpan.", ids: [u.id] };
    },
    saveRequest(c, a) {
      const { d, sel, actor, today, now } = c;
      const g = only(c, "User");
      if (g) return g;
      const status = a.status;
      if (!["Draft", "Menunggu Approval"].includes(status)) return err("Status tidak valid.");
      if (status == "Menunggu Approval" && !actor.boss)
        return err("Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.");
      const lines = Array.isArray(a.lines) ? a.lines : [];
      if (!lines.length) return err("Tambahkan minimal satu barang.");
      if (lines.length > 50) return err("Maksimal 50 barang per request.");
      const seen = /* @__PURE__ */ new Set();
      const clean = [];
      for (const x of lines) {
        const m = x && x.kode && sel.mi(x.kode);
        if (!m) return err("Pilih barang di setiap baris.");
        const q = num(x.qty);
        if (!(q > 0) || q > 1e7) return err("Jumlah harus lebih dari 0.");
        const datang = txt(x.datang, 10);
        const pakai = txt(x.pakai, 10);
        const min = addDays(today, +m.lead);
        if (!ISO_DATE.test(datang) || datang < min) return err(`${m.n}: tgl datang paling cepat ${D(min)}.`);
        if (m.buf == "0" && !pakai) return err(`${m.n}: tgl pakai wajib untuk barang non buffer.`);
        if (pakai && !ISO_DATE.test(pakai)) return err(`${m.n}: tgl pakai tidak valid.`);
        if (pakai && pakai < datang) return err(`${m.n}: tgl pakai tidak boleh sebelum tgl datang.`);
        const sig = [m.k, q, datang, pakai].join("|");
        if (seen.has(sig)) return err(`${m.n}: baris identik muncul dua kali. Gabungkan jumlahnya.`);
        seen.add(sig);
        clean.push({ kode: m.k, qty: fmt(q), datang, pakai });
      }
      const sigOf = (ls) => ls.map((x) => [x.kode, +x.qty, x.datang, x.pakai || ""].join("|")).sort().join(";");
      const mine = recent(d.R.filter((r) => r.by == actor.id && !["Dibatalkan", "Ditolak"].includes(r.st)), now, 120);
      for (const r of mine)
        if (sigOf(d.I.filter((i) => i.req == r.id)) == sigOf(clean))
          return err(`Request yang sama (${r.id}) baru saja dibuat. Cek di Request saya sebelum membuat lagi.`);
      const id = c.newId("R", "RQ", 3);
      d.R.push({ id, by: actor.id, tgl: today, st: status, cat: "" });
      const ids = [id];
      clean.forEach((x) => {
        const iid = c.newId("I", "ITM", 3);
        d.I.push({ id: iid, req: id, kode: x.kode, qty: x.qty, datang: x.datang, pakai: x.pakai, status, appr: "", kon: "", tahan: "", alasan: "" });
      });
      return { ok: status == "Draft" ? "Draft disimpan." : "Diajukan ke atasan.", ids };
    },
    ajukan(c, a) {
      const r = c.d.R.find((x) => x.id == a.id);
      if (!r) return err("Request tidak ditemukan.");
      if (r.by != c.actor.id) return err("Ini bukan request Anda.");
      if (r.st != "Draft") return err(`Request sudah berstatus ${r.st}. Muat ulang halaman.`);
      if (!c.actor.boss) return err("Akun Anda belum punya atasan. Hubungi admin departemen.");
      setR(c.d, r.id, "Menunggu Approval");
      return { ok: "Diajukan ke atasan.", ids: [r.id] };
    },
    batal(c, a) {
      const r = c.d.R.find((x) => x.id == a.id);
      if (!r) return err("Request tidak ditemukan.");
      if (r.by != c.actor.id) return err("Ini bukan request Anda.");
      if (!["Draft", "Menunggu Approval"].includes(r.st)) return err(`Request sudah berstatus ${r.st} dan tidak bisa dibatalkan.`);
      setR(c.d, r.id, "Dibatalkan");
      return { ok: "Request dibatalkan.", ids: [r.id] };
    },
    setuju(c, a) {
      var _a;
      const { d, sel, actor } = c;
      const g = only(c, "Atasan");
      if (g) return g;
      const r = d.R.find((x) => x.id == a.id);
      if (!r) return err("Request tidak ditemukan.");
      if (((_a = sel.user(r.by)) == null ? void 0 : _a.boss) != actor.id) return err("Request ini bukan dari tim Anda.");
      if (r.st != "Menunggu Approval") return err(`Request sudah berstatus ${r.st} (mungkin dibatalkan atau sudah diputuskan).`);
      r.st = "Disetujui";
      d.I.filter((i) => i.req == r.id).forEach((i) => {
        i.status = "Approved";
        i.appr = c.now;
      });
      const dp = sel.user(r.by).dept;
      const ad = d.U.find((u) => u.role == "Admin Dept" && u.dept == dp && !u.off);
      return {
        ok: ad ? `Disetujui. Diteruskan ke ${ad.n} (Admin ${dp}).` : `Disetujui, tapi belum ada Admin Dept aktif di ${dp}. Hubungi Admin Warehouse.`,
        ids: [r.id]
      };
    },
    setujuAll(c) {
      const { d, sel, actor } = c;
      const g = only(c, "Atasan");
      if (g) return g;
      const l = d.R.filter((r) => {
        var _a;
        return r.st == "Menunggu Approval" && ((_a = sel.user(r.by)) == null ? void 0 : _a.boss) == actor.id;
      });
      if (!l.length) return err("Tidak ada request yang menunggu.");
      l.forEach((r) => {
        r.st = "Disetujui";
        d.I.filter((i) => i.req == r.id).forEach((i) => {
          i.status = "Approved";
          i.appr = c.now;
        });
      });
      return { ok: l.length + " request disetujui dan diteruskan ke admin departemen.", ids: l.map((r) => r.id) };
    },
    tolak(c, a) {
      var _a;
      const { d, sel, actor } = c;
      const g = only(c, "Atasan");
      if (g) return g;
      const cat = txt(a.catatan, 500);
      if (!cat) return err("Isi catatan sebelum menolak.");
      const r = d.R.find((x) => x.id == a.id);
      if (!r) return err("Request tidak ditemukan.");
      if (((_a = sel.user(r.by)) == null ? void 0 : _a.boss) != actor.id) return err("Request ini bukan dari tim Anda.");
      if (r.st != "Menunggu Approval") return err(`Request sudah berstatus ${r.st} (mungkin dibatalkan atau sudah diputuskan).`);
      r.cat = cat;
      setR(d, r.id, "Ditolak");
      return { ok: "Ditolak.", ids: [r.id] };
    },
    tahan(c, a) {
      const g = only(c, "Admin Dept");
      if (g) return g;
      const alasan = txt(a.alasan, 300);
      if (!alasan) return err("Isi alasan menahan.");
      const i = c.d.I.find((x) => x.id == a.id);
      if (!i) return err("Barang tidak ditemukan.");
      if (c.sel.deptOf(i) != c.actor.dept) return err("Barang ini bukan dari departemen Anda.");
      if (i.status != "Approved" || i.kon) return err("Barang sudah diproses ke ERO atau tidak lagi berstatus Approved.");
      i.tahan = "Y";
      i.alasan = alasan;
      return { ok: "Ditahan.", ids: [i.id] };
    },
    lepas(c, a) {
      const g = only(c, "Admin Dept");
      if (g) return g;
      const i = c.d.I.find((x) => x.id == a.id);
      if (!i) return err("Barang tidak ditemukan.");
      if (c.sel.deptOf(i) != c.actor.dept) return err("Barang ini bukan dari departemen Anda.");
      if (i.status != "Approved" || i.kon || !i.tahan) return err("Barang tidak sedang ditahan.");
      i.tahan = "";
      i.alasan = "";
      return { ok: "Tahan dilepas.", ids: [i.id] };
    },
    simpanSrl(c, a) {
      const { d, sel, actor } = c;
      const g = only(c, "Admin Dept");
      if (g) return g;
      const no = txt(a.no, 40);
      const est = txt(a.est, 10);
      if (!no) return err("Isi nomor SRL dari ERO.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/.test(no)) return err("Format nomor SRL tidak valid.");
      if (est && !ISO_DATE.test(est)) return err("Estimasi datang tidak valid.");
      if (d.L.find((l) => l.no == no)) return err("Nomor SRL ini sudah pernah disimpan.");
      const p = sel.poolOf(actor.dept);
      if (!p.length) return err("Tidak ada request yang siap diproses (mungkin sudah diproses admin lain). Muat ulang.");
      d.L.push({ no, dept: actor.dept, est });
      const grp = {};
      p.forEach((i) => (grp[i.kode] = grp[i.kode] || []).push(i));
      const ids = [no];
      Object.entries(grp).forEach(([k, arr]) => {
        const id = c.newId("K", "KON", 3);
        d.K.push({ id, dept: actor.dept, kode: k, tahap: "Sudah di ERO", srl: no, ero: fmt(sum(arr, (i) => i.qty)), tutup: "0", alasan: "", by: actor.n });
        arr.forEach((i) => {
          i.status = "Sudah di ERO";
          i.kon = id;
        });
        ids.push(id);
      });
      return { ok: `${p.length} request masuk ${no}. Status otomatis Sudah di ERO.`, ids };
    },
    tutup(c, a) {
      const g = only(c, "Admin Dept");
      if (g) return g;
      const alasan = txt(a.alasan, 300);
      if (!alasan) return err("Isi alasan menutup sisa.");
      const k = c.sel.KN(a.id);
      if (!k) return err("Konsolidasi tidak ditemukan.");
      if (k.dept != c.actor.dept) return err("Ini bukan SRL departemen Anda.");
      const s = c.sel.sisa(k);
      if (!(s > EPS)) return err("Tidak ada sisa untuk ditutup.");
      k.alasan = alasan;
      k.tutup = fmt(+k.tutup + s);
      return { ok: "Sisa ditutup.", ids: [k.id] };
    },
    datang(c, a) {
      const { d, sel, actor, now } = c;
      const g = only(c, "Admin Warehouse");
      if (g) return g;
      const k = sel.KN(a.id);
      if (!k) return err("Konsolidasi tidak ditemukan.");
      if (k.tahap != "Sudah di ERO") return err("SRL belum berstatus Sudah di ERO.");
      const q = a.q === "" || a.q == null ? 0 : num(a.q);
      const l = a.l === "" || a.l == null ? 0 : num(a.l);
      if (!Number.isFinite(q) || !Number.isFinite(l) || q < 0 || l < 0) return err("Qty tidak valid.");
      if (!(q > 0) && !(l > 0)) return err("Isi Qty datang.");
      if (q > sel.sisa(k) + EPS) return err("Qty datang melebihi sisa (" + fmt(sel.sisa(k)) + "). Mungkin sudah dicatat admin lain.");
      const cat = txt(a.cat, 300);
      if (l > 0 && !cat) return err("Isi catatan untuk kelebihan.");
      const dupe = recent(d.KD, now, 15).find((x) => x.kon == k.id && +x.qty == q && +x.lebih == l && x.by == actor.n);
      if (dupe) return err(`Kedatangan yang sama baru saja dicatat (${dupe.id}).`);
      const id = c.newId("KD", "KDG", 6);
      d.KD.push({ id, kon: k.id, qty: fmt(q), lebih: fmt(l), by: actor.n, cat, tgl: c.today });
      return { ok: "Kedatangan dicatat.", ids: [id] };
    },
    datangAll(c, a) {
      const { d, sel, actor } = c;
      const g = only(c, "Admin Warehouse");
      if (g) return g;
      const arr = d.K.filter((k) => k.srl == a.no && k.tahap == "Sudah di ERO" && sel.sisa(k) > EPS);
      if (!arr.length) return err("Tidak ada sisa untuk dicatat (mungkin sudah dicatat admin lain).");
      const ids = [];
      arr.forEach((k) => {
        const id = c.newId("KD", "KDG", 6);
        d.KD.push({ id, kon: k.id, qty: fmt(sel.sisa(k)), lebih: "0", by: actor.n, cat: "", tgl: c.today });
        ids.push(id);
      });
      return { ok: arr.length + " barang dicatat datang sesuai jumlah di " + a.no + ".", ids };
    },
    serah(c, a) {
      const { d, sel, now } = c;
      const g = only(c, "Admin Warehouse");
      if (g) return g;
      const i = d.I.find((x) => x.id == a.id);
      if (!i) return err("Barang tidak ditemukan.");
      if (i.status != "Sudah di ERO") return err("Barang belum berstatus Sudah di ERO.");
      const q = num(a.q);
      const mx = sel.siap(i);
      if (!Number.isFinite(q) || !(q > 0) || q > mx + EPS) return err("Qty harus antara 1 dan " + fmt(mx) + ". Mungkin sudah diserahkan admin lain.");
      const dupe = recent(d.SR, now, 15).find((x) => x.item == i.id && +x.qty == q);
      if (dupe) return err(`Serah terima yang sama baru saja dicatat (${dupe.id}).`);
      const id = c.newId("SR", "SRH", 6);
      d.SR.push({ id, item: i.id, qty: fmt(q), to: sel.nm(sel.RQ(i.req).by), tgl: c.today });
      return { ok: "Diserahkan.", ids: [id] };
    },
    ingat(c, a) {
      const { d, sel, actor, now } = c;
      const g = only(c, "Admin Warehouse");
      if (g) return g;
      const i = d.I.find((x) => x.id == a.id);
      if (!i) return err("Barang tidak ditemukan.");
      if (i.status != "Sudah di ERO" || !(sel.siap(i) > EPS)) return err("Barang ini tidak sedang menunggu diambil.");
      if (recent(d.RM, now, 15).find((x) => x.item == i.id && x.by == actor.n)) return { ok: "Pengingat sudah dicatat.", ids: [] };
      const id = c.newId("RM", "RMD", 6);
      d.RM.push({ id, item: i.id, by: actor.n, at: now });
      return { ok: "Pengingat dicatat.", ids: [id] };
    }
  };

  // shared/engine.js
  var clone = (o) => JSON.parse(JSON.stringify(o));
  var nCols = (t) => TABLES[t].cols.length;
  function nextId(d, t, prefix, pad2) {
    const key = TABLES[t].key;
    let m = 0;
    for (const r of d[t]) {
      const x = /(\d+)$/.exec(r[key]);
      if (x && String(r[key]).startsWith(prefix + "-")) m = Math.max(m, +x[1]);
    }
    return prefix + "-" + String(m + 1).padStart(pad2, "0");
  }
  function runAction(state, name, args, ctx) {
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
    if (!fn) return { err: "Aksi tidak dikenal." };
    if (!ctx.actor) return { err: "Pengguna tidak dikenali." };
    if (ctx.actor.off) return { err: "Akun Anda nonaktif. Hubungi admin departemen." };
    const d = clone(state);
    const c = { ...ctx, d, sel: makeSel(d), newId: (t, p, pad2 = 6) => nextId(d, t, p, pad2) };
    const res = fn(c, args || {}) || {};
    if (res.err) return { err: res.err };
    const changes = [];
    const touched = [];
    try {
      for (const t of Object.keys(TABLES)) {
        const key = TABLES[t].key;
        const prev = new Map(state[t].map((r) => [r[key], r]));
        const seen = /* @__PURE__ */ new Set();
        let touchedT = false;
        d[t] = d[t].map((r) => {
          const k = r[key];
          if (k == null || k === "") throw new Error(`Baris ${t} tanpa kunci`);
          if (seen.has(k)) throw Object.assign(new Error(`Kunci duplikat ${t}:${k}`), { business: true });
          seen.add(k);
          const b = prev.get(k);
          if (!b) {
            r._cr = ctx.now;
            r._ts = ctx.now;
            r._op = ctx.opId;
            r._by = ctx.actor.id;
            const n2 = fromRow(t, toRow(t, r));
            changes.push({ t, kind: "append", key: k, row: toRow(t, n2) });
            touchedT = true;
            return n2;
          }
          const a = toRow(t, b).slice(0, nCols(t));
          const z = toRow(t, r).slice(0, nCols(t));
          if (JSON.stringify(a) === JSON.stringify(z)) return b;
          r._cr = b._cr;
          r._ts = ctx.now;
          r._op = ctx.opId;
          r._by = ctx.actor.id;
          const n = fromRow(t, toRow(t, r));
          changes.push({ t, kind: "update", key: k, row: toRow(t, n), before: toRow(t, b) });
          touchedT = true;
          return n;
        });
        for (const k of prev.keys()) if (!seen.has(k)) throw new Error(`Penghapusan data tidak diizinkan (${t}:${k})`);
        if (touchedT) touched.push(t);
      }
    } catch (e) {
      if (e.business) return { err: "Data ganda terdeteksi dan ditolak (" + e.message + ")." };
      throw e;
    }
    if (!changes.length) return { ok: res.ok, ids: res.ids || [], changes, state, touched };
    return { ok: res.ok, ids: res.ids || [], changes, state: d, touched };
  }

  // shared/seed.js
  function buildSeed(today) {
    const U = T(
      `hendra.mgr|Hendra Wijaya|Produksi|Atasan|
budi.spv|Budi Hartono|Produksi|Atasan|hendra.mgr
andi.prod|Andi Saputra|Produksi|User|budi.spv
siti.prod|Siti Rahma|Produksi|User|budi.spv
rudi.prod|Rudi Firmansyah|Produksi|User|budi.spv
dewi.admin|Dewi Lestari|Produksi|Admin Dept|budi.spv
tono.spv|Tono Sugiarto|Maintenance|Atasan|
maya.mt|Maya Anggraeni|Maintenance|User|tono.spv
rina.mt|Rina Marlina|Maintenance|User|tono.spv
yani.admin|Yani Kusuma|Maintenance|Admin Dept|tono.spv
wati.wh|Wati Handayani|Warehouse|Admin Warehouse|
joko.wh|Joko Susilo|Warehouse|Admin Warehouse|
agus.spv|Agus Prasetyo|Warehouse|Spv Warehouse|`,
      ["id", "n", "dept", "role", "boss"]
    );
    const HP = {
      "hendra.mgr": "6281234560001",
      "budi.spv": "6281234560002",
      "andi.prod": "6281234560003",
      "siti.prod": "6281234560004",
      "rudi.prod": "6281234560005",
      "dewi.admin": "6281234560006",
      "tono.spv": "6281234560007",
      "maya.mt": "6281234560008",
      "rina.mt": "6281234560009",
      "yani.admin": "6281234560010",
      "wati.wh": "6281234560011",
      "joko.wh": "6281234560012",
      "agus.spv": "6281234560013"
    };
    U.forEach((u) => {
      u.wa = HP[u.id] || "";
      u.off = false;
    });
    const M = T(
      `SRG-001|Sarung Tangan Kain|Pasang|0|0|3
SRG-002|Masker KN95|Box|1|0|3
APD-007|Helm Safety|Pcs|1|0|7
OLI-010|Oli Hidrolik 20L|Jerigen|0|1|5
BRG-204|Bearing 6204|Pcs|1|1|7
KBL-005|Kabel Tie 30cm|Pack|0|0|2
LAS-021|Kawat Las RB26|Kg|0|0|3`,
      ["k", "n", "sat", "buf", "kons", "lead"]
    );
    const R = T(
      `RQ-001|andi.prod|2026-11-03|Disetujui|
RQ-002|siti.prod|2026-11-03|Disetujui|
RQ-003|rudi.prod|2026-11-03|Disetujui|
RQ-004|siti.prod|2026-11-12|Disetujui|
RQ-005|rudi.prod|2026-11-12|Disetujui|
RQ-006|maya.mt|2026-11-04|Disetujui|
RQ-007|rina.mt|2026-11-04|Disetujui|
RQ-008|siti.prod|2026-11-18|Menunggu Approval|
RQ-009|andi.prod|2026-11-18|Draft|
RQ-010|rudi.prod|2026-11-09|Ditolak|Stok helm masih cukup, tunda dulu
RQ-011|andi.prod|2026-11-10|Dibatalkan|`,
      ["id", "by", "tgl", "st", "cat"]
    );
    const I = T(
      `ITM-001|RQ-001|SRG-001|10|2026-11-16|2026-11-25|Sudah di ERO|2026-11-04|KON-001||
ITM-002|RQ-001|SRG-002|20|2026-11-16||Sudah di ERO|2026-11-04|KON-002||
ITM-003|RQ-002|SRG-001|10|2026-11-16|2026-11-20|Sudah di ERO|2026-11-04|KON-001||
ITM-004|RQ-003|SRG-001|10|2026-11-16|2026-12-02|Sudah di ERO|2026-11-04|KON-001||
ITM-005|RQ-004|BRG-204|4|2026-11-30||Approved|2026-11-12||Y|Menunggu konfirmasi spesifikasi bearing
ITM-006|RQ-005|LAS-021|5|2026-11-30|2026-12-05|Approved|2026-11-13|||
ITM-007|RQ-006|OLI-010|4|2026-11-17|2026-11-25|Sudah di ERO|2026-11-05|KON-003||
ITM-008|RQ-006|BRG-204|6|2026-11-25||Approved|2026-11-05|||
ITM-009|RQ-007|OLI-010|2|2026-11-17|2026-12-02|Sudah di ERO|2026-11-05|KON-003||
ITM-010|RQ-008|KBL-005|3|2026-12-03|2026-12-10|Menunggu Approval||||
ITM-011|RQ-009|OLI-010|2|2026-12-03|2026-12-10|Draft||||
ITM-012|RQ-010|APD-007|2|2026-11-23||Ditolak||||
ITM-013|RQ-011|LAS-021|1|2026-11-20|2026-12-01|Dibatalkan||||`,
      ["id", "req", "kode", "qty", "datang", "pakai", "status", "appr", "kon", "tahan", "alasan"]
    );
    const K = T(
      `KON-001|Produksi|SRG-001|Sudah di ERO|SRL-2611-001|30|0|
KON-002|Produksi|SRG-002|Sudah di ERO|SRL-2611-001|20|0|
KON-003|Maintenance|OLI-010|Sudah di ERO|SRL-2611-002|6|2|Supplier tidak bisa kirim sisa 2 jerigen`,
      ["id", "dept", "kode", "tahap", "srl", "ero", "tutup", "alasan"]
    );
    const L = T(
      `SRL-2611-001|Produksi|2026-11-16
SRL-2611-002|Maintenance|2026-11-17`,
      ["no", "dept", "est"]
    );
    const KD = T(
      `KON-001|15|0|Wati Handayani||2026-11-16
KON-002|20|5|Wati Handayani|Supplier kirim 25, kelebihan 5 dicatat terpisah|2026-11-16
KON-003|4|0|Joko Susilo||2026-11-17`,
      ["kon", "qty", "lebih", "by", "cat", "tgl"]
    );
    const SR = T(
      `ITM-003|10|Siti Rahma
ITM-002|20|Andi Saputra`,
      ["item", "qty", "to"]
    );
    const nmOf = (id) => {
      var _a;
      return ((_a = U.find((u) => u.id == id)) == null ? void 0 : _a.n) || id;
    };
    {
      const A = [
        ["GRD-101", "Mata Gerinda Potong 4 inci", "Pcs", 0],
        ["GRD-102", "Mata Gerinda Poles 4 inci", "Pcs", 0],
        ["BOR-201", "Mata Bor HSS 8mm", "Pcs", 0],
        ["BOR-202", "Mata Bor HSS 10mm", "Pcs", 0],
        ["BLT-301", "Baut Hex M10x50", "Box", 1],
        ["BLT-302", "Mur Hex M10", "Box", 1],
        ["BLT-303", "Ring Plat M10", "Box", 1],
        ["SLG-401", "Selang Hidrolik 1/2 inci", "Meter", 0],
        ["SLG-402", "Klem Selang 1 inci", "Pcs", 0],
        ["FTG-501", "Fitting Nipple 1/2 inci", "Pcs", 0],
        ["BRG-205", "Bearing 6205", "Pcs", 1],
        ["BRG-206", "Bearing 6206", "Pcs", 1],
        ["SEL-601", "Oil Seal 35x52x7", "Pcs", 1],
        ["VBT-401", "V-Belt B-52", "Pcs", 1],
        ["KBL-006", "Kabel NYAF 1.5mm", "Roll", 0],
        ["LMP-701", "Lampu LED Highbay 100W", "Pcs", 0],
        ["CTR-801", "Kontaktor 3P 25A", "Pcs", 0],
        ["SKR-901", "Sekring Cartridge 10A", "Box", 1],
        ["LKT-101", "Lakban Isolasi Hitam", "Roll", 0],
        ["PNT-201", "Cat Marking Kuning", "Kaleng", 0]
      ];
      const P = ["andi.prod", "siti.prod", "rudi.prod"];
      const no = "SRL-2611-003";
      for (let n = 0; n < 6; n++)
        R.push({ id: "RQ-0" + (12 + n), by: P[n % 3], tgl: n < 3 ? "2026-11-14" : "2026-11-15", st: "Disetujui", cat: "" });
      L.push({ no, dept: "Produksi", est: "2026-11-24" });
      A.forEach(([k, nama, sat, buf], i) => {
        M.push({ k, n: nama, sat, buf: String(buf), kons: "0", lead: String(3 + i % 4) });
        const kid = "KON-" + pad(5 + i, 3);
        const rs = i % 2 ? [i % 3] : [i % 3, (i + 1) % 3];
        const dt = addDays("2026-11-20", i % 6);
        let tot = 0;
        rs.forEach((r, j) => {
          const q = j ? i * 5 % 6 + 1 : i * 7 % 9 + 2;
          const id = "ITM-" + pad(I.length + 1, 3);
          tot += q;
          I.push({
            id,
            req: "RQ-0" + (12 + r + (i < 10 ? 0 : 3)),
            kode: k,
            qty: String(q),
            datang: dt,
            pakai: buf ? "" : addDays(dt, 3 + i % 5),
            status: "Sudah di ERO",
            appr: "2026-11-16T08:" + pad(10 + i),
            kon: kid,
            tahan: "",
            alasan: ""
          });
          if (i < 3 && !j) SR.push({ item: id, qty: String(q), to: nmOf(P[r]) });
        });
        K.push({ id: kid, dept: "Produksi", kode: k, tahap: "Sudah di ERO", srl: no, ero: String(tot), tutup: "0", alasan: "" });
        if (i < 6) KD.push({ kon: kid, qty: String(tot), lebih: "0", by: "Wati Handayani", cat: "", tgl: "2026-11-18" });
        else if (i < 12) KD.push({ kon: kid, qty: String(Math.floor(tot / 2) || 1), lebih: "0", by: "Joko Susilo", cat: "", tgl: "2026-11-21" });
      });
    }
    K.forEach((k) => k.by = nmOf(k.dept == "Produksi" ? "dewi.admin" : "yani.admin"));
    SR.forEach((s, n) => s.tgl = addDays("2026-11-18", n % 3));
    KD.forEach((r, n) => r.id = "KDG-" + pad(n + 1, 6));
    SR.forEach((r, n) => r.id = "SRH-" + pad(n + 1, 6));
    const db = { ...emptyState(), U, M, R, I, K, L, KD, SR, RM: [] };
    const sel = makeSel(db);
    let rn = 0;
    db.I.filter((i) => i.status == "Sudah di ERO" && sel.siap(i) > 0).forEach((i, n) => {
      for (let c = 0; c < n % 4; c++)
        db.RM.push({ id: "RMD-" + pad(++rn, 6), item: i.id, by: "Wati Handayani", at: addDays(today, -(n % 4 - c)) + "T09:00:00" });
    });
    return db;
  }
  return __toCommonJS(core_exports);
})();
