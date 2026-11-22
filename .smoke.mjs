// scripts/smoke.mjs
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";

// src/store.jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState as useState2 } from "react";
import { produce } from "immer";

// src/lib/utils.js
var T = (s, k) => s.trim().split("\n").map((l) => Object.fromEntries(l.split("|").map((v, i) => [k[i], v])));
var wa = (s) => {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return /^628\d{8,11}$/.test(d) ? d : "";
};
var disp = (d) => d ? "0" + d.slice(2) : "";
var pad = (n) => String(n).padStart(2, "0");
var todayStr = () => {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
var nowStr = () => {
  const d = /* @__PURE__ */ new Date();
  return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
var today = todayStr;
var D = (d) => d ? (/* @__PURE__ */ new Date(d.slice(0, 10) + "T00:00:00Z")).toLocaleDateString("id-ID", {
  day: "numeric",
  month: "short",
  timeZone: "UTC"
}) : "belum diisi";
var days = (d) => Math.max(0, Math.round((Date.parse(today()) - Date.parse(d.slice(0, 10))) / 864e5));
var dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
var addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
var sum = (a, f) => Math.round(a.reduce((s, x) => s + (+f(x) || 0), 0) * 1e6) / 1e6;
var isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(Date.parse(s));
var nextId = (rows, prefix, key = "id", width = 3) => prefix + String(rows.reduce((m, r) => Math.max(m, parseInt(String(r[key]).slice(prefix.length), 10) || 0), 0) + 1).padStart(width, "0");
var f1 = (x) => x == null ? "-" : String(Math.round(x * 10) / 10).replace(".", ",");
var avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

// src/lib/selectors.js
function makeSel(db2) {
  const { U, M, R, I, K, L, KD, SR, RM } = db2;
  const user = (id) => U.find((u) => u.id == id);
  const nm = (id) => user(id)?.n || id;
  const uid = (v) => (user(v) || U.find((u) => u.n == v))?.id || v;
  const mi = (k) => M.find((m) => m.k == k);
  const KN = (id) => K.find((k) => k.id == id);
  const RQ = (id) => R.find((r) => r.id == id);
  const SRLof = (no) => L.find((l) => l.no == no);
  const live = (i) => !["Ditolak", "Dibatalkan"].includes(i.status);
  const total = (k) => sum(I.filter((i) => i.kon == k.id && live(i)), (i) => i.qty);
  const datang = (k) => sum(KD.filter((d) => d.kon == k.id), (d) => d.qty);
  const sisa = (k) => Math.max(0, total(k) - datang(k) - +k.tutup);
  const ord = (a, b) => {
    const pa = a.pakai || "9", pb = b.pakai || "9";
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (a.appr !== b.appr) return a.appr < b.appr ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
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
  const deptOf = (it) => user(RQ(it.req)?.by)?.dept;
  const lastArrival = (kon) => KD.filter((d) => d.kon == kon).map((d) => d.tgl).sort().pop();
  const firstArrival = (kon) => KD.filter((d) => d.kon == kon).map((d) => d.tgl).sort()[0];
  const st = (it) => {
    const s = it.status;
    const sat = mi(it.kode)?.sat || "";
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
      const srl = SRLof(KN(it.kon)?.srl);
      return [
        3,
        "t-vio",
        "Sudah di ERO (" + (KN(it.kon)?.srl || "-") + "), menunggu barang datang" + (srl ? " (est. " + D(srl.est) + ")" : "")
      ];
    }
    return [-1, s == "Ditolak" ? "t-bad" : "t-gray", s];
  };
  const poolAll = (d) => I.filter((i) => i.status == "Approved" && !i.kon && RQ(i.req) && deptOf(i) == d);
  const poolOf = (d) => poolAll(d).filter((i) => !i.tahan);
  return {
    user,
    nm,
    uid,
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

// src/data/seed.js
function buildSeed() {
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
    `KON-001|15|0|wati.wh||2026-11-16
KON-002|20|5|wati.wh|Supplier kirim 25, kelebihan 5 dicatat terpisah|2026-11-16
KON-003|4|0|joko.wh||2026-11-17`,
    ["kon", "qty", "lebih", "by", "cat", "tgl"]
  );
  const SR = T(
    `ITM-003|10|siti.prod
ITM-002|20|andi.prod`,
    ["item", "qty", "to"]
  );
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
      const kid = "KON-" + String(5 + i).padStart(3, "0");
      const rs = i % 2 ? [i % 3] : [i % 3, (i + 1) % 3];
      const dt = addDays("2026-11-20", i % 6);
      let tot = 0;
      rs.forEach((r, j) => {
        const q = j ? i * 5 % 6 + 1 : i * 7 % 9 + 2;
        const id = "ITM-" + String(I.length + 1).padStart(3, "0");
        tot += q;
        I.push({
          id,
          req: "RQ-0" + (12 + r + (i < 10 ? 0 : 3)),
          kode: k,
          qty: String(q),
          datang: dt,
          pakai: buf ? "" : addDays(dt, 3 + i % 5),
          status: "Sudah di ERO",
          appr: "2026-11-16T08:" + String(10 + i).padStart(2, "0"),
          kon: kid,
          tahan: "",
          alasan: ""
        });
        if (i < 3 && !j) SR.push({ item: id, qty: String(q), to: P[r] });
      });
      K.push({ id: kid, dept: "Produksi", kode: k, tahap: "Sudah di ERO", srl: no, ero: String(tot), tutup: "0", alasan: "" });
      if (i < 6)
        KD.push({ kon: kid, qty: String(tot), lebih: "0", by: "wati.wh", cat: "", tgl: "2026-11-18" });
      else if (i < 12)
        KD.push({ kon: kid, qty: String(Math.floor(tot / 2) || 1), lebih: "0", by: "joko.wh", cat: "", tgl: "2026-11-21" });
    });
  }
  K.forEach((k) => k.by = k.dept == "Produksi" ? "dewi.admin" : "yani.admin");
  SR.forEach((s, n) => s.tgl = addDays("2026-11-18", n % 3));
  const db2 = { U, HP, M, R, I, K, L, KD, SR, RM: [] };
  const sel = makeSel(db2);
  db2.I.filter((i) => i.status == "Sudah di ERO" && sel.siap(i) > 0).forEach((i, n) => {
    for (let c = 0; c < n % 4; c++)
      db2.RM.push({ item: i.id, by: "wati.wh", at: addDays(today(), -(n % 4 - c)) + "T09:00" });
  });
  return db2;
}

// src/lib/actions.js
var EPS = 1e-9;
var ROLES = ["User", "Atasan", "Admin Dept", "Admin Warehouse", "Spv Warehouse"];
var dead = (s) => s == "Ditolak" || s == "Dibatalkan";
var num = (v) => v === "" || v == null ? NaN : +v;
var reqIn = (d, id, allowed) => {
  const r = d.R.find((x) => x.id == id);
  if (!r) return { err: "Request tidak ditemukan. Muat ulang halaman." };
  if (!allowed.includes(r.st)) return { err: `${id} sudah berstatus "${r.st}", aksi ini tidak bisa dilakukan.` };
  return { r };
};
var setR = (d, id, s) => {
  d.R.find((r) => r.id == id).st = s;
  d.I.filter((i) => i.req == id).forEach((i) => {
    if (!dead(i.status)) i.status = s;
  });
};
var bossErr = (sel, u) => {
  if (!u?.boss) return "Akun Anda belum punya atasan. Simpan sebagai draft dan hubungi admin departemen.";
  const b = sel.user(u.boss);
  if (!b) return "Atasan Anda tidak ditemukan di daftar pengguna. Hubungi admin departemen.";
  if (b.off) return `Atasan Anda (${b.n}) nonaktif. Hubungi admin departemen untuk menggantinya.`;
  return null;
};
var actor = (sel, id, role) => {
  const u = sel.user(id);
  if (!u || u.off) return { err: "Pengguna tidak dikenal atau nonaktif." };
  if (role && u.role != role) return { err: `Aksi ini hanya untuk ${role}.` };
  return { u };
};
var above = (d, id, boss) => {
  const seen = /* @__PURE__ */ new Set();
  for (let c = boss; c && !seen.has(c); c = d.U.find((u) => u.id == c)?.boss) {
    if (c == id) return true;
    seen.add(c);
  }
  return false;
};
var actions = {
  saveUser(sel, d, f) {
    const { mode, self, id, n, rawWa, email, role, boss, dept, active, me } = f;
    const a = actor(sel, me?.id);
    if (a.err) return a;
    const admin2 = a.u.role == "Admin Warehouse" || a.u.role == "Admin Dept";
    const w = wa(rawWa);
    if (!n) return { err: "Isi nama." };
    if (rawWa && !w) return { err: "Nomor WhatsApp tidak valid. Contoh: 081234567890." };
    const bossCheck = (uid, r, dp) => {
      if (r == "User" && !boss) return "Pilih atasan untuk user, supaya request bisa disetujui.";
      if (!boss) return null;
      const b = d.U.find((x) => x.id == boss);
      if (!b) return "Atasan tidak ditemukan.";
      if (b.role != "Atasan") return `${b.n} bukan berperan Atasan.`;
      if (b.off) return `${b.n} nonaktif, pilih atasan lain.`;
      if (uid && above(d, uid, boss)) return "Atasan tidak valid: membuat rantai atasan berputar.";
      if (a.u.role == "Admin Dept" && b.dept != dp) return "Atasan harus dari departemen yang sama.";
      return null;
    };
    if (mode == "new") {
      if (!admin2) return { err: "Hanya admin yang bisa menambah pengguna." };
      const e = (email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(e)) return { err: "Isi email yang valid." };
      if (d.U.find((u2) => u2.id.toLowerCase() == e)) return { err: "Email sudah terdaftar." };
      if (!w) return { err: "Nomor WhatsApp wajib diisi untuk pengguna baru." };
      if (!ROLES.includes(role)) return { err: "Role tidak valid." };
      if (a.u.role == "Admin Dept" && !["User", "Atasan", "Admin Dept"].includes(role))
        return { err: "Admin Dept hanya bisa menambah User, Atasan, atau Admin Dept." };
      const dp = a.u.role == "Admin Warehouse" ? (dept || "").trim() : a.u.dept;
      if (!dp) return { err: "Isi departemen." };
      const be = bossCheck(null, role, dp);
      if (be) return { err: be };
      d.U.push({ id: e, n, dept: dp, role, boss: boss || "" });
      d.HP[e] = w;
      return { ok: "Pengguna ditambahkan." };
    }
    const u = d.U.find((x) => x.id == id);
    if (!u) return { err: "Pengguna tidak ditemukan. Muat ulang halaman." };
    if (self) {
      if (u.id != a.u.id) return { err: "Profil hanya bisa diubah oleh pemiliknya." };
    } else {
      if (!admin2) return { err: "Hanya admin yang bisa mengubah pengguna." };
      if (a.u.role == "Admin Dept" && u.dept != a.u.dept) return { err: "Pengguna ini bukan dari departemen Anda." };
      if (!ROLES.includes(role)) return { err: "Role tidak valid." };
      if (a.u.role == "Admin Dept" && !["User", "Atasan", "Admin Dept"].includes(role))
        return { err: "Admin Dept hanya bisa memberi role User, Atasan, atau Admin Dept." };
      const dp = a.u.role == "Admin Warehouse" && dept ? dept : u.dept;
      const be = bossCheck(u.id, role, dp);
      if (be) return { err: be };
      const willOff = active !== void 0 ? !active : !!u.off;
      if (u.id == a.u.id && (willOff || role != u.role)) return { err: "Anda tidak bisa menonaktifkan atau mengubah role akun sendiri." };
      if (u.role == "Atasan" && (willOff || role != "Atasan")) {
        const subs = d.U.filter((x) => x.boss == u.id && !x.off);
        if (subs.length) return { err: `${u.n} masih jadi atasan ${subs.length} pengguna aktif. Pindahkan atasan mereka dulu.` };
      }
    }
    u.n = n;
    if (w) d.HP[u.id] = w;
    else delete d.HP[u.id];
    if (!self) {
      u.role = role;
      u.boss = boss || "";
      if (a.u.role == "Admin Warehouse" && dept) u.dept = dept;
      if (active !== void 0) u.off = !active;
    }
    return { ok: "Perubahan disimpan." };
  },
  saveRequest(sel, d, { status, lines, me }) {
    const { mi } = sel;
    if (status != "Draft" && status != "Menunggu Approval") return { err: "Status request tidak valid." };
    const a = actor(sel, me?.id);
    if (a.err) return { err: "Akun nonaktif tidak bisa membuat request." };
    if (status == "Menunggu Approval") {
      const e = bossErr(sel, a.u);
      if (e) return { err: e };
    }
    if (!lines?.length) return { err: "Tambahkan minimal satu barang." };
    const t = today();
    for (const x of lines) {
      const m = x.kode && mi(x.kode);
      if (!m) return { err: "Pilih barang di setiap baris." };
      const q = num(x.qty);
      if (!Number.isFinite(q) || !(q > 0)) return { err: `${m.n}: jumlah harus lebih dari 0.` };
      const min = addDays(t, +m.lead);
      if (!isDate(x.datang) || x.datang < min) return { err: `${m.n}: tgl datang paling cepat ${D(min)}.` };
      if (m.buf == "0" && !x.pakai) return { err: `${m.n}: tgl pakai wajib untuk barang non buffer.` };
      if (x.pakai && !isDate(x.pakai)) return { err: `${m.n}: tgl pakai tidak valid.` };
      if (x.pakai && x.pakai < x.datang) return { err: `${m.n}: tgl pakai tidak boleh sebelum tgl datang.` };
    }
    const id = nextId(d.R, "RQ-");
    d.R.push({ id, by: a.u.id, tgl: t, st: status, cat: "" });
    lines.forEach(
      (x) => d.I.push({
        id: nextId(d.I, "ITM-"),
        req: id,
        kode: x.kode,
        qty: String(+x.qty),
        datang: x.datang,
        pakai: x.pakai || "",
        status,
        appr: "",
        kon: "",
        tahan: "",
        alasan: ""
      })
    );
    return { ok: status == "Draft" ? "Draft disimpan." : "Diajukan ke atasan." };
  },
  ajukan(sel, d, id, by) {
    const g = reqIn(d, id, ["Draft"]);
    if (g.err) return g;
    if (g.r.by != by) return { err: "Hanya pembuat request yang bisa mengajukan." };
    const u = sel.user(g.r.by);
    if (u?.off) return { err: "Akun nonaktif tidak bisa mengajukan request." };
    const e = bossErr(sel, u);
    if (e) return { err: e };
    const t = today();
    for (const i of d.I.filter((x) => x.req == id && !dead(x.status))) {
      const m = sel.mi(i.kode);
      if (!m) return { err: `Barang ${i.kode} tidak ada di master. Hubungi admin.` };
      const min = addDays(t, +m.lead);
      if (i.datang < min)
        return { err: `${m.n}: tgl datang ${D(i.datang)} sudah lewat batas minimal (${D(min)}). Batalkan draft ini lalu buat request baru.` };
    }
    setR(d, id, "Menunggu Approval");
    return { ok: "Diajukan ke atasan." };
  },
  batal(sel, d, id, by) {
    const g = reqIn(d, id, ["Draft", "Menunggu Approval"]);
    if (g.err) return g;
    if (g.r.by != by) return { err: "Hanya pembuat request yang bisa membatalkan." };
    setR(d, id, "Dibatalkan");
    return { ok: "Request dibatalkan." };
  },
  setuju(sel, d, id, by) {
    const g = reqIn(d, id, ["Menunggu Approval"]);
    if (g.err) return g;
    const r = g.r;
    if (sel.user(r.by)?.boss != by) return { err: "Hanya atasan langsung pembuat request yang bisa menyetujui." };
    r.st = "Disetujui";
    d.I.filter((i) => i.req == id && i.status == "Menunggu Approval").forEach((i) => {
      i.status = "Approved";
      i.appr = nowStr();
    });
    const dp = sel.user(r.by)?.dept;
    const ad = d.U.find((u) => u.role == "Admin Dept" && u.dept == dp && !u.off);
    return {
      ok: ad ? `Disetujui. Diteruskan ke ${ad.n} (Admin ${dp}).` : `Disetujui, tapi belum ada Admin Dept aktif di ${dp}. Hubungi Admin Warehouse.`
    };
  },
  setujuAll(sel, d, meId) {
    const l = d.R.filter((r) => r.st == "Menunggu Approval" && sel.user(r.by)?.boss == meId);
    if (!l.length) return { err: "Tidak ada request yang menunggu." };
    l.forEach((r) => {
      r.st = "Disetujui";
      d.I.filter((i) => i.req == r.id && i.status == "Menunggu Approval").forEach((i) => {
        i.status = "Approved";
        i.appr = nowStr();
      });
    });
    return { ok: l.length + " request disetujui dan diteruskan ke admin departemen." };
  },
  tolak(sel, d, id, catatan, by) {
    const g = reqIn(d, id, ["Menunggu Approval"]);
    if (g.err) return g;
    if (sel.user(g.r.by)?.boss != by) return { err: "Hanya atasan langsung pembuat request yang bisa menolak." };
    if (!catatan) return { err: "Isi catatan sebelum menolak." };
    g.r.cat = catatan;
    setR(d, id, "Ditolak");
    return { ok: "Ditolak." };
  },
  tahan(sel, d, id, alasan, by) {
    const a = actor(sel, by, "Admin Dept");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (i.status != "Approved" || i.kon) return { err: "Hanya barang yang menunggu diproses ke ERO yang bisa ditahan." };
    if (sel.deptOf(i) != a.u.dept) return { err: "Barang ini bukan dari departemen Anda." };
    if (!alasan) return { err: "Isi alasan menahan." };
    i.tahan = "Y";
    i.alasan = alasan;
    return { ok: "Ditahan." };
  },
  lepas(sel, d, id, by) {
    const a = actor(sel, by, "Admin Dept");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (i.status != "Approved" || i.kon || !i.tahan) return { err: "Barang ini tidak sedang ditahan." };
    if (sel.deptOf(i) != a.u.dept) return { err: "Barang ini bukan dari departemen Anda." };
    i.tahan = "";
    i.alasan = "";
    return { ok: "Tahan dilepas." };
  },
  simpanSrl(sel, d, { no, est, me }) {
    const a = actor(sel, me?.id, "Admin Dept");
    if (a.err) return a;
    const dept = a.u.dept;
    const nomor = (no || "").trim();
    if (!nomor) return { err: "Isi nomor SRL dari ERO." };
    if (d.L.find((l) => String(l.no).toLowerCase() == nomor.toLowerCase())) return { err: "Nomor SRL ini sudah pernah disimpan." };
    if (est && (!isDate(est) || est < today())) return { err: "Estimasi datang tidak valid (tidak boleh sebelum hari ini)." };
    const p = sel.poolOf(dept);
    if (!p.length) return { err: "Tidak ada request yang siap diproses." };
    d.L.push({ no: nomor, dept, est: est || "" });
    const g = {};
    p.forEach((i) => (g[i.kode] = g[i.kode] || []).push(i));
    Object.entries(g).forEach(([k, arr]) => {
      const id = nextId(d.K, "KON-");
      d.K.push({ id, dept, by: a.u.id, kode: k, tahap: "Sudah di ERO", srl: nomor, ero: String(sum(arr, (i) => i.qty)), tutup: "0", alasan: "" });
      arr.forEach((i) => {
        i.status = "Sudah di ERO";
        i.kon = id;
      });
    });
    return { ok: `${p.length} request masuk ${nomor}. Status otomatis Sudah di ERO.` };
  },
  tutup(sel, d, id, alasan, by) {
    const a = actor(sel, by, "Admin Dept");
    if (a.err) return a;
    const k = d.K.find((x) => x.id == id);
    if (!k) return { err: "Konsolidasi tidak ditemukan. Muat ulang halaman." };
    if (k.dept != a.u.dept) return { err: "Konsolidasi ini bukan dari departemen Anda." };
    const s = sel.sisa(k);
    if (!(s > 0)) return { err: "Tidak ada sisa untuk ditutup." };
    if (!alasan) return { err: "Isi alasan menutup sisa." };
    k.alasan = alasan;
    k.tutup = String(sum([{ v: k.tutup }, { v: s }], (x) => x.v));
    return { ok: "Sisa ditutup." };
  },
  datang(sel, d, { id, q, l, cat, by }) {
    const a = actor(sel, by, "Admin Warehouse");
    if (a.err) return a;
    const k = d.K.find((x) => x.id == id);
    if (!k) return { err: "Konsolidasi tidak ditemukan. Muat ulang halaman." };
    const qq = num(q) || 0;
    const ll = num(l) || 0;
    if (!Number.isFinite(qq) || !Number.isFinite(ll) || qq < 0 || ll < 0) return { err: "Qty tidak boleh negatif." };
    if (!(qq > 0) && !(ll > 0)) return { err: "Isi Qty datang." };
    const s = sel.sisa(k);
    if (qq > s + EPS) return { err: "Qty datang melebihi sisa (" + s + ")." };
    if (ll > 0 && !cat) return { err: "Isi catatan untuk kelebihan." };
    d.KD.push({ kon: id, qty: String(qq), lebih: String(ll), by: a.u.id, cat: cat || "", tgl: today() });
    return { ok: "Kedatangan dicatat." };
  },
  datangAll(sel, d, no, by) {
    const a = actor(sel, by, "Admin Warehouse");
    if (a.err) return a;
    const list = d.K.filter((k) => k.srl == no && k.tahap == "Sudah di ERO" && sel.sisa(k) > 0);
    if (!list.length) return { err: "Tidak ada sisa untuk dicatat." };
    list.forEach((k) => d.KD.push({ kon: k.id, qty: String(sel.sisa(k)), lebih: "0", by: a.u.id, cat: "", tgl: today() }));
    return { ok: list.length + " barang dicatat datang sesuai jumlah di " + no + "." };
  },
  serah(sel, d, id, q, by) {
    const a = actor(sel, by, "Admin Warehouse");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (i.status != "Sudah di ERO") return { err: "Barang ini belum masuk ERO." };
    const mx = sel.siap(i);
    const qq = num(q);
    if (!Number.isFinite(qq) || !(qq > 0) || qq > mx + EPS) return { err: "Qty harus antara 1 dan " + mx + "." };
    d.SR.push({ item: id, qty: String(qq), to: sel.RQ(i.req).by, tgl: today() });
    return { ok: "Diserahkan." };
  },
  ingat(sel, d, id, by) {
    const a = actor(sel, by, "Admin Warehouse");
    if (a.err) return a;
    const i = d.I.find((x) => x.id == id);
    if (!i) return { err: "Barang tidak ditemukan. Muat ulang halaman." };
    if (!(sel.siap(i) > 0)) return { err: "Barang ini belum siap diambil, tidak perlu diingatkan." };
    d.RM.push({ item: id, by: a.u.id, at: nowStr() });
  }
};

// src/config.js
var LOGIN_TITLE = "SIPRAK";
var API_URL = "";
var POLL_MS = 15e3;

// src/lib/api.js
var apiOn = !!API_URL;
var SKEY = "siprak.session.v1";
var session = null;
try {
  session = JSON.parse(localStorage.getItem(SKEY));
} catch {
}
if (!session?.token || !session?.uid) session = null;
var getSession = () => session;
var saveSession = (s) => {
  session = s;
  try {
    localStorage.setItem(SKEY, JSON.stringify(s));
  } catch {
  }
};
var clearSession = () => {
  session = null;
  try {
    localStorage.removeItem(SKEY);
  } catch {
  }
};
var ApiError = class extends Error {
  constructor(msg, conflict = false, auth = false) {
    super(msg);
    this.conflict = conflict;
    this.auth = auth;
  }
};
async function parse(res) {
  let j;
  try {
    j = await res.json();
  } catch {
    throw new ApiError('Respons server tidak valid (cek izin Web App: "Anyone").');
  }
  if (!j.ok) throw new ApiError(j.err || "Server menolak permintaan.", !!j.conflict, !!j.auth);
  return j;
}
var get = (fn, extra = "") => fetch(
  `${API_URL}${API_URL.includes("?") ? "&" : "?"}fn=${fn}` + (session ? `&t=${encodeURIComponent(session.token)}` : "") + extra
).then(parse);
var post = (body) => fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ ...body, t: session?.token })
}).then(parse);
var api = {
  // Murah: hanya nomor versi
  ver: () => get("ver").then((j) => j.ver),
  // Kirim versi yang sudah dimiliki; bila sama, server menjawab { same: true } tanpa data
  all: (have) => get("all", have ? `&ver=${encodeURIComponent(have)}` : ""),
  mutate: (ops) => post({ fn: "mutate", ops }),
  // Password dikirim lewat POST (tidak masuk URL/riwayat) dan hanya diperiksa di server
  login: (u, p) => post({ fn: "login", u, p }),
  chpw: (o, n) => post({ fn: "chpw", o, n })
};

// src/views/LoginView.jsx
import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function LoginView({ onLogin, notice, demo }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    const m = await onLogin(u, p);
    if (m) {
      setErr(m);
      setP("");
      setBusy(false);
    }
  };
  const msg = err || notice;
  return /* @__PURE__ */ jsxs("div", { className: "lg", children: [
    /* @__PURE__ */ jsx("h1", { className: "lg-t", children: LOGIN_TITLE }),
    /* @__PURE__ */ jsxs("form", { className: "lg-card", onSubmit: submit, children: [
      msg ? /* @__PURE__ */ jsx("div", { className: "lg-err", role: "alert", children: msg }) : null,
      /* @__PURE__ */ jsx(
        "input",
        {
          className: "lg-in",
          name: "username",
          placeholder: "Username",
          value: u,
          onChange: (e) => setU(e.target.value),
          autoComplete: "username",
          autoCapitalize: "none",
          autoCorrect: "off",
          spellCheck: false,
          autoFocus: true,
          "aria-label": "Username"
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          className: "lg-in",
          name: "password",
          type: "password",
          placeholder: "Password",
          value: p,
          onChange: (e) => setP(e.target.value),
          autoComplete: "current-password",
          "aria-label": "Password"
        }
      ),
      /* @__PURE__ */ jsx("button", { className: "lg-btn", type: "submit", disabled: busy, children: busy ? "Masuk\u2026" : "Login" }),
      /* @__PURE__ */ jsx("img", { className: "lg-logo", src: "./logo-dbc.png", alt: "DBC, Inspired to Exceed" }),
      demo ? /* @__PURE__ */ jsx("p", { className: "lg-demo", children: "Mode demo: isi username pengguna (mis. andi.prod), password bebas." }) : null
    ] })
  ] });
}

// src/lib/diff.js
var KEYED = { U: "id", M: "k", R: "id", I: "id", K: "id", L: "no" };
var APPEND = ["KD", "SR", "RM"];
var userRows = (db2) => db2.U.map((u) => ({ ...u, hp: db2.HP[u.id] || "", off: u.off ? "Y" : "" }));
function diffDb(a, b) {
  if (a === b) return [];
  const ops = [];
  for (const t of Object.keys(KEYED)) {
    const key = KEYED[t];
    const ra = t === "U" ? userRows(a) : a[t];
    const rb = t === "U" ? userRows(b) : b[t];
    if (t !== "U" && ra === rb) continue;
    const old = new Map(ra.map((r) => [r[key], r]));
    for (const r of rb) {
      const o = old.get(r[key]);
      if (!o) ops.push({ t, op: "add", row: r });
      else if (o !== r && JSON.stringify(o) !== JSON.stringify(r)) ops.push({ t, op: "set", row: r });
    }
  }
  for (const t of APPEND) {
    for (let i = a[t].length; i < b[t].length; i++) ops.push({ t, op: "add", row: b[t][i] });
  }
  return ops;
}
var emptyDb = () => ({ U: [], HP: {}, M: [], R: [], I: [], K: [], L: [], KD: [], SR: [], RM: [] });

// src/store.jsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var Ctx = createContext(null);
var useApp = () => useContext(Ctx);
var emptyLine = () => ({ kode: "", qty: "", datang: "", pakai: "" });
var newLine = emptyLine;
var TABS = {
  User: [["req", "Request saya"], ["new", "Buat request"]],
  Atasan: [["appr", "Persetujuan"], ["tim", "Tim saya"]],
  "Admin Dept": [["pool", "Buat ERO"], ["kon", "SRL"], ["allr", "Semua request"], ["usr", "Pengguna"]],
  "Admin Warehouse": [["dtg", "Kedatangan"], ["srh", "Serah terima"], ["usr", "Pengguna"]],
  "Spv Warehouse": [["dash", "Dashboard"]]
};
var initialUi = {
  me: "andi.prod",
  tab: "req",
  draft: [emptyLine()],
  menu: false,
  eu: null,
  self: false,
  pw: false,
  help: false,
  dpic: null,
  di: null,
  uq: "",
  ud: "",
  q: "",
  sf: "",
  df: "",
  dp: "w0"
};
var CACHE_KEY = "siprak.cache.v1";
var readCache = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c?.db?.U ? c : null;
  } catch {
    return null;
  }
};
var writeCache = (db2, ver) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ db: db2, ver }));
  } catch {
  }
};
function AppProvider({ children, initialUi: init }) {
  const boot = useRef(null);
  if (!boot.current) {
    const c = apiOn && getSession() ? readCache() : null;
    boot.current = apiOn ? { db: c?.db || emptyDb(), ver: c?.ver || null, ready: !!c } : { db: buildSeed(), ver: null, ready: true };
  }
  const [db2, setDb] = useState2(boot.current.db);
  const dbRef = useRef(db2);
  const verRef = useRef(boot.current.ver);
  const [ready, setReady] = useState2(boot.current.ready);
  const [sync, setSync] = useState2({ pending: 0, err: "" });
  const [ui, setUiState] = useState2({ ...initialUi, ...init });
  const [auth, setAuth] = useState2(() => init?.me ? { uid: init.me } : apiOn ? getSession() : null);
  const [notice, setNotice] = useState2("");
  const [toastS, setToastS] = useState2({ text: "", bad: false, show: false });
  const timer = useRef();
  const setUi = useCallback((p) => setUiState((s) => ({ ...s, ...typeof p == "function" ? p(s) : p })), []);
  const toast = useCallback((text, bad = false) => {
    clearTimeout(timer.current);
    setToastS({ text, bad, show: true });
    timer.current = setTimeout(() => setToastS((t) => ({ ...t, show: false })), bad ? 4500 : 2600);
  }, []);
  const sel = useMemo(() => makeSel(db2), [db2]);
  const meId = apiOn ? sel.user(auth?.uid) ? auth.uid : void 0 : sel.user(ui.me) ? ui.me : db2.U[0]?.id;
  const me = sel.user(meId);
  const uiEff = useMemo(() => meId === ui.me ? ui : { ...ui, me: meId }, [ui, meId]);
  const logout = useCallback((msg = "") => {
    clearSession();
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
    }
    verRef.current = null;
    if (apiOn) {
      const e = emptyDb();
      dbRef.current = e;
      setDb(e);
      setReady(false);
    }
    setNotice(msg);
    setAuth(null);
    setUiState((s) => ({ ...s, tab: "x", menu: false, eu: null, self: false, pw: false, help: false, dpic: null, di: null }));
  }, []);
  const login = useCallback(
    async (user, pass2) => {
      const id = String(user || "").trim().toLowerCase();
      if (!id || !pass2) return "Isi username dan password.";
      if (apiOn) {
        try {
          const r = await api.login(id, pass2);
          saveSession({ token: r.token, uid: r.uid });
          verRef.current = null;
          setNotice("");
          setAuth({ uid: r.uid });
          setUiState((s) => ({ ...s, me: r.uid, tab: "x" }));
          return "";
        } catch (e) {
          return e.message;
        }
      }
      const u = dbRef.current.U.find((x) => x.id.toLowerCase() == id);
      if (!u || u.off) return "Username tidak ditemukan.";
      setNotice("");
      setAuth({ uid: u.id });
      setUiState((s) => ({ ...s, me: u.id, tab: "x" }));
      return "";
    },
    []
  );
  const authFail = useCallback((e) => {
    if (e?.auth) {
      logout(e.message);
      return true;
    }
    return false;
  }, [logout]);
  const pendingRef = useRef(0);
  const staleRef = useRef(false);
  const queue = useRef(Promise.resolve());
  const setPending = (n) => {
    pendingRef.current = n;
    setSync((s) => ({ ...s, pending: n }));
  };
  const apply = useCallback((next, ver) => {
    dbRef.current = next;
    verRef.current = ver;
    setDb(next);
    setReady(true);
  }, []);
  const reload = useCallback(async () => {
    try {
      const r = await api.all(verRef.current);
      if (!r.same && pendingRef.current === 0) apply(r.db, r.ver);
      else if (r.same) verRef.current = r.ver;
      setSync((s) => ({ ...s, err: "" }));
    } catch (e) {
      if (authFail(e)) return;
      setSync((s) => ({ ...s, err: e.message }));
      setReady(true);
    }
  }, [apply, authFail]);
  useEffect(() => {
    if (!apiOn || !auth) return;
    reload();
    const check = async () => {
      if (document.visibilityState !== "visible" || pendingRef.current) return;
      try {
        const v = await api.ver();
        if (v !== verRef.current) await reload();
        else setSync((s) => s.err ? { ...s, err: "" } : s);
      } catch (e) {
        if (authFail(e)) return;
        setSync((s) => ({ ...s, err: e.message }));
      }
    };
    const iv = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", check);
    };
  }, [reload, auth, authFail]);
  useEffect(() => {
    if (apiOn && ready && db2.U.length) writeCache(db2, verRef.current);
  }, [db2, ready]);
  const save = useCallback(
    (ops) => {
      setPending(pendingRef.current + 1);
      queue.current = queue.current.then(() => api.mutate(ops)).then((r) => {
        if (r.base !== verRef.current) staleRef.current = true;
        verRef.current = r.ver;
        setSync((s) => ({ ...s, err: "" }));
      }).catch((e) => {
        if (authFail(e)) return;
        staleRef.current = true;
        toast(e.conflict ? e.message + " Data dimuat ulang, silakan ulangi." : "Gagal menyimpan: " + e.message, true);
        setSync((s) => ({ ...s, err: e.conflict ? "" : e.message }));
      }).finally(() => {
        setPending(pendingRef.current - 1);
        if (pendingRef.current === 0 && staleRef.current) {
          staleRef.current = false;
          verRef.current = null;
          reload();
        }
      });
    },
    [reload, toast, authFail]
  );
  const act = useCallback(
    (name, ...args) => {
      let res;
      const prev = dbRef.current;
      const next = produce(prev, (d) => {
        res = actions[name](makeSel(d), d, ...args);
      });
      if (res?.err) {
        toast(res.err, true);
        return false;
      }
      dbRef.current = next;
      setDb(next);
      if (apiOn) {
        const ops = diffDb(prev, next);
        if (ops.length) save(ops);
      }
      if (res?.ok) toast(res.ok);
      return true;
    },
    [toast, save]
  );
  if (!auth) return /* @__PURE__ */ jsx2(LoginView, { onLogin: login, notice, demo: !apiOn });
  if (!ready) {
    return /* @__PURE__ */ jsx2("div", { style: { display: "grid", placeItems: "center", minHeight: "100vh", font: "14px system-ui", color: "#5F6368" }, children: "Memuat data\u2026" });
  }
  if (!me) {
    return /* @__PURE__ */ jsxs2("div", { style: { padding: 24, font: "14px/1.6 system-ui", color: "#202124", maxWidth: 480, margin: "0 auto" }, children: [
      /* @__PURE__ */ jsx2("b", { children: "Belum ada data pengguna." }),
      /* @__PURE__ */ jsx2("p", { children: sync.err ? "Gagal terhubung ke server: " + sync.err : "Spreadsheet masih kosong. Jalankan seedDemo() di Apps Script, atau isi sheet Users." }),
      /* @__PURE__ */ jsx2("button", { onClick: () => {
        setReady(false);
        verRef.current = null;
        reload();
      }, children: "Coba lagi" }),
      " ",
      /* @__PURE__ */ jsx2("button", { onClick: () => logout(), children: "Keluar" })
    ] });
  }
  const value = { db: db2, sel, ui: uiEff, setUi, me, act, toast, toastS, sync, logout };
  return /* @__PURE__ */ jsx2(Ctx.Provider, { value, children });
}

// src/App.jsx
import { useEffect as useEffect3 } from "react";

// src/components/Overlays.jsx
import { useState as useState4 } from "react";

// src/components/ui.jsx
import { useEffect as useEffect2, useRef as useRef2, useState as useState3 } from "react";
import { Fragment, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var Pill = ({ t, children }) => /* @__PURE__ */ jsx3("span", { className: `pill ${t}`, children });
var Hd = ({ t, s }) => /* @__PURE__ */ jsxs3("div", { className: "hd", children: [
  /* @__PURE__ */ jsx3("h2", { children: t }),
  s ? /* @__PURE__ */ jsx3("p", { className: "mut", children: s }) : null
] });
var Empty = ({ children }) => /* @__PURE__ */ jsx3("div", { className: "empty", children });
var Srl = ({ children, ...p }) => /* @__PURE__ */ jsx3("div", { className: "srl", ...p, children });
function Confirm({ onConfirm, className = "btn bad", children }) {
  const [armed, setArmed] = useState3(false);
  const t = useRef2();
  useEffect2(() => () => clearTimeout(t.current), []);
  const click = () => {
    if (!armed) {
      setArmed(true);
      t.current = setTimeout(() => setArmed(false), 4e3);
      return;
    }
    clearTimeout(t.current);
    setArmed(false);
    onConfirm();
  };
  return /* @__PURE__ */ jsx3("button", { className: className + (armed ? " cfm" : ""), onClick: click, children: armed ? "Yakin? Ketuk lagi" : children });
}
function ItemCard({ it }) {
  const { sel, db: db2 } = useApp();
  const m = sel.mi(it.kode);
  const [g, t, l] = sel.st(it);
  const ss = db2.SR.filter((s) => s.item == it.id);
  return /* @__PURE__ */ jsxs3("div", { className: "item", children: [
    /* @__PURE__ */ jsxs3("div", { className: "between", children: [
      /* @__PURE__ */ jsx3("b", { children: m.n }),
      /* @__PURE__ */ jsxs3("span", { children: [
        it.qty,
        " ",
        m.sat
      ] })
    ] }),
    /* @__PURE__ */ jsx3("div", { className: `steps ${t}`, "aria-hidden": "true", children: [0, 1, 2, 3, 4].map((n) => /* @__PURE__ */ jsx3("i", { className: n <= g ? "on" : "" }, n)) }),
    /* @__PURE__ */ jsx3("div", { className: `lbl ${t}`, children: l }),
    /* @__PURE__ */ jsxs3("small", { className: "mut", children: [
      "Datang ",
      D(it.datang),
      it.pakai ? ", dipakai " + D(it.pakai) : ""
    ] }),
    ss.map((s, n) => /* @__PURE__ */ jsx3("div", { children: /* @__PURE__ */ jsxs3("small", { className: "mut", children: [
      "Diambil ",
      s.qty,
      " oleh ",
      sel.nm(s.to)
    ] }) }, n))
  ] });
}
var TONE = { Draft: "t-gray", "Menunggu Approval": "t-warn", Disetujui: "t-ok", Ditolak: "t-bad", Dibatalkan: "t-gray" };
function ReqCard({ r, mode }) {
  const { db: db2, sel, me, act } = useApp();
  const [cat, setCat] = useState3("");
  const its = db2.I.filter((i) => i.req == r.id);
  return /* @__PURE__ */ jsxs3("div", { className: "row", children: [
    /* @__PURE__ */ jsxs3("div", { className: "between", children: [
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx3("b", { children: r.id }),
        " ",
        /* @__PURE__ */ jsxs3("small", { children: [
          D(r.tgl),
          mode != "own" ? ", " + sel.nm(r.by) : ""
        ] })
      ] }),
      /* @__PURE__ */ jsx3(Pill, { t: TONE[r.st], children: r.st })
    ] }),
    r.cat ? /* @__PURE__ */ jsxs3("small", { className: "mut", children: [
      "Catatan atasan: ",
      r.cat
    ] }) : null,
    its.map((i) => /* @__PURE__ */ jsx3(ItemCard, { it: i }, i.id)),
    mode == "own" && r.st == "Draft" && /* @__PURE__ */ jsxs3("div", { className: "acts", children: [
      /* @__PURE__ */ jsx3("button", { className: "btn", onClick: () => act("ajukan", r.id, me.id), children: "Ajukan" }),
      /* @__PURE__ */ jsx3(Confirm, { onConfirm: () => act("batal", r.id, me.id), children: "Batalkan" })
    ] }),
    mode == "own" && r.st == "Menunggu Approval" && /* @__PURE__ */ jsx3("div", { className: "acts", children: /* @__PURE__ */ jsx3(Confirm, { onConfirm: () => act("batal", r.id, me.id), children: "Batalkan" }) }),
    mode == "appr" && /* @__PURE__ */ jsxs3("div", { className: "acts", children: [
      /* @__PURE__ */ jsx3("div", { className: "f grow", style: { width: "100%" }, children: /* @__PURE__ */ jsx3("textarea", { rows: "2", value: cat, onChange: (e) => setCat(e.target.value), placeholder: "Catatan (wajib jika menolak)" }) }),
      /* @__PURE__ */ jsx3("button", { className: "btn grow", onClick: () => act("setuju", r.id, me.id), children: "Setujui" }),
      /* @__PURE__ */ jsx3(Confirm, { className: "btn bad grow", onConfirm: () => act("tolak", r.id, cat.trim(), me.id), children: "Tolak" })
    ] })
  ] });
}
function copyText(t, toast) {
  const ok = () => toast("Disalin ke clipboard.");
  const fb = () => {
    const a = document.createElement("textarea");
    a.value = t;
    a.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(a);
    a.select();
    try {
      document.execCommand("copy");
      ok();
    } catch {
      toast("Gagal menyalin. Salin manual.", true);
    }
    a.remove();
  };
  try {
    navigator.clipboard.writeText(t).then(ok, fb);
  } catch {
    fb();
  }
}
var PAGE = 8;
var SORTS = { est: "Estimasi terdekat", new: "SRL terbaru", big: "Barang terbanyak" };
function useSrlPick(g, sel) {
  const [f, setF] = useState3({ pick: "", q: "", dept: "", late: false, sort: "est", lim: PAGE });
  const set = (p) => setF((x) => ({ ...x, ..."pick" in p || "lim" in p ? {} : { lim: PAGE }, ...p }));
  const meta = {};
  Object.keys(g).forEach((no) => {
    const r = sel.SRLof(no);
    const names = g[no].map((x) => sel.mi(x.kode)?.n || "").join(" ");
    meta[no] = {
      no,
      dept: r?.dept || "",
      est: r?.est || "",
      n: g[no].length,
      late: !!(r?.est && r.est < today()),
      hay: (no + " " + (r?.dept || "") + " " + names).toLowerCase()
    };
  });
  const depts = [...new Set(Object.values(meta).map((m) => m.dept).filter(Boolean))].sort();
  const q = f.q.trim().toLowerCase();
  const cmp = {
    est: (a, b) => (a.est || "9") < (b.est || "9") ? -1 : (a.est || "9") > (b.est || "9") ? 1 : a.no < b.no ? -1 : 1,
    new: (a, b) => a.no < b.no ? 1 : -1,
    big: (a, b) => b.n - a.n || (a.no < b.no ? -1 : 1)
  }[f.sort];
  const list = Object.values(meta).filter((m) => (!q || m.hay.includes(q)) && (!f.dept || m.dept == f.dept) && (!f.late || m.late)).sort(cmp);
  const nos = list.map((m) => m.no);
  const cur = nos.includes(f.pick) ? f.pick : nos[0];
  const lateN = Object.values(meta).filter((m) => m.late).length;
  return { list, nos, cur, shown: cur ? [cur] : [], f, set, depts, lateN, total: Object.keys(g).length };
}
function SrlPicker({ list, cur, f, set, depts, lateN, total, unit = "barang" }) {
  if (!total) return null;
  const vis = list.slice(0, f.lim);
  const filt = total > 5;
  return /* @__PURE__ */ jsxs3("div", { className: "f srlpick", style: { gridColumn: "1/-1" }, children: [
    filt && /* @__PURE__ */ jsxs3(Fragment, { children: [
      /* @__PURE__ */ jsxs3("label", { children: [
        "Cari SRL",
        /* @__PURE__ */ jsx3("input", { type: "search", value: f.q, placeholder: "No. SRL, departemen, atau nama barang", onChange: (e) => set({ q: e.target.value }) })
      ] }),
      /* @__PURE__ */ jsxs3("div", { className: "grid", style: { marginTop: 0 }, children: [
        /* @__PURE__ */ jsxs3("label", { children: [
          "Departemen",
          /* @__PURE__ */ jsxs3("select", { value: f.dept, onChange: (e) => set({ dept: e.target.value }), children: [
            /* @__PURE__ */ jsx3("option", { value: "", children: "Semua" }),
            depts.map((d) => /* @__PURE__ */ jsx3("option", { value: d, children: d }, d))
          ] })
        ] }),
        /* @__PURE__ */ jsxs3("label", { children: [
          "Urutkan",
          /* @__PURE__ */ jsx3("select", { value: f.sort, onChange: (e) => set({ sort: e.target.value }), children: Object.entries(SORTS).map(([k, v]) => /* @__PURE__ */ jsx3("option", { value: k, children: v }, k)) })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "chips", style: { marginTop: 0, alignItems: "center" }, children: [
      filt && lateN > 0 && /* @__PURE__ */ jsxs3("button", { className: "btn " + (f.late ? "" : "alt"), style: { minHeight: 34, padding: "4px 12px" }, onClick: () => set({ late: !f.late }), children: [
        "Terlambat (",
        lateN,
        ")"
      ] }),
      /* @__PURE__ */ jsx3("small", { className: "mut", children: list.length == total ? total + " SRL" : list.length + " dari " + total + " SRL" })
    ] }),
    list.length ? /* @__PURE__ */ jsxs3("div", { role: "listbox", "aria-label": "Daftar SRL", children: [
      vis.map((m) => /* @__PURE__ */ jsxs3(
        "button",
        {
          role: "option",
          "aria-selected": m.no == cur,
          onClick: () => set({ pick: m.no }),
          style: {
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "center",
            textAlign: "left",
            font: "inherit",
            color: "var(--ink)",
            cursor: "pointer",
            padding: "10px 12px",
            marginBottom: 6,
            borderRadius: 8,
            border: "1px solid " + (m.no == cur ? "var(--brand)" : "var(--line)"),
            background: m.no == cur ? "var(--soft)" : "var(--paper)"
          },
          children: [
            /* @__PURE__ */ jsxs3("span", { children: [
              /* @__PURE__ */ jsx3("b", { children: m.no }),
              /* @__PURE__ */ jsx3("br", {}),
              /* @__PURE__ */ jsxs3("small", { className: "mut", children: [
                m.dept || "-",
                ", est. ",
                D(m.est)
              ] })
            ] }),
            /* @__PURE__ */ jsxs3("span", { style: { textAlign: "right" }, children: [
              m.late ? /* @__PURE__ */ jsx3(Pill, { t: "t-bad", children: "Terlambat" }) : null,
              /* @__PURE__ */ jsx3("br", {}),
              /* @__PURE__ */ jsxs3("small", { className: "mut", children: [
                m.n,
                " ",
                unit
              ] })
            ] })
          ]
        },
        m.no
      )),
      list.length > vis.length && /* @__PURE__ */ jsxs3("button", { className: "btn alt", style: { width: "100%" }, onClick: () => set({ lim: f.lim + PAGE }), children: [
        "Tampilkan ",
        Math.min(PAGE, list.length - vis.length),
        " lagi (",
        list.length - vis.length,
        " tersisa)"
      ] })
    ] }) : /* @__PURE__ */ jsx3("div", { className: "empty", children: "Tidak ada SRL yang cocok. Ubah kata kunci atau filter." })
  ] });
}
function useMore(list, step = 15) {
  const [n, setN] = useState3(step);
  useEffect2(() => setN(step), [list.length, step]);
  const left = list.length - n;
  const btn = left > 0 ? /* @__PURE__ */ jsx3("div", { style: { gridColumn: "1/-1", marginTop: 8 }, children: /* @__PURE__ */ jsxs3("button", { className: "btn alt", style: { width: "100%" }, onClick: () => setN(n + step), children: [
    "Tampilkan ",
    Math.min(step, left),
    " lagi (",
    left,
    " tersisa)"
  ] }) }) : null;
  return [list.slice(0, n), btn];
}

// src/components/Overlays.jsx
import { Fragment as Fragment2, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var age = (w) => w >= 7 ? "t-bad" : w >= 3 ? "t-warn" : "t-gray";
function Drawer({ cnt }) {
  const { db: db2, ui, setUi, me, logout } = useApp();
  const tabs = TABS[me.role];
  const close = () => setUi({ menu: false });
  return /* @__PURE__ */ jsxs4(Fragment2, { children: [
    /* @__PURE__ */ jsx4("div", { className: "scrim", onClick: close }),
    /* @__PURE__ */ jsxs4("aside", { className: "drawer", "aria-label": "Menu", children: [
      /* @__PURE__ */ jsxs4("div", { className: "dh", children: [
        /* @__PURE__ */ jsx4("b", { children: me.n }),
        /* @__PURE__ */ jsxs4("small", { children: [
          me.role,
          ", ",
          me.dept
        ] })
      ] }),
      tabs.map((t) => /* @__PURE__ */ jsxs4("button", { className: "mi", "aria-current": t[0] == ui.tab ? "true" : void 0, onClick: () => setUi({ tab: t[0], menu: false, eu: null }), children: [
        t[1],
        cnt[t[0]] ? " (" + cnt[t[0]] + ")" : ""
      ] }, t[0])),
      /* @__PURE__ */ jsx4("button", { className: "mi", onClick: () => setUi({ help: true, menu: false }), children: "Cara pakai" }),
      /* @__PURE__ */ jsx4("button", { className: "mi", onClick: () => setUi({ eu: me.id, self: true, menu: false }), children: "Profil saya" }),
      apiOn && /* @__PURE__ */ jsx4("button", { className: "mi", onClick: () => setUi({ pw: true, menu: false }), children: "Ganti password" }),
      /* @__PURE__ */ jsx4("button", { className: "mi", onClick: () => logout(), children: "Keluar" }),
      !apiOn && /* @__PURE__ */ jsx4("div", { className: "dm", children: /* @__PURE__ */ jsxs4("label", { children: [
        "Lihat sebagai (demo)",
        /* @__PURE__ */ jsx4("select", { value: ui.me, onChange: (e) => setUi({ me: e.target.value, tab: "x", menu: false, eu: null }), children: db2.U.map((u) => /* @__PURE__ */ jsxs4("option", { value: u.id, children: [
          u.n,
          " (",
          u.role,
          ")"
        ] }, u.id)) })
      ] }) })
    ] })
  ] });
}
function PwSheet() {
  const { setUi, toast, logout } = useApp();
  const [f, setF] = useState4({ o: "", n: "", n2: "" });
  const [busy, setBusy] = useState4(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const close = () => setUi({ pw: false });
  const save = async () => {
    if (!f.o) return toast("Isi password lama.", true);
    if (f.n.length < 6) return toast("Password baru minimal 6 karakter.", true);
    if (f.n !== f.n2) return toast("Konfirmasi password tidak sama.", true);
    setBusy(true);
    try {
      await api.chpw(f.o, f.n);
      toast("Password diganti.");
      close();
    } catch (e) {
      if (e.auth) logout(e.message);
      else {
        toast(e.message, true);
        setBusy(false);
      }
    }
  };
  return /* @__PURE__ */ jsxs4(Fragment2, { children: [
    /* @__PURE__ */ jsx4("div", { className: "scrim", onClick: close }),
    /* @__PURE__ */ jsxs4("section", { className: "sheet", role: "dialog", "aria-label": "Ganti password", children: [
      /* @__PURE__ */ jsx4("h2", { children: "Ganti password" }),
      /* @__PURE__ */ jsxs4("div", { className: "f", children: [
        /* @__PURE__ */ jsxs4("label", { children: [
          "Password lama",
          /* @__PURE__ */ jsx4("input", { type: "password", autoComplete: "current-password", value: f.o, onChange: (e) => set("o", e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs4("label", { children: [
          "Password baru (min. 6 karakter)",
          /* @__PURE__ */ jsx4("input", { type: "password", autoComplete: "new-password", value: f.n, onChange: (e) => set("n", e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs4("label", { children: [
          "Ulangi password baru",
          /* @__PURE__ */ jsx4("input", { type: "password", autoComplete: "new-password", value: f.n2, onChange: (e) => set("n2", e.target.value) })
        ] })
      ] }),
      /* @__PURE__ */ jsxs4("div", { className: "acts", children: [
        /* @__PURE__ */ jsx4("button", { className: "btn alt grow", onClick: close, children: "Batal" }),
        /* @__PURE__ */ jsx4("button", { className: "btn grow", disabled: busy, onClick: save, children: "Simpan" })
      ] })
    ] })
  ] });
}
function UserSheet() {
  const { db: db2, ui, setUi, me, act } = useApp();
  const nw = ui.eu == "new";
  const wh2 = me.role == "Admin Warehouse";
  const u = nw ? { n: "", id: "", role: "User", boss: "", dept: wh2 ? ui.ud : me.dept } : db2.U.find((x) => x.id == ui.eu);
  const deps = [...new Set(db2.U.map((x) => x.dept))];
  const roles = wh2 ? ["User", "Atasan", "Admin Dept", "Admin Warehouse", "Spv Warehouse"] : ["User", "Atasan", "Admin Dept"];
  const bos = db2.U.filter((x) => x.role == "Atasan" && x.id != u.id && (wh2 || x.dept == u.dept));
  const ttl = ui.self ? "Profil saya" : nw ? "Tambah pengguna" : "Ubah pengguna";
  const [f, setF] = useState4({ n: u.n, e: u.id, w: disp(db2.HP[u.id]), r: u.role, b: u.boss || "", d: u.dept, a: !u.off });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const close = () => setUi({ eu: null, self: false });
  const save = () => {
    const ok = act("saveUser", {
      mode: nw ? "new" : "edit",
      self: ui.self,
      id: u.id,
      n: f.n.trim(),
      rawWa: f.w.trim(),
      email: f.e.trim(),
      role: f.r,
      boss: f.b,
      dept: wh2 ? f.d.trim() : void 0,
      active: nw || ui.self || u.id == ui.me ? void 0 : f.a,
      me
    });
    if (ok) close();
  };
  return /* @__PURE__ */ jsxs4(Fragment2, { children: [
    /* @__PURE__ */ jsx4("div", { className: "scrim", onClick: close }),
    /* @__PURE__ */ jsxs4("section", { className: "sheet", role: "dialog", "aria-label": ttl, children: [
      /* @__PURE__ */ jsx4("h2", { children: ttl }),
      /* @__PURE__ */ jsxs4("div", { className: "f", children: [
        /* @__PURE__ */ jsxs4("label", { children: [
          "Nama",
          /* @__PURE__ */ jsx4("input", { value: f.n, onChange: (e) => set("n", e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs4("label", { children: [
          "Email (login)",
          /* @__PURE__ */ jsx4("input", { type: "email", value: f.e, disabled: !nw, onChange: (e) => set("e", e.target.value) })
        ] }),
        /* @__PURE__ */ jsxs4("label", { children: [
          "No. WhatsApp untuk pengingat",
          /* @__PURE__ */ jsx4("input", { inputMode: "tel", value: f.w, onChange: (e) => set("w", e.target.value), placeholder: "08xxxxxxxxxx" })
        ] }),
        !ui.self && /* @__PURE__ */ jsxs4(Fragment2, { children: [
          /* @__PURE__ */ jsxs4("div", { className: "grid", children: [
            /* @__PURE__ */ jsxs4("label", { children: [
              "Role",
              /* @__PURE__ */ jsx4("select", { value: f.r, onChange: (e) => set("r", e.target.value), children: roles.map((r) => /* @__PURE__ */ jsx4("option", { children: r }, r)) })
            ] }),
            /* @__PURE__ */ jsxs4("label", { children: [
              "Atasan (wajib untuk User)",
              /* @__PURE__ */ jsxs4("select", { value: f.b, onChange: (e) => set("b", e.target.value), children: [
                /* @__PURE__ */ jsx4("option", { value: "", children: "Tidak ada" }),
                bos.map((b) => /* @__PURE__ */ jsx4("option", { value: b.id, children: b.n }, b.id))
              ] })
            ] })
          ] }),
          wh2 && /* @__PURE__ */ jsxs4("label", { children: [
            "Departemen",
            /* @__PURE__ */ jsx4("input", { list: "dl", value: f.d, onChange: (e) => set("d", e.target.value), placeholder: "Pilih atau ketik departemen baru" }),
            /* @__PURE__ */ jsx4("datalist", { id: "dl", children: deps.map((x) => /* @__PURE__ */ jsx4("option", { value: x }, x)) })
          ] }),
          !nw && /* @__PURE__ */ jsxs4("label", { className: "chk", children: [
            /* @__PURE__ */ jsx4("input", { type: "checkbox", checked: f.a, disabled: u.id == ui.me, onChange: (e) => set("a", e.target.checked) }),
            "Pengguna aktif"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs4("div", { className: "acts", children: [
        /* @__PURE__ */ jsx4("button", { className: "btn alt grow", onClick: close, children: "Batal" }),
        /* @__PURE__ */ jsx4("button", { className: "btn grow", onClick: save, children: "Simpan" })
      ] })
    ] })
  ] });
}
function PicSheet() {
  const { db: db2, sel, ui, setUi } = useApp();
  const u = sel.user(ui.dpic);
  if (!u) return null;
  const a = db2.I.filter((i) => i.status == "Sudah di ERO" && sel.siap(i) > 0 && sel.RQ(i.req).by == u.id).map((i) => ({ i, m: sel.mi(i.kode), b: sel.siap(i), w: days(sel.lastArrival(i.kon) || today()), rm: sel.reminders(i.id) })).sort((x, y) => y.w - x.w);
  const mx = a.length ? Math.max(...a.map((x) => x.w)) : 0;
  const close = () => setUi({ dpic: null });
  return /* @__PURE__ */ jsxs4(Fragment2, { children: [
    /* @__PURE__ */ jsx4("div", { className: "scrim", onClick: close }),
    /* @__PURE__ */ jsxs4("section", { className: "sheet", role: "dialog", "aria-label": "Barang " + u.n, children: [
      /* @__PURE__ */ jsx4("h2", { children: u.n }),
      /* @__PURE__ */ jsxs4("small", { className: "mut", children: [
        u.dept,
        u.boss ? ", atasan " + sel.nm(u.boss) : "",
        db2.HP[u.id] ? ", WA " + disp(db2.HP[u.id]) : ""
      ] }),
      /* @__PURE__ */ jsxs4("div", { className: "between", style: { marginTop: 10 }, children: [
        /* @__PURE__ */ jsxs4(Pill, { t: "t-info", children: [
          a.length,
          " barang belum diambil"
        ] }),
        a.length ? /* @__PURE__ */ jsxs4(Pill, { t: age(mx), children: [
          "Terlama ",
          mx,
          " hari"
        ] }) : null
      ] }),
      /* @__PURE__ */ jsx4("h3", { children: "Barang menunggu (ketuk untuk detail)" }),
      a.length ? a.map((x) => /* @__PURE__ */ jsxs4("button", { className: "urow", onClick: () => setUi({ di: x.i.id }), children: [
        /* @__PURE__ */ jsxs4("span", { children: [
          /* @__PURE__ */ jsx4("b", { children: x.m.n }),
          /* @__PURE__ */ jsx4("br", {}),
          /* @__PURE__ */ jsxs4("small", { className: "mut", children: [
            x.b,
            " ",
            x.m.sat,
            ", ",
            x.i.req,
            ", ",
            x.rm.length ? "diingatkan " + x.rm.length + " kali" : "belum diingatkan"
          ] })
        ] }),
        /* @__PURE__ */ jsx4("span", { children: /* @__PURE__ */ jsxs4(Pill, { t: age(x.w), children: [
          x.w,
          " hari"
        ] }) })
      ] }, x.i.id)) : /* @__PURE__ */ jsx4("small", { className: "mut", children: "Semua barang sudah diambil." }),
      /* @__PURE__ */ jsx4("div", { className: "acts", children: /* @__PURE__ */ jsx4("button", { className: "btn grow", onClick: close, children: "Tutup" }) })
    ] })
  ] });
}
var Dl = ({ a }) => /* @__PURE__ */ jsx4("dl", { className: "dl", children: a.map((x, n) => [/* @__PURE__ */ jsx4("dt", { children: x[0] }, "t" + n), /* @__PURE__ */ jsx4("dd", { children: x[1] }, "d" + n)]) });
var Tl = ({ a, e }) => a.length ? /* @__PURE__ */ jsx4("ul", { className: "tl", children: a.map((x, n) => /* @__PURE__ */ jsxs4("li", { children: [
  /* @__PURE__ */ jsx4("span", { children: x[0] }),
  /* @__PURE__ */ jsx4("span", { children: x[1] })
] }, n)) }) : /* @__PURE__ */ jsx4("small", { className: "mut", children: e });
function DetailSheet() {
  const { db: db2, sel, ui, setUi } = useApp();
  const i = db2.I.find((x) => x.id == ui.di);
  if (!i) return null;
  const m = sel.mi(i.kode), r = sel.RQ(i.req), u = sel.user(r.by), k = sel.KN(i.kon);
  const kd = db2.KD.filter((d) => d.kon == i.kon).sort((a, b2) => a.tgl < b2.tgl ? -1 : 1);
  const rm = sel.reminders(i.id);
  const sr = db2.SR.filter((s2) => s2.item == i.id);
  const b = sel.siap(i);
  const first = kd[0]?.tgl;
  const last = kd.length ? kd[kd.length - 1].tgl : "";
  const w = days(last || today());
  const ap = (i.appr || "").slice(0, 10);
  const s = k ? sel.SRLof(k.srl) : null;
  const close = () => setUi({ di: null });
  return /* @__PURE__ */ jsxs4(Fragment2, { children: [
    /* @__PURE__ */ jsx4("div", { className: "scrim", onClick: close }),
    /* @__PURE__ */ jsxs4("section", { className: "sheet", role: "dialog", "aria-label": "Detail " + m.n, children: [
      /* @__PURE__ */ jsx4("h2", { children: m.n }),
      /* @__PURE__ */ jsxs4("small", { className: "mut", children: [
        m.k,
        ", ",
        i.id,
        ", ",
        r.id
      ] }),
      /* @__PURE__ */ jsxs4("div", { className: "between", style: { marginTop: 10 }, children: [
        /* @__PURE__ */ jsxs4(Pill, { t: age(w), children: [
          "Di gudang ",
          w,
          " hari"
        ] }),
        /* @__PURE__ */ jsx4(Pill, { t: rm.length ? "t-info" : w >= 3 ? "t-bad" : "t-gray", children: rm.length ? "Diingatkan " + rm.length + " kali" : "Belum diingatkan" })
      ] }),
      /* @__PURE__ */ jsx4("h3", { children: "Jumlah" }),
      /* @__PURE__ */ jsx4(Dl, { a: [["Dipesan", i.qty + " " + m.sat], ["Jatah yang sudah datang", sel.berhak(i) + " " + m.sat], ["Sudah diambil", sel.diambil(i) + " " + m.sat], [/* @__PURE__ */ jsx4("b", { children: "Siap diambil" }), /* @__PURE__ */ jsxs4("b", { children: [
        b,
        " ",
        m.sat
      ] })]] }),
      /* @__PURE__ */ jsx4("h3", { children: "Peminta" }),
      /* @__PURE__ */ jsx4(Dl, { a: [["Nama", u.n], ["Departemen", u.dept], ["Atasan", u.boss ? sel.nm(u.boss) : "-"], ["Request", r.id + ", dibuat " + D(r.tgl)]] }),
      /* @__PURE__ */ jsx4("h3", { children: "Tanggal dan lead time" }),
      /* @__PURE__ */ jsx4(Dl, { a: [
        ["Disetujui", ap ? D(ap) : "-"],
        ["Diminta datang", D(i.datang)],
        ["Dipakai", i.pakai ? D(i.pakai) : "-"],
        ["Datang pertama", first ? D(first) : "-"],
        ["Datang terakhir", last ? D(last) : "-"],
        ["Lead time kedatangan", ap && first ? dayDiff(ap, first) + " hari" : "-"],
        ["SRL", k ? k.srl + (s ? ", estimasi " + D(s.est) : "") : "-"]
      ] }),
      /* @__PURE__ */ jsx4("h3", { children: "Riwayat kedatangan SRL" }),
      /* @__PURE__ */ jsx4(Tl, { a: kd.map((d) => [D(d.tgl), d.qty + " " + m.sat + (+d.lebih > 0 ? ", lebih " + d.lebih : "") + ", oleh " + sel.nm(d.by)]), e: "Belum ada barang datang." }),
      /* @__PURE__ */ jsx4("h3", { children: "Riwayat pengingat" }),
      /* @__PURE__ */ jsx4(Tl, { a: rm.map((x) => [D(x.at) + " " + x.at.slice(11, 16), sel.nm(x.by)]), e: "Belum pernah diingatkan. Pengingat dikirim oleh Admin Warehouse." }),
      /* @__PURE__ */ jsx4("h3", { children: "Riwayat pengambilan" }),
      /* @__PURE__ */ jsx4(Tl, { a: sr.map((x) => [x.tgl ? D(x.tgl) : "-", x.qty + " " + m.sat + " oleh " + sel.nm(x.to)]), e: "Belum ada yang diambil." }),
      /* @__PURE__ */ jsx4("div", { className: "acts", children: /* @__PURE__ */ jsx4("button", { className: "btn grow", onClick: close, children: "Tutup" }) })
    ] })
  ] });
}
var HELP = {
  "Spv Warehouse": ["<b>Dashboard</b>: pantau barang yang sudah sampai tapi belum diambil, urut dari yang paling lama.", "Lihat sudah berapa kali diingatkan. Pengingat dikirim oleh Admin Warehouse, bukan Anda.", "Pilih periode (minggu ini, minggu lalu, 4 minggu) untuk OPR, lalu <b>Cetak atau simpan PDF</b>."],
  User: ["Buka <b>Buat request</b>, pilih barang, isi jumlah dan tanggal.", "Tekan <b>Ajukan ke atasan</b>, atau <b>Simpan draft</b> kalau belum siap.", "Pantau status tiap barang di <b>Request saya</b>.", "Saat statusnya <b>Siap diambil</b>, ambil barang di Warehouse."],
  Atasan: ["Buka <b>Persetujuan</b> untuk melihat request tim Anda.", "Tekan <b>Setujui</b>, atau <b>Tolak</b> dengan catatan.", "Banyak request sekaligus? Tekan <b>Setujui semua</b>.", "Pantau semua request tim di <b>Tim saya</b>."],
  "Admin Dept": ["<b>Buat ERO</b>: salin daftar barang ke ERO, lalu simpan nomor SRL di sini.", "<b>SRL</b>: pantau barang yang sudah datang. Tutup sisa jika supplier tidak mengirim.", "<b>Semua request</b>: cari request departemen Anda.", "<b>Pengguna</b>: kelola akun dan nomor WhatsApp."],
  "Admin Warehouse": ["<b>Kedatangan</b>: catat barang yang tiba per nomor SRL. Lengkap semua? Tekan <b>Semua datang sesuai jumlah</b>.", "<b>Serah terima</b>: serahkan barang sesuai urutan, lalu kirim pengingat WA.", "<b>Pengguna</b>: kelola akun dan nomor WhatsApp."]
};
function HelpSheet() {
  const { me, setUi } = useApp();
  const close = () => setUi({ help: false });
  return /* @__PURE__ */ jsxs4(Fragment2, { children: [
    /* @__PURE__ */ jsx4("div", { className: "scrim", onClick: close }),
    /* @__PURE__ */ jsxs4("section", { className: "sheet", role: "dialog", "aria-label": "Cara pakai", children: [
      /* @__PURE__ */ jsx4("h2", { children: "Cara pakai" }),
      /* @__PURE__ */ jsx4("ol", { style: { paddingLeft: 20, margin: "0 0 14px", display: "grid", gap: 8 }, children: HELP[me.role].map((s, n) => /* @__PURE__ */ jsx4("li", { dangerouslySetInnerHTML: { __html: s } }, n)) }),
      /* @__PURE__ */ jsx4("div", { className: "acts", children: /* @__PURE__ */ jsx4("button", { className: "btn grow", onClick: close, children: "Mengerti" }) })
    ] })
  ] });
}

// src/views/UserViews.jsx
import { Fragment as Fragment3, jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function VReq() {
  const { db: db2, ui } = useApp();
  const l = db2.R.filter((r) => r.by == ui.me).sort((a, b) => b.tgl < a.tgl ? -1 : 1);
  return /* @__PURE__ */ jsxs5(Fragment3, { children: [
    /* @__PURE__ */ jsx5(Hd, { t: "Request saya", s: "Pantau tiap barang dari pengajuan sampai diambil." }),
    l.length ? l.map((r) => /* @__PURE__ */ jsx5(ReqCard, { r, mode: "own" }, r.id)) : /* @__PURE__ */ jsx5(Empty, { children: "Belum ada request. Buka tab Buat request untuk mulai." })
  ] });
}
function VNew() {
  const { db: db2, sel, ui, setUi, me, act } = useApp();
  const f = ui.draft;
  if (me.off) return /* @__PURE__ */ jsx5(Empty, { children: "Akun Anda nonaktif. Hubungi admin departemen untuk mengaktifkan kembali." });
  const set = (i, k, v) => setUi((s) => {
    const draft = s.draft.map((x, n) => n == i ? { ...x, [k]: v } : x);
    if (k == "kode") {
      const m = sel.mi(v);
      if (m && !draft[i].datang) draft[i].datang = addDays(today(), +m.lead);
    }
    return { draft };
  });
  const save = (status) => {
    if (act("saveRequest", { status, lines: f, me })) setUi({ draft: [newLine()], tab: "req" });
  };
  return /* @__PURE__ */ jsxs5(Fragment3, { children: [
    /* @__PURE__ */ jsx5(Hd, { t: "Buat request", s: "Satu request bisa berisi beberapa barang." }),
    f.map((x, i) => {
      const m = x.kode && sel.mi(x.kode);
      const min = m ? addDays(today(), +m.lead) : today();
      return /* @__PURE__ */ jsxs5("div", { className: "row", children: [
        /* @__PURE__ */ jsxs5("div", { className: "f", children: [
          /* @__PURE__ */ jsxs5("label", { children: [
            "Barang",
            /* @__PURE__ */ jsxs5("select", { value: x.kode, onChange: (e) => set(i, "kode", e.target.value), children: [
              /* @__PURE__ */ jsx5("option", { value: "", children: "Pilih barang" }),
              db2.M.map((o) => /* @__PURE__ */ jsxs5("option", { value: o.k, children: [
                o.n,
                " (",
                o.k,
                ")"
              ] }, o.k))
            ] })
          ] }),
          m && /* @__PURE__ */ jsxs5("div", { className: "chips", children: [
            /* @__PURE__ */ jsx5(Pill, { t: "t-info", children: m.buf == "1" ? "Buffer" : "Non buffer" }),
            /* @__PURE__ */ jsx5(Pill, { t: "t-vio", children: m.kons == "1" ? "Konsinyasi" : "Non konsinyasi" }),
            /* @__PURE__ */ jsxs5(Pill, { t: "t-gray", children: [
              "Paling cepat datang ",
              m.lead,
              " hari"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs5("div", { className: "grid", children: [
          /* @__PURE__ */ jsxs5("label", { children: [
            "Jumlah",
            m ? " (" + m.sat + ")" : "",
            /* @__PURE__ */ jsx5("input", { type: "number", min: "0", step: "any", inputMode: "decimal", value: x.qty, onChange: (e) => set(i, "qty", e.target.value) })
          ] }),
          /* @__PURE__ */ jsxs5("label", { children: [
            "Tanggal datang",
            m ? " (paling cepat " + D(min) + ")" : "",
            /* @__PURE__ */ jsx5("input", { type: "date", min, value: x.datang, onChange: (e) => set(i, "datang", e.target.value) })
          ] }),
          /* @__PURE__ */ jsxs5("label", { children: [
            "Tanggal pakai ",
            m && m.buf == "0" ? "(wajib)" : "(opsional)",
            /* @__PURE__ */ jsx5("input", { type: "date", value: x.pakai, onChange: (e) => set(i, "pakai", e.target.value) })
          ] })
        ] }),
        f.length > 1 && /* @__PURE__ */ jsx5("div", { className: "acts", children: /* @__PURE__ */ jsx5("button", { className: "btn bad", onClick: () => setUi((s) => ({ draft: s.draft.filter((_, n) => n != i) })), children: "Hapus barang ini" }) })
      ] }, i);
    }),
    /* @__PURE__ */ jsx5("div", { className: "acts", children: /* @__PURE__ */ jsx5("button", { className: "btn alt grow", onClick: () => setUi((s) => ({ draft: [...s.draft, newLine()] })), children: "Tambah barang" }) }),
    /* @__PURE__ */ jsxs5("div", { className: "acts", children: [
      /* @__PURE__ */ jsx5("button", { className: "btn alt grow", onClick: () => save("Draft"), children: "Simpan draft" }),
      /* @__PURE__ */ jsx5("button", { className: "btn grow", onClick: () => save("Menunggu Approval"), children: "Ajukan ke atasan" })
    ] })
  ] });
}

// src/views/AtasanViews.jsx
import { Fragment as Fragment4, jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
function VAppr() {
  const { db: db2, sel, me, act } = useApp();
  const l = db2.R.filter((r) => r.st == "Menunggu Approval" && me.id == sel.user(r.by)?.boss);
  return /* @__PURE__ */ jsxs6(Fragment4, { children: [
    /* @__PURE__ */ jsx6(Hd, { t: "Perlu disetujui", s: l.length + " request menunggu keputusan Anda." }),
    l.length > 1 && /* @__PURE__ */ jsx6("div", { className: "acts", style: { gridColumn: "1/-1" }, children: /* @__PURE__ */ jsxs6(Confirm, { className: "btn grow", onConfirm: () => act("setujuAll", me.id), children: [
      "Setujui semua (",
      l.length,
      ")"
    ] }) }),
    l.length ? l.map((r) => /* @__PURE__ */ jsx6(ReqCard, { r, mode: "appr" }, r.id)) : /* @__PURE__ */ jsx6(Empty, { children: "Tidak ada request yang menunggu." })
  ] });
}
function VTim() {
  const { db: db2, sel, ui } = useApp();
  const l = db2.R.filter((r) => sel.user(r.by)?.boss == ui.me && r.st != "Draft").sort((a, b) => b.tgl < a.tgl ? -1 : 1);
  return /* @__PURE__ */ jsxs6(Fragment4, { children: [
    /* @__PURE__ */ jsx6(Hd, { t: "Request tim", s: "Semua request anggota tim Anda." }),
    l.length ? l.map((r) => /* @__PURE__ */ jsx6(ReqCard, { r, mode: "tim" }, r.id)) : /* @__PURE__ */ jsx6(Empty, { children: "Belum ada request dari tim." })
  ] });
}

// src/views/AdminDeptViews.jsx
import { useState as useState5 } from "react";
import { Fragment as Fragment5, jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
function HoldRow({ i, m }) {
  const { sel, me, act } = useApp();
  const [a, setA] = useState5("");
  return /* @__PURE__ */ jsxs7("div", { className: "item", children: [
    /* @__PURE__ */ jsxs7("div", { className: "between", children: [
      /* @__PURE__ */ jsxs7("span", { children: [
        sel.nm(sel.RQ(i.req).by),
        ", ",
        i.qty,
        " ",
        m.sat
      ] }),
      /* @__PURE__ */ jsx7("small", { children: i.req })
    ] }),
    i.tahan ? /* @__PURE__ */ jsxs7(Fragment5, { children: [
      /* @__PURE__ */ jsxs7("div", { className: "lbl t-warn", children: [
        "Ditahan: ",
        i.alasan
      ] }),
      /* @__PURE__ */ jsx7("div", { className: "acts", children: /* @__PURE__ */ jsx7("button", { className: "btn alt", onClick: () => act("lepas", i.id, me.id), children: "Lepas tahan" }) })
    ] }) : /* @__PURE__ */ jsxs7("div", { className: "acts", children: [
      /* @__PURE__ */ jsx7("input", { value: a, onChange: (e) => setA(e.target.value), placeholder: "Alasan menahan", style: { flex: 1 } }),
      /* @__PURE__ */ jsx7("button", { className: "btn alt", onClick: () => act("tahan", i.id, a.trim(), me.id), children: "Tahan" })
    ] })
  ] });
}
function VPool() {
  const { sel, me, act, toast } = useApp();
  const [no, setNo] = useState5("");
  const [est, setEst] = useState5("");
  const d = me.dept;
  const p = sel.poolAll(d);
  const ready = sel.poolOf(d);
  const g = {};
  p.forEach((i) => (g[i.kode] = g[i.kode] || []).push(i));
  const groups = Object.entries(g).sort(
    (x, y) => (x[1].map((i) => i.datang).sort()[0] || "9") < (y[1].map((i) => i.datang).sort()[0] || "9") ? -1 : 1
  );
  const copyAll = () => {
    const t = {};
    ready.forEach((i) => t[i.kode] = (t[i.kode] || 0) + +i.qty);
    copyText(Object.entries(t).map(([k, q]) => k + "	" + q).join("\n"), toast);
  };
  return /* @__PURE__ */ jsxs7(Fragment5, { children: [
    /* @__PURE__ */ jsx7(Hd, { t: "Pool " + d, s: "Request disetujui yang belum dibuat di ERO. Paling mendesak di atas." }),
    groups.length > 0 && /* @__PURE__ */ jsxs7("div", { className: "row", style: { gridColumn: "1/-1" }, children: [
      /* @__PURE__ */ jsxs7("b", { children: [
        new Set(ready.map((i) => i.kode)).size,
        " barang dari ",
        new Set(ready.map((i) => i.req)).size,
        " request siap dibuat di ERO"
      ] }),
      /* @__PURE__ */ jsx7("br", {}),
      /* @__PURE__ */ jsx7("small", { className: "mut", children: "1. Salin daftar, buat SRL di ERO. 2. Simpan nomor SRL di sini. Status barang otomatis menjadi Sudah di ERO." }),
      /* @__PURE__ */ jsx7("div", { className: "acts", children: /* @__PURE__ */ jsx7("button", { className: "btn alt grow", onClick: copyAll, children: "Salin semua (article dan qty)" }) }),
      /* @__PURE__ */ jsxs7("div", { className: "grid", children: [
        /* @__PURE__ */ jsxs7("label", { children: [
          "No. SRL dari ERO",
          /* @__PURE__ */ jsx7("input", { value: no, onChange: (e) => setNo(e.target.value), placeholder: "SRL-2611-003" })
        ] }),
        /* @__PURE__ */ jsxs7("label", { children: [
          "Estimasi datang (opsional)",
          /* @__PURE__ */ jsx7("input", { type: "date", min: today(), value: est, onChange: (e) => setEst(e.target.value) })
        ] })
      ] }),
      /* @__PURE__ */ jsx7("div", { className: "acts", children: /* @__PURE__ */ jsx7(
        "button",
        {
          className: "btn grow",
          onClick: () => {
            if (act("simpanSrl", { no: no.trim(), est, me })) {
              setNo("");
              setEst("");
            }
          },
          children: "Simpan SRL"
        }
      ) })
    ] }),
    groups.length ? groups.map(([k, a]) => {
      const m = sel.mi(k);
      const ok = a.filter((i) => !i.tahan);
      const late = ok.some((i) => i.datang < today());
      const wt = Math.max(...a.map((i) => days(i.appr)));
      return /* @__PURE__ */ jsxs7("div", { className: "row", children: [
        /* @__PURE__ */ jsxs7("div", { className: "between", children: [
          /* @__PURE__ */ jsx7("b", { children: m.n }),
          /* @__PURE__ */ jsxs7("span", { children: [
            late && /* @__PURE__ */ jsxs7(Fragment5, { children: [
              /* @__PURE__ */ jsx7(Pill, { t: "t-bad", children: "Tanggal datang terlewat" }),
              " "
            ] }),
            wt >= 3 && /* @__PURE__ */ jsxs7(Fragment5, { children: [
              /* @__PURE__ */ jsxs7(Pill, { t: "t-warn", children: [
                "Menunggu ",
                wt,
                " hari"
              ] }),
              " "
            ] }),
            /* @__PURE__ */ jsx7(Pill, { t: "t-info", children: m.buf == "1" ? "Buffer" : "Non buffer" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs7("small", { className: "mut", children: [
          ok.length,
          " request, total ",
          sum(ok, (i) => i.qty),
          " ",
          m.sat,
          ". Datang terawal ",
          D(ok.map((i) => i.datang).sort()[0]),
          ", menunggu ",
          wt,
          " hari."
        ] }),
        a.map((i) => /* @__PURE__ */ jsx7(HoldRow, { i, m }, i.id))
      ] }, k);
    }) : /* @__PURE__ */ jsx7(Empty, { children: "Pool kosong. Request yang disetujui atasan akan muncul di sini." })
  ] });
}
function KonCard({ k }) {
  const { db: db2, sel, me, act } = useApp();
  const [alasan, setAlasan] = useState5("");
  const m = sel.mi(k.kode);
  const t = sel.total(k);
  const dt = sel.datang(k);
  const s = sel.sisa(k);
  const peminta = db2.I.filter((i) => i.kon == k.id && sel.live(i));
  return /* @__PURE__ */ jsxs7("div", { className: "row", children: [
    /* @__PURE__ */ jsxs7("div", { className: "between", children: [
      /* @__PURE__ */ jsxs7("div", { children: [
        /* @__PURE__ */ jsx7("b", { children: m.n }),
        " ",
        /* @__PURE__ */ jsx7("small", { children: k.id })
      ] }),
      /* @__PURE__ */ jsx7(Pill, { t: k.tahap == "Konsolidasi" ? "t-vio" : "t-ok", children: k.tahap })
    ] }),
    /* @__PURE__ */ jsxs7("small", { className: "mut", children: [
      peminta.length,
      " request, total ",
      t,
      " ",
      m.sat,
      k.srl ? ", " + k.srl : "",
      k.by ? ", dibuat " + sel.nm(k.by) : ""
    ] }),
    /* @__PURE__ */ jsx7("br", {}),
    /* @__PURE__ */ jsxs7("small", { className: "mut", children: [
      "Peminta: ",
      peminta.map((i) => sel.nm(sel.RQ(i.req).by).split(" ")[0] + " " + i.qty).join(", ")
    ] }),
    /* @__PURE__ */ jsx7("div", { className: "bar", children: /* @__PURE__ */ jsx7("b", { style: { width: (t ? Math.min(100, dt / t * 100) : 0) + "%" } }) }),
    /* @__PURE__ */ jsxs7("small", { className: "mut", children: [
      "Datang ",
      dt,
      " dari ",
      t,
      k.tutup > 0 ? ", ditutup " + k.tutup + " (" + k.alasan + ")" : "",
      s > 0 ? ", sisa " + s : ""
    ] }),
    s > 0 && /* @__PURE__ */ jsxs7("div", { className: "acts", children: [
      /* @__PURE__ */ jsx7("input", { value: alasan, onChange: (e) => setAlasan(e.target.value), placeholder: "Alasan menutup sisa", style: { flex: 1 } }),
      /* @__PURE__ */ jsx7("button", { className: "btn alt", onClick: () => {
        if (act("tutup", k.id, alasan.trim(), me.id)) setAlasan("");
      }, children: "Tutup sisa" })
    ] })
  ] });
}
function VKon() {
  const { db: db2, me } = useApp();
  const l = db2.K.filter((k) => k.dept == me.dept).sort((a, b) => b.id < a.id ? -1 : 1);
  return /* @__PURE__ */ jsxs7(Fragment5, { children: [
    /* @__PURE__ */ jsx7(Hd, { t: "Konsolidasi " + me.dept, s: "Status tiap SRL dan barang yang sudah datang." }),
    l.length ? l.map((k) => /* @__PURE__ */ jsx7(KonCard, { k }, k.id)) : /* @__PURE__ */ jsx7(Empty, { children: "Belum ada konsolidasi. Mulai dari tab Pool." })
  ] });
}
function VAll() {
  const { db: db2, sel, me, ui, setUi } = useApp();
  const d = me.dept;
  const q = ui.q.toLowerCase();
  const f = ui.sf;
  const names = ["Diajukan", "Disetujui", "Dikonsolidasi", "Di ERO", "Barang tiba"];
  const l = db2.R.filter(
    (r) => sel.user(r.by)?.dept == d && r.st != "Draft" && (!q || sel.nm(r.by).toLowerCase().includes(q) || db2.I.some((i) => i.req == r.id && sel.mi(i.kode).n.toLowerCase().includes(q))) && (!f || db2.I.some((i) => i.req == r.id && sel.live(i) && sel.st(i)[0] == f))
  ).sort((a, b) => b.tgl < a.tgl ? -1 : 1);
  return /* @__PURE__ */ jsxs7(Fragment5, { children: [
    /* @__PURE__ */ jsx7(Hd, { t: "Semua request " + d, s: l.length + " request ditemukan." }),
    /* @__PURE__ */ jsxs7("div", { className: "grid", style: { gridColumn: "1/-1" }, children: [
      /* @__PURE__ */ jsxs7("label", { children: [
        "Cari nama atau barang",
        /* @__PURE__ */ jsx7("input", { value: ui.q, onChange: (e) => setUi({ q: e.target.value }), placeholder: "Ketik nama atau barang" })
      ] }),
      /* @__PURE__ */ jsxs7("label", { children: [
        "Tahap barang",
        /* @__PURE__ */ jsxs7("select", { value: f, onChange: (e) => setUi({ sf: e.target.value }), children: [
          /* @__PURE__ */ jsx7("option", { value: "", children: "Semua" }),
          names.map((n, i) => /* @__PURE__ */ jsx7("option", { value: i, children: n }, i))
        ] })
      ] })
    ] }),
    l.length ? l.map((r) => /* @__PURE__ */ jsx7(ReqCard, { r, mode: "tim" }, r.id)) : /* @__PURE__ */ jsx7(Empty, { children: "Tidak ada request yang cocok dengan filter." })
  ] });
}

// src/views/WarehouseViews.jsx
import { Fragment as Fragment6, useState as useState6 } from "react";
import { Fragment as Fragment7, jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function DatangCard({ k }) {
  const { sel, me, act } = useApp();
  const [q, setQ] = useState6("");
  const [l, setL] = useState6("0");
  const [cat, setCat] = useState6("");
  const [open, setOpen] = useState6(false);
  const m = sel.mi(k.kode);
  const tot = sel.total(k);
  const dt = sel.datang(k);
  const sisa = sel.sisa(k);
  const pct = tot ? Math.min(100, Math.round(dt / tot * 100)) : 0;
  const lebih = +l > 0;
  const over = +q > sisa;
  const needCat = lebih && !cat.trim();
  const can = (+q > 0 || lebih) && !over && !needCat;
  const submit = () => {
    if (act("datang", { id: k.id, q: +q, l: +l, cat: cat.trim(), by: me.id })) {
      setQ("");
      setL("0");
      setCat("");
      setOpen(false);
    }
  };
  return /* @__PURE__ */ jsxs8("div", { className: "row", children: [
    /* @__PURE__ */ jsxs8("div", { className: "between", children: [
      /* @__PURE__ */ jsx8("b", { children: m.n }),
      /* @__PURE__ */ jsx8("small", { children: k.id })
    ] }),
    /* @__PURE__ */ jsx8("div", { className: "pbar", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "Progres kedatangan", children: /* @__PURE__ */ jsx8("i", { style: { width: pct + "%" } }) }),
    /* @__PURE__ */ jsxs8("small", { className: "mut", children: [
      "Datang ",
      dt,
      " dari ",
      tot,
      " ",
      m.sat,
      ". Sisa ",
      /* @__PURE__ */ jsx8("b", { children: sisa }),
      " ",
      m.sat,
      "."
    ] }),
    /* @__PURE__ */ jsxs8("div", { className: "qrow", style: { marginTop: 10 }, children: [
      /* @__PURE__ */ jsxs8("label", { children: [
        "Jumlah datang (",
        m.sat,
        ")",
        /* @__PURE__ */ jsx8("input", { type: "number", inputMode: "decimal", min: "0", step: "any", max: sisa, value: q, placeholder: "0", onChange: (e) => setQ(e.target.value) })
      ] }),
      /* @__PURE__ */ jsxs8("button", { className: "btn alt", onClick: () => setQ(String(sisa)), children: [
        "Semua sisa (",
        sisa,
        ")"
      ] })
    ] }),
    over ? /* @__PURE__ */ jsxs8("div", { className: "hint", role: "alert", children: [
      "Melebihi sisa. Maksimal ",
      sisa,
      " ",
      m.sat,
      '. Kelebihan isi di "Ada kelebihan".'
    ] }) : null,
    open || lebih ? /* @__PURE__ */ jsxs8("div", { className: "f", children: [
      /* @__PURE__ */ jsx8("div", { className: "grid", style: { marginTop: 0 }, children: /* @__PURE__ */ jsxs8("label", { children: [
        "Jumlah lebih (",
        m.sat,
        ")",
        /* @__PURE__ */ jsx8("input", { type: "number", inputMode: "decimal", min: "0", step: "any", value: l, onChange: (e) => setL(e.target.value) })
      ] }) }),
      /* @__PURE__ */ jsxs8("label", { children: [
        "Catatan kelebihan (wajib)",
        /* @__PURE__ */ jsx8("input", { value: cat, onChange: (e) => setCat(e.target.value), placeholder: "Contoh: supplier kirim lebih" })
      ] }),
      needCat ? /* @__PURE__ */ jsx8("div", { className: "hint", role: "alert", children: "Isi catatan karena ada kelebihan." }) : null
    ] }) : /* @__PURE__ */ jsx8("button", { className: "lnk", onClick: () => setOpen(true), children: "+ Ada kelebihan barang?" }),
    /* @__PURE__ */ jsx8("div", { className: "acts", children: /* @__PURE__ */ jsx8("button", { className: "btn grow", disabled: !can, onClick: submit, children: +q > 0 ? `Catat ${+q} ${m.sat} datang` : "Catat kedatangan" }) })
  ] });
}
function VDtg() {
  const { db: db2, sel, me, act } = useApp();
  const l = db2.K.filter((k) => k.tahap == "Sudah di ERO" && sel.sisa(k) > 0);
  const g = {};
  l.forEach((k) => (g[k.srl] = g[k.srl] || []).push(k));
  const pk = useSrlPick(g, sel);
  return /* @__PURE__ */ jsxs8(Fragment7, { children: [
    /* @__PURE__ */ jsx8(Hd, { t: "Kedatangan barang", s: "Pilih nomor SRL, lalu catat barang yang tiba." }),
    l.length ? /* @__PURE__ */ jsxs8(Fragment7, { children: [
      /* @__PURE__ */ jsx8(SrlPicker, { g, sel, ...pk }),
      pk.shown.map((n) => {
        const a = g[n];
        const s = sel.SRLof(n);
        return /* @__PURE__ */ jsxs8(Fragment6, { children: [
          /* @__PURE__ */ jsxs8("div", { className: "srl between", style: { alignItems: "center" }, children: [
            /* @__PURE__ */ jsxs8("span", { children: [
              n,
              " ",
              /* @__PURE__ */ jsxs8("small", { className: "mut", children: [
                s?.dept,
                ", estimasi ",
                D(s?.est)
              ] })
            ] }),
            /* @__PURE__ */ jsx8(Confirm, { className: "btn alt", onConfirm: () => act("datangAll", n, me.id), children: "Semua datang sesuai jumlah" })
          ] }),
          a.map((k) => /* @__PURE__ */ jsx8(DatangCard, { k }, k.id))
        ] }, n);
      })
    ] }) : /* @__PURE__ */ jsx8(Empty, { children: "Semua barang di ERO sudah tiba." })
  ] });
}
function SerahCard({ i }) {
  const { db: db2, sel, me, act } = useApp();
  const m = sel.mi(i.kode);
  const r = sel.RQ(i.req);
  const b = sel.siap(i);
  const [q, setQ] = useState6(String(b));
  const w = days(sel.lastArrival(i.kon) || today());
  const n = sel.reminders(i.id).length;
  const hp = db2.HP[r.by];
  const first = sel.nm(r.by).split(" ")[0];
  const msg = "Halo " + sel.nm(r.by) + ", " + b + " " + m.sat + " " + m.n + " sudah siap diambil di Warehouse.";
  return /* @__PURE__ */ jsxs8("div", { className: "row", children: [
    /* @__PURE__ */ jsxs8("div", { className: "between", children: [
      /* @__PURE__ */ jsx8("b", { children: m.n }),
      /* @__PURE__ */ jsxs8("span", { children: [
        b,
        " ",
        m.sat
      ] })
    ] }),
    /* @__PURE__ */ jsxs8("small", { className: "mut", children: [
      "PIC ",
      sel.nm(r.by),
      ", ",
      sel.user(r.by).dept,
      ", pakai ",
      D(i.pakai),
      ". Dipesan ",
      i.qty,
      "."
    ] }),
    /* @__PURE__ */ jsx8("br", {}),
    /* @__PURE__ */ jsxs8(Pill, { t: w >= 3 ? "t-warn" : "t-gray", children: [
      "Di gudang ",
      w,
      " hari"
    ] }),
    " ",
    n ? /* @__PURE__ */ jsxs8(Pill, { t: "t-info", children: [
      "Diingatkan ",
      n,
      " kali"
    ] }) : null,
    /* @__PURE__ */ jsxs8("div", { className: "qrow", style: { marginTop: 10 }, children: [
      /* @__PURE__ */ jsxs8("label", { style: { flex: "0 0 120px" }, children: [
        "Jumlah (",
        m.sat,
        ")",
        /* @__PURE__ */ jsx8("input", { type: "number", inputMode: "decimal", value: q, min: "0", max: b, step: "any", onChange: (e) => setQ(e.target.value) })
      ] }),
      /* @__PURE__ */ jsxs8("button", { className: "btn grow", disabled: !(+q > 0 && +q <= b), onClick: () => act("serah", i.id, +q, me.id), children: [
        "Serahkan ke ",
        first
      ] })
    ] }),
    +q > b ? /* @__PURE__ */ jsxs8("div", { className: "hint", role: "alert", children: [
      "Maksimal ",
      b,
      " ",
      m.sat,
      " yang siap diserahkan."
    ] }) : null,
    /* @__PURE__ */ jsx8("div", { className: "acts", children: hp && /* @__PURE__ */ jsx8(
      "a",
      {
        className: "btn alt grow",
        target: "_blank",
        rel: "noopener",
        href: `https://wa.me/${hp}?text=${encodeURIComponent(msg)}`,
        onClick: () => act("ingat", i.id, me.id),
        children: "Ingatkan via WA"
      }
    ) })
  ] });
}
function VSrh() {
  const { db: db2, sel } = useApp();
  const l = db2.I.filter((i) => i.status == "Sudah di ERO" && sel.siap(i) > 0).sort(sel.ord);
  const g = {};
  l.forEach((i) => {
    const no = sel.KN(i.kon)?.srl || "-";
    (g[no] = g[no] || []).push(i);
  });
  const pk = useSrlPick(g, sel);
  return /* @__PURE__ */ jsxs8(Fragment7, { children: [
    /* @__PURE__ */ jsx8(Hd, { t: "Serah terima", s: "Pilih nomor SRL. Urutan mengikuti kebutuhan paling dekat." }),
    l.length ? /* @__PURE__ */ jsxs8(Fragment7, { children: [
      /* @__PURE__ */ jsx8(SrlPicker, { g, sel, ...pk }),
      pk.shown.map((n) => {
        const s = sel.SRLof(n);
        return /* @__PURE__ */ jsxs8(Fragment6, { children: [
          /* @__PURE__ */ jsxs8("div", { className: "srl", children: [
            n,
            s ? /* @__PURE__ */ jsxs8("small", { className: "mut", children: [
              " ",
              s.dept,
              ", estimasi ",
              D(s.est)
            ] }) : null
          ] }),
          g[n].map((i) => /* @__PURE__ */ jsx8(SerahCard, { i }, i.id))
        ] }, n);
      })
    ] }) : /* @__PURE__ */ jsx8(Empty, { children: "Belum ada barang yang siap diserahkan." })
  ] });
}

// src/views/UsersView.jsx
import { Fragment as Fragment8, jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
function VUsr() {
  const { db: db2, me, ui, setUi } = useApp();
  const wh2 = me.role == "Admin Warehouse";
  const d = wh2 ? ui.ud : me.dept;
  const deps = [...new Set(db2.U.map((u) => u.dept))];
  const q = ui.uq.toLowerCase();
  const l = db2.U.filter((u) => (!d || u.dept == d) && (!q || (u.n + u.id).toLowerCase().includes(q)));
  return /* @__PURE__ */ jsxs9(Fragment8, { children: [
    /* @__PURE__ */ jsx9(Hd, { t: wh2 ? "Pengguna" : "Pengguna " + d, s: l.length + " pengguna. Ketuk untuk mengubah." }),
    /* @__PURE__ */ jsxs9("div", { className: "grid", style: { gridColumn: "1/-1" }, children: [
      /* @__PURE__ */ jsxs9("label", { children: [
        "Cari",
        /* @__PURE__ */ jsx9("input", { value: ui.uq, onChange: (e) => setUi({ uq: e.target.value }), placeholder: "Nama atau email" })
      ] }),
      wh2 && /* @__PURE__ */ jsxs9("label", { children: [
        "Departemen",
        /* @__PURE__ */ jsxs9("select", { value: d, onChange: (e) => setUi({ ud: e.target.value }), children: [
          /* @__PURE__ */ jsx9("option", { value: "", children: "Semua" }),
          deps.map((x) => /* @__PURE__ */ jsx9("option", { value: x, children: x }, x))
        ] })
      ] })
    ] }),
    l.map((u) => /* @__PURE__ */ jsxs9("button", { className: "urow", onClick: () => setUi({ eu: u.id, self: false }), children: [
      /* @__PURE__ */ jsxs9("span", { children: [
        /* @__PURE__ */ jsx9("b", { children: u.n }),
        /* @__PURE__ */ jsx9("br", {}),
        /* @__PURE__ */ jsxs9("small", { className: "mut", children: [
          u.role,
          ", ",
          u.dept
        ] })
      ] }),
      /* @__PURE__ */ jsxs9("span", { children: [
        /* @__PURE__ */ jsx9(Pill, { t: u.off ? "t-gray" : "t-ok", children: u.off ? "Nonaktif" : "Aktif" }),
        /* @__PURE__ */ jsx9("br", {}),
        /* @__PURE__ */ jsx9("small", { className: "mut", children: db2.HP[u.id] ? disp(db2.HP[u.id]) : "Belum ada nomor WA" })
      ] })
    ] }, u.id)),
    /* @__PURE__ */ jsx9("div", { className: "fabw", style: { gridColumn: "1/-1" }, children: /* @__PURE__ */ jsx9("button", { className: "btn fab", onClick: () => setUi({ eu: "new", self: false }), children: "+ Tambah pengguna" }) })
  ] });
}

// src/views/DashboardView.jsx
import { useMemo as useMemo2, useState as useState7 } from "react";
import { Fragment as Fragment9, jsx as jsx10, jsxs as jsxs10 } from "react/jsx-runtime";
var Kpi = ({ l, v, s }) => /* @__PURE__ */ jsxs10("div", { className: "kpi", children: [
  /* @__PURE__ */ jsx10("small", { className: "mut", children: l }),
  /* @__PURE__ */ jsx10("b", { children: v }),
  s ? /* @__PURE__ */ jsx10("small", { className: "mut", children: s }) : null
] });
var KpiBtn = ({ l, v, s, on, onClick }) => /* @__PURE__ */ jsxs10("button", { className: "kpi kbtn" + (on ? " on" : ""), onClick, "aria-pressed": on, children: [
  /* @__PURE__ */ jsx10("small", { className: "mut", children: l }),
  /* @__PURE__ */ jsx10("b", { children: v }),
  /* @__PURE__ */ jsx10("small", { className: "mut", children: s })
] });
var Th = ({ a }) => /* @__PURE__ */ jsx10("tr", { children: a.map((x) => /* @__PURE__ */ jsx10("th", { children: x }, x)) });
var agePill = (w) => w >= 7 ? "t-bad" : w >= 3 ? "t-warn" : "t-gray";
var rowKey = (fn) => (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};
function VDash() {
  const { db: db2, sel, ui, setUi } = useApp();
  const f = ui.df;
  const pr = ui.dp;
  const [qs, setQs] = useState7("");
  const m = useMemo2(() => {
    const dayOfWeek = (/* @__PURE__ */ new Date(today() + "T00:00:00Z")).getUTCDay();
    const ws = addDays(today(), -((dayOfWeek + 6) % 7));
    const ps2 = pr == "w1" ? addDays(ws, -7) : pr == "w4" ? addDays(ws, -21) : ws;
    const pe2 = pr == "w1" ? addDays(ws, -1) : today();
    const inP2 = (d) => !!d && d.slice(0, 10) >= ps2 && d.slice(0, 10) <= pe2;
    const w2 = db2.I.filter((i) => i.status == "Sudah di ERO" && sel.siap(i) > 0).map((i) => {
      const r = sel.RQ(i.req);
      const a = sel.lastArrival(i.kon);
      return { i, m: sel.mi(i.kode), b: sel.siap(i), u: r.by, by: sel.nm(r.by), d: sel.deptOf(i), a, w: days(a || today()), rm: sel.reminders(i.id) };
    }).sort((x, y) => y.w - x.w);
    const kd2 = db2.KD.filter((d) => inP2(d.tgl));
    const sr2 = db2.SR.filter((s) => inP2(s.tgl));
    const rmP2 = db2.RM.filter((x) => inP2(x.at));
    const pk = db2.SR.filter((s) => s.tgl).map((s) => {
      const it = db2.I.find((x) => x.id == s.item);
      const a = it && sel.firstArrival(it.kon);
      return a ? { d: sel.deptOf(it), v: dayDiff(a, s.tgl), t: s.tgl } : null;
    }).filter((x) => x && x.v >= 0);
    const pkP2 = pk.filter((x) => inP2(x.t));
    const sl = [...new Set(db2.K.filter((k) => k.srl).map((k) => k.srl))].sort().reverse().map((no) => {
      const ks = db2.K.filter((k) => k.srl == no);
      const ids = ks.map((k) => k.id);
      const ap = db2.I.filter((i) => ids.includes(i.kon) && sel.live(i) && i.appr).map((i) => i.appr.slice(0, 10)).sort()[0];
      const ds = db2.KD.filter((d) => ids.includes(d.kon)).map((d) => d.tgl).sort();
      const est = sel.SRLof(no)?.est;
      const first = ds[0];
      return {
        no,
        d: ks[0].dept,
        ap,
        first,
        est,
        tot: sum(ks, sel.total),
        dt: sum(ks, sel.datang),
        open: ks.some((k) => sel.sisa(k) > 0),
        lt: ap && first ? dayDiff(ap, first) : null,
        late: !!est && (first ? first > est : est < today())
      };
    });
    const slP2 = sl.filter((x) => inP2(x.first));
    return {
      ps: ps2,
      pe: pe2,
      inP: inP2,
      w: w2,
      kd: kd2,
      sr: sr2,
      rmP: rmP2,
      pkP: pkP2,
      slP: slP2,
      slT: sl.filter((x) => inP2(x.first) || x.open),
      ot: slP2.filter((x) => x.est),
      deps: [...new Set(db2.U.filter((u) => u.dept != "Warehouse").map((u) => u.dept))],
      adm: db2.U.filter((u) => u.role == "Admin Warehouse" && !u.off)
    };
  }, [db2, sel, pr]);
  const { ps, pe, inP, w, kd, sr, rmP, pkP, slP, slT, ot, deps, adm } = m;
  const qq = qs.trim().toLowerCase();
  const lw = w.filter((x) => f == "late" ? x.w >= 3 : f == "none" ? !x.rm.length : true).filter((x) => !qq || (x.m.n + " " + x.i.id + " " + x.by + " " + x.d).toLowerCase().includes(qq));
  const pics = Object.values(lw.reduce((o, x) => ((o[x.u] = o[x.u] || []).push(x), o), {})).sort((p, q) => Math.max(...q.map((x) => x.w)) - Math.max(...p.map((x) => x.w)));
  const [lwV, lwMore] = useMore(lw);
  const [picV, picMore] = useMore(pics);
  const [slV, slMore] = useMore(slT);
  const a0 = w.filter((x) => x.w < 3).length;
  const a1 = w.filter((x) => x.w >= 3 && x.w < 7).length;
  const a2 = w.filter((x) => x.w >= 7).length;
  const pct = (n) => w.length ? n / w.length * 100 : 0;
  return /* @__PURE__ */ jsxs10(Fragment9, { children: [
    /* @__PURE__ */ jsx10(Hd, { t: "Dashboard Warehouse", s: "Monitoring untuk OPR mingguan. Pengingat dilakukan Admin Warehouse." }),
    /* @__PURE__ */ jsxs10("div", { className: "grid", style: { gridColumn: "1/-1" }, children: [
      /* @__PURE__ */ jsxs10("label", { children: [
        "Periode (",
        D(ps),
        " sampai ",
        D(pe),
        ")",
        /* @__PURE__ */ jsxs10("select", { value: pr, onChange: (e) => setUi({ dp: e.target.value }), children: [
          /* @__PURE__ */ jsx10("option", { value: "w0", children: "Minggu ini" }),
          /* @__PURE__ */ jsx10("option", { value: "w1", children: "Minggu lalu" }),
          /* @__PURE__ */ jsx10("option", { value: "w4", children: "4 minggu terakhir" })
        ] })
      ] }),
      /* @__PURE__ */ jsx10("div", { style: { alignSelf: "end" }, children: /* @__PURE__ */ jsx10("button", { className: "btn alt", style: { width: "100%" }, onClick: () => window.print(), children: "Cetak atau simpan PDF" }) })
    ] }),
    /* @__PURE__ */ jsx10(Srl, { children: "Posisi hari ini" }),
    /* @__PURE__ */ jsxs10("div", { className: "kpis", children: [
      /* @__PURE__ */ jsx10(KpiBtn, { l: "Belum diambil", v: w.length, s: "barang di gudang", on: f == "", onClick: () => setUi({ df: "" }) }),
      /* @__PURE__ */ jsx10(KpiBtn, { l: "Menunggu 3 hari atau lebih", v: a1 + a2, s: a2 + " di antaranya 7 hari atau lebih", on: f == "late", onClick: () => setUi({ df: "late" }) }),
      /* @__PURE__ */ jsx10(KpiBtn, { l: "Belum pernah diingatkan", v: w.filter((x) => !x.rm.length).length, s: "dari " + w.length + " barang", on: f == "none", onClick: () => setUi({ df: "none" }) }),
      /* @__PURE__ */ jsx10(Kpi, { l: "PIC belum mengambil", v: new Set(w.map((x) => x.u)).size, s: "orang peminta" })
    ] }),
    /* @__PURE__ */ jsxs10("div", { style: { gridColumn: "1/-1", marginTop: 10 }, children: [
      /* @__PURE__ */ jsxs10("div", { className: "agb", role: "img", "aria-label": `Aging: ${a0} kurang dari 3 hari, ${a1} 3 sampai 6 hari, ${a2} 7 hari atau lebih`, children: [
        /* @__PURE__ */ jsx10("i", { style: { width: pct(a0) + "%", background: "var(--gray)" } }),
        /* @__PURE__ */ jsx10("i", { style: { width: pct(a1) + "%", background: "var(--warn)" } }),
        /* @__PURE__ */ jsx10("i", { style: { width: pct(a2) + "%", background: "var(--bad)" } })
      ] }),
      /* @__PURE__ */ jsxs10("small", { className: "mut", children: [
        "Lama di gudang: ",
        a0,
        " kurang dari 3 hari, ",
        a1,
        " 3 sampai 6 hari, ",
        a2,
        " 7 hari atau lebih"
      ] })
    ] }),
    /* @__PURE__ */ jsx10(Srl, { children: "Kinerja periode" }),
    /* @__PURE__ */ jsxs10("div", { className: "kpis", children: [
      /* @__PURE__ */ jsx10(Kpi, { l: "Barang tiba", v: sum(kd, (d) => d.qty), s: kd.length + " pencatatan" }),
      /* @__PURE__ */ jsx10(Kpi, { l: "Diserahkan", v: sum(sr, (s) => s.qty), s: sr.length + " serah terima" }),
      /* @__PURE__ */ jsx10(Kpi, { l: "Lead time kedatangan", v: f1(avg(slP.map((x) => x.lt).filter((v) => v != null))) + (slP.length ? " hari" : ""), s: "disetujui sampai datang pertama" }),
      /* @__PURE__ */ jsx10(Kpi, { l: "Lead time pengambilan", v: f1(avg(pkP.map((x) => x.v))) + (pkP.length ? " hari" : ""), s: "datang sampai diserahkan" }),
      /* @__PURE__ */ jsx10(Kpi, { l: "SRL tepat waktu", v: ot.length ? Math.round(ot.filter((x) => !x.late).length / ot.length * 100) + "%" : "-", s: ot.length ? ot.filter((x) => !x.late).length + " dari " + ot.length + " SRL" : "belum ada SRL datang" }),
      /* @__PURE__ */ jsx10(Kpi, { l: "Pengingat terkirim", v: rmP.length, s: "oleh admin warehouse" })
    ] }),
    /* @__PURE__ */ jsx10(Srl, { children: "Sudah sampai, belum diambil" }),
    /* @__PURE__ */ jsxs10("div", { className: "grid", style: { gridColumn: "1/-1" }, children: [
      /* @__PURE__ */ jsxs10("label", { children: [
        "Tampilkan",
        /* @__PURE__ */ jsxs10("select", { value: f, onChange: (e) => setUi({ df: e.target.value }), children: [
          /* @__PURE__ */ jsx10("option", { value: "", children: "Semua" }),
          /* @__PURE__ */ jsx10("option", { value: "late", children: "Menunggu 3 hari atau lebih" }),
          /* @__PURE__ */ jsx10("option", { value: "none", children: "Belum pernah diingatkan" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs10("label", { children: [
        "Cari",
        /* @__PURE__ */ jsx10("input", { type: "search", value: qs, placeholder: "Barang, PIC, departemen", onChange: (e) => setQs(e.target.value) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs10("p", { className: "mut", style: { gridColumn: "1/-1", margin: "0 0 6px" }, children: [
      lw.length,
      " barang. Ketuk kartu di atas untuk menyaring, atau ketuk baris untuk melihat detail barang."
    ] }),
    lw.length ? /* @__PURE__ */ jsx10("div", { className: "tw", children: /* @__PURE__ */ jsxs10("table", { className: "tbl", children: [
      /* @__PURE__ */ jsx10("thead", { children: /* @__PURE__ */ jsx10(Th, { a: ["Barang", "Qty", "Peminta", "Datang", "Di gudang", "Pengingat", "Dipakai"] }) }),
      /* @__PURE__ */ jsx10("tbody", { children: lwV.map((x) => {
        const l = x.rm[x.rm.length - 1];
        const open = () => setUi({ di: x.i.id });
        return /* @__PURE__ */ jsxs10("tr", { className: "clk", onClick: open, onKeyDown: rowKey(open), tabIndex: 0, role: "button", "aria-label": "Detail " + x.m.n, children: [
          /* @__PURE__ */ jsxs10("td", { children: [
            x.m.n,
            " ",
            /* @__PURE__ */ jsx10("small", { className: "mut", children: x.i.id })
          ] }),
          /* @__PURE__ */ jsxs10("td", { children: [
            x.b,
            " ",
            x.m.sat
          ] }),
          /* @__PURE__ */ jsxs10("td", { children: [
            x.by,
            /* @__PURE__ */ jsx10("br", {}),
            /* @__PURE__ */ jsx10("small", { className: "mut", children: x.d })
          ] }),
          /* @__PURE__ */ jsx10("td", { children: D(x.a) }),
          /* @__PURE__ */ jsx10("td", { children: /* @__PURE__ */ jsxs10(Pill, { t: agePill(x.w), children: [
            x.w,
            " hari"
          ] }) }),
          /* @__PURE__ */ jsx10("td", { children: l ? /* @__PURE__ */ jsxs10(Fragment9, { children: [
            x.rm.length,
            " kali",
            /* @__PURE__ */ jsx10("br", {}),
            /* @__PURE__ */ jsxs10("small", { className: "mut", children: [
              D(l.at),
              ", ",
              sel.nm(l.by)
            ] })
          ] }) : /* @__PURE__ */ jsx10(Pill, { t: x.w >= 3 ? "t-bad" : "t-gray", children: "Belum" }) }),
          /* @__PURE__ */ jsx10("td", { children: x.i.pakai ? D(x.i.pakai) : "-" })
        ] }, x.i.id);
      }) })
    ] }) }) : /* @__PURE__ */ jsx10(Empty, { children: "Tidak ada barang yang cocok. Ubah kata kunci atau filter." }),
    lwMore,
    /* @__PURE__ */ jsxs10(Srl, { children: [
      "PIC yang belum mengambil (",
      pics.length,
      " orang)"
    ] }),
    pics.length ? /* @__PURE__ */ jsx10("div", { className: "tw", children: /* @__PURE__ */ jsxs10("table", { className: "tbl", children: [
      /* @__PURE__ */ jsx10("thead", { children: /* @__PURE__ */ jsx10(Th, { a: ["PIC", "Barang", "Isi", "Terlama", "Pengingat"] }) }),
      /* @__PURE__ */ jsx10("tbody", { children: picV.map((a) => {
        const x = a[0];
        const mx = Math.max(...a.map((y) => y.w));
        const nr = a.filter((y) => !y.rm.length && y.w >= 3).length;
        const open = () => setUi({ dpic: x.u });
        return /* @__PURE__ */ jsxs10("tr", { className: "clk", onClick: open, onKeyDown: rowKey(open), tabIndex: 0, role: "button", "aria-label": "Detail " + x.by, children: [
          /* @__PURE__ */ jsxs10("td", { children: [
            x.by,
            /* @__PURE__ */ jsx10("br", {}),
            /* @__PURE__ */ jsx10("small", { className: "mut", children: x.d })
          ] }),
          /* @__PURE__ */ jsx10("td", { children: a.length }),
          /* @__PURE__ */ jsxs10("td", { style: { whiteSpace: "normal", minWidth: 200 }, children: [
            a.slice(0, 2).map((y) => y.m.n + " " + y.b).join(", "),
            a.length > 2 ? " +" + (a.length - 2) + " lainnya" : ""
          ] }),
          /* @__PURE__ */ jsx10("td", { children: /* @__PURE__ */ jsxs10(Pill, { t: agePill(mx), children: [
            mx,
            " hari"
          ] }) }),
          /* @__PURE__ */ jsxs10("td", { children: [
            sum(a, (y) => y.rm.length),
            " kali",
            nr ? /* @__PURE__ */ jsxs10(Fragment9, { children: [
              " ",
              /* @__PURE__ */ jsxs10(Pill, { t: "t-bad", children: [
                nr,
                " belum diingatkan"
              ] })
            ] }) : null
          ] })
        ] }, x.u);
      }) })
    ] }) }) : /* @__PURE__ */ jsx10(Empty, { children: "Tidak ada PIC yang menunggu." }),
    picMore,
    /* @__PURE__ */ jsx10(Srl, { children: "Lead time kedatangan per SRL" }),
    slT.length ? /* @__PURE__ */ jsx10("div", { className: "tw", children: /* @__PURE__ */ jsxs10("table", { className: "tbl", children: [
      /* @__PURE__ */ jsx10("thead", { children: /* @__PURE__ */ jsx10(Th, { a: ["SRL", "Dept", "Disetujui", "Datang pertama", "Lead time", "Estimasi", "Status", "Datang"] }) }),
      /* @__PURE__ */ jsx10("tbody", { children: slV.map((x) => /* @__PURE__ */ jsxs10("tr", { children: [
        /* @__PURE__ */ jsx10("td", { children: x.no }),
        /* @__PURE__ */ jsx10("td", { children: x.d }),
        /* @__PURE__ */ jsx10("td", { children: x.ap ? D(x.ap) : "-" }),
        /* @__PURE__ */ jsx10("td", { children: x.first ? D(x.first) : "-" }),
        /* @__PURE__ */ jsx10("td", { children: x.lt == null ? "-" : x.lt + " hari" }),
        /* @__PURE__ */ jsx10("td", { children: x.est ? D(x.est) : "-" }),
        /* @__PURE__ */ jsx10("td", { children: x.first ? x.late ? /* @__PURE__ */ jsxs10(Pill, { t: "t-bad", children: [
          "Telat ",
          dayDiff(x.est, x.first),
          " hari"
        ] }) : /* @__PURE__ */ jsx10(Pill, { t: "t-ok", children: "Tepat waktu" }) : x.late ? /* @__PURE__ */ jsx10(Pill, { t: "t-bad", children: "Lewat estimasi" }) : /* @__PURE__ */ jsx10(Pill, { t: "t-gray", children: "Belum datang" }) }),
        /* @__PURE__ */ jsxs10("td", { children: [
          x.dt,
          " dari ",
          x.tot
        ] })
      ] }, x.no)) })
    ] }) }) : /* @__PURE__ */ jsx10(Empty, { children: "Tidak ada SRL pada periode ini." }),
    slMore,
    /* @__PURE__ */ jsx10(Srl, { children: "Per departemen" }),
    /* @__PURE__ */ jsx10("div", { className: "tw", children: /* @__PURE__ */ jsxs10("table", { className: "tbl", children: [
      /* @__PURE__ */ jsx10("thead", { children: /* @__PURE__ */ jsx10(Th, { a: ["Dept", "Belum diambil", "Rata-rata menunggu", "Pengingat (periode)", "Lead time pengambilan (periode)"] }) }),
      /* @__PURE__ */ jsx10("tbody", { children: deps.map((d) => {
        const a = w.filter((x) => x.d == d);
        const p = pkP.filter((x) => x.d == d);
        return /* @__PURE__ */ jsxs10("tr", { children: [
          /* @__PURE__ */ jsx10("td", { children: d }),
          /* @__PURE__ */ jsx10("td", { children: a.length }),
          /* @__PURE__ */ jsx10("td", { children: a.length ? f1(avg(a.map((x) => x.w))) + " hari" : "-" }),
          /* @__PURE__ */ jsx10("td", { children: sum(a, (x) => x.rm.filter((r) => inP(r.at)).length) }),
          /* @__PURE__ */ jsx10("td", { children: p.length ? f1(avg(p.map((x) => x.v))) + " hari" : "-" })
        ] }, d);
      }) })
    ] }) }),
    /* @__PURE__ */ jsx10(Srl, { children: "Aktivitas admin warehouse (periode)" }),
    /* @__PURE__ */ jsx10("div", { className: "tw", children: /* @__PURE__ */ jsxs10("table", { className: "tbl", children: [
      /* @__PURE__ */ jsx10("thead", { children: /* @__PURE__ */ jsx10(Th, { a: ["Admin", "Kedatangan dicatat", "Pengingat terkirim"] }) }),
      /* @__PURE__ */ jsx10("tbody", { children: adm.map((u) => /* @__PURE__ */ jsxs10("tr", { children: [
        /* @__PURE__ */ jsx10("td", { children: u.n }),
        /* @__PURE__ */ jsx10("td", { children: kd.filter((d) => sel.uid(d.by) == u.id).length }),
        /* @__PURE__ */ jsx10("td", { children: rmP.filter((x) => sel.uid(x.by) == u.id).length })
      ] }, u.id)) })
    ] }) })
  ] });
}

// src/App.jsx
import { Fragment as Fragment10, jsx as jsx11, jsxs as jsxs11 } from "react/jsx-runtime";
var VIEWS = { dash: VDash, allr: VAll, usr: VUsr, req: VReq, new: VNew, appr: VAppr, tim: VTim, pool: VPool, kon: VKon, dtg: VDtg, srh: VSrh };
function Shell() {
  const { db: db2, sel, ui, setUi, me, toastS, sync } = useApp();
  const tabs = TABS[me.role];
  const tab = tabs.find((t) => t[0] == ui.tab) ? ui.tab : tabs[0][0];
  const View = VIEWS[tab];
  const ad = me.role == "Admin Dept";
  const aw = me.role == "Admin Warehouse";
  const cnt = {
    appr: db2.R.filter((r) => r.st == "Menunggu Approval" && sel.user(r.by)?.boss == me.id).length,
    pool: ad ? sel.poolOf(me.dept).length : 0,
    kon: ad ? db2.K.filter((k) => k.dept == me.dept && k.tahap == "Konsolidasi").length : 0,
    dtg: aw ? db2.K.filter((k) => k.tahap == "Sudah di ERO" && sel.sisa(k) > 0).length : 0,
    srh: aw ? db2.I.filter((i) => i.status == "Sudah di ERO" && sel.siap(i) > 0).length : 0
  };
  useEffect3(() => {
    window.scrollTo(0, 0);
  }, [tab, ui.me]);
  useEffect3(() => {
    const h2 = (e) => {
      if (e.key !== "Escape") return;
      if (ui.di) setUi({ di: null });
      else if (ui.menu || ui.eu || ui.help || ui.dpic || ui.pw) setUi({ menu: false, eu: null, self: false, help: false, dpic: null, pw: false });
    };
    document.addEventListener("keydown", h2);
    return () => document.removeEventListener("keydown", h2);
  }, [ui.di, ui.menu, ui.eu, ui.help, ui.dpic, ui.pw, setUi]);
  return /* @__PURE__ */ jsxs11(Fragment10, { children: [
    /* @__PURE__ */ jsxs11("div", { id: "app", children: [
      /* @__PURE__ */ jsxs11("header", { children: [
        /* @__PURE__ */ jsx11("button", { className: "ham", onClick: () => setUi({ menu: true }), "aria-label": "Buka menu", children: /* @__PURE__ */ jsx11("svg", { width: "22", height: "22", viewBox: "0 0 22 22", fill: "none", stroke: "currentColor", strokeWidth: "2", children: /* @__PURE__ */ jsx11("path", { d: "M3 6h16M3 11h16M3 16h16" }) }) }),
        /* @__PURE__ */ jsxs11("div", { style: { flex: 1 }, children: [
          /* @__PURE__ */ jsx11("h1", { children: "Request barang" }),
          /* @__PURE__ */ jsxs11("small", { children: [
            me.n,
            ", ",
            me.role,
            me.role.endsWith(me.dept) ? "" : " " + me.dept,
            sync.pending ? " \xB7 menyimpan\u2026" : sync.err ? " \xB7 offline" : ""
          ] })
        ] }),
        /* @__PURE__ */ jsx11("button", { className: "ham", onClick: () => setUi({ help: true, menu: false }), "aria-label": "Cara pakai", style: { margin: "0 -8px 0 0", fontSize: 20, fontWeight: 700 }, children: "?" })
      ] }),
      ui.menu && /* @__PURE__ */ jsx11(Drawer, { cnt }),
      ui.eu && /* @__PURE__ */ jsx11(UserSheet, {}, ui.eu + ui.self),
      ui.pw && /* @__PURE__ */ jsx11(PwSheet, {}),
      ui.help && /* @__PURE__ */ jsx11(HelpSheet, {}),
      ui.dpic && /* @__PURE__ */ jsx11(PicSheet, {}),
      ui.di && /* @__PURE__ */ jsx11(DetailSheet, {}),
      /* @__PURE__ */ jsx11("main", { className: "v-" + tab, children: /* @__PURE__ */ jsx11(View, {}) }),
      tab == "req" && me.role == "User" && /* @__PURE__ */ jsx11("div", { className: "fabw", children: /* @__PURE__ */ jsx11("button", { className: "btn fab", onClick: () => setUi({ tab: "new" }), children: "+ Buat request" }) }),
      /* @__PURE__ */ jsx11("nav", { "aria-label": "Menu utama", children: tabs.map((t) => /* @__PURE__ */ jsxs11("button", { "aria-current": t[0] == tab ? "true" : void 0, onClick: () => setUi({ tab: t[0], menu: false, eu: null }), children: [
        t[1],
        cnt[t[0]] ? /* @__PURE__ */ jsx11("span", { className: "bdg", "aria-label": cnt[t[0]] + " menunggu", children: cnt[t[0]] }) : null
      ] }, t[0])) })
    ] }),
    /* @__PURE__ */ jsx11("div", { id: "toast", role: toastS.bad ? "alert" : "status", className: toastS.show ? "show" + (toastS.bad ? " err" : "") : "", children: toastS.text })
  ] });
}

// scripts/smoke.mjs
var pass = 0;
var fail = 0;
var render = (label, ui) => {
  try {
    const html = renderToString(h(AppProvider, { initialUi: ui }, h(Shell)));
    if (!html || html.length < 200) throw new Error("keluaran kosong");
    pass++;
  } catch (e) {
    fail++;
    console.log("  GAGAL:", label, "->", e.message.split("\n")[0]);
  }
};
render("layar login", {});
var db = buildSeed();
var roleUser = Object.fromEntries(db.U.map((u) => [u.role, u.id]));
for (const u of db.U) {
  const tabs = TABS[u.role];
  for (const [tab] of tabs) render(`${u.id} / ${tab}`, { me: u.id, tab });
  render(`${u.id} / menu`, { me: u.id, tab: tabs[0][0], menu: true });
  render(`${u.id} / bantuan`, { me: u.id, tab: tabs[0][0], help: true });
  render(`${u.id} / profil`, { me: u.id, tab: tabs[0][0], eu: u.id, self: true });
}
var admin = roleUser["Admin Dept"];
var wh = roleUser["Admin Warehouse"];
var spv = roleUser["Spv Warehouse"];
render("tambah pengguna (Admin Dept)", { me: admin, tab: "usr", eu: "new" });
render("ubah pengguna (Admin Warehouse)", { me: wh, tab: "usr", eu: "andi.prod" });
for (const i of db.I) render(`detail ${i.id} (${i.status})`, { me: spv, tab: "dash", di: i.id });
for (const u of db.U.filter((x) => x.role === "User")) render(`PIC ${u.id}`, { me: wh, tab: "srh", dpic: u.id });
render("ganti password", { me: wh, tab: "dtg", pw: true });
for (const dp of ["w0", "w1"]) render("dashboard " + dp, { me: spv, tab: "dash", dp });
console.log(`${pass} layar OK, ${fail} gagal`);
process.exit(fail ? 1 : 0);
