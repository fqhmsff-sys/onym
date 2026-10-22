// Backend lokal Onym: seluruh "server" (akun, post, hubungan, komentar, dst.) dijalankan di peramban.
// Data teks (akun, post, komentar) ada di localStorage; berkas media (foto, video, suara) disimpan sebagai Blob asli di IndexedDB,
// jadi tidak lagi terbentur kuota localStorage (±5 MB) dan tidak membengkak 33% karena base64.
// Aturannya meniru apps/api (validasi, visibilitas, notifikasi, paginasi) sehingga UI tidak perlu diubah sama sekali.
// Catatan: data hanya ada di peramban/perangkat ini (tidak tersinkron antar perangkat).
import { ApiError } from "./api.js";

const DB_KEY = "hh_local_db";
const SESSION_KEY = "hh_local_session";
const MEDIA_PREFIX = "hh_lm_"; // kunci media di IndexedDB (dulu: data URL di localStorage → dimigrasi otomatis)
const AVATAR_PREFIX = "hh_la_";
const AVATAR_SRC_PREFIX = "hh_lo_"; // foto profil ASLI (tanpa dipotong) agar posisi bisa diatur ulang dan bisa dilihat penuh
const COMMENT_PREFIX = "hh_lc_"; // foto komentar
const COMMENT_AUDIO_PREFIX = "hh_ls_"; // suara komentar (format lama)
const COMMENT_MEDIA_PREFIX = "hh_lq_"; // media komentar (foto/video/suara, banyak per komentar)

const LIMITS = {
  maxVideoMs: 10_000, videoToleranceMs: 350, maxVideoBytes: 64 * 1024 * 1024, maxRequestBytes: 200 * 1024 * 1024,
  maxAudios: 10, maxAudioMs: 180_000, audioToleranceMs: 1500, maxAudioBytes: 40 * 1024 * 1024,
  maxPhotoBytes: 6 * 1024 * 1024, maxPhotoPixels: 40_000_000, maxPhotos: 10, maxAvatarBytes: 1_500_000, minAge: 13,
  usernameMin: 3, usernameMax: 24, displayNameMax: 40, bioMax: 160, postMax: 500, commentMax: 500,
  passwordMin: 8, passwordMax: 128, pageSize: 20,
};
const VISIBILITIES = ["public", "followers", "following", "mutual", "relationship", "friend", "bestfriend", "partner", "family", "me"]; // relationship = semua hubungan; friend/bestfriend/partner/family = jenis tertentu; me = hanya pemilik
// Siapa yang boleh melihat bagian "Anonym" di profil: semua, pengikut, semua hubungan, jenis hubungan tertentu, atau hanya pemilik.
const ANON_VIS = ["everyone", "followers", "following", "mutual", "relations", "friend", "bestfriend", "partner", "family", "me"];
const RELATION_KINDS = ["friend", "bestfriend", "partner", "family"];
const RESERVED = ["admin", "administrator", "root", "support", "help", "onym", "api", "app", "www", "mod", "moderator", "system", "settings", "search", "feed", "acak", "random", "profile", "about", "login", "logout", "register", "notifications", "official", "relations", "media"];

// ------------------------------------------------------------------ Validasi (salinan packages/shared)
const ok = (value) => ({ ok: true, value });
const bad = (code) => ({ ok: false, code });
const len = (s) => [...s].length;
function checkUsername(raw) {
  if (typeof raw !== "string") return bad("username_invalid");
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  if (u.length < LIMITS.usernameMin || u.length > LIMITS.usernameMax) return bad("username_length");
  if (!/^[a-z0-9][a-z0-9._]*$/.test(u) || u.includes("..") || u.endsWith(".")) return bad("username_invalid");
  if (RESERVED.includes(u)) return bad("username_reserved");
  return ok(u);
}
function checkDisplayName(raw) {
  if (typeof raw !== "string") return bad("display_name_invalid");
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length < 1 || len(v) > LIMITS.displayNameMax) return bad("display_name_length");
  if (/[\u0000-\u001f\u007f]/.test(v)) return bad("display_name_invalid");
  return ok(v);
}
function checkBio(raw) {
  if (raw == null) return ok("");
  if (typeof raw !== "string") return bad("bio_invalid");
  const v = raw.replace(/\r\n/g, "\n").trim();
  if (len(v) > LIMITS.bioMax) return bad("bio_length");
  return ok(v);
}
function checkPostBody(raw) {
  if (raw == null) return ok("");
  if (typeof raw !== "string") return bad("post_invalid");
  const v = raw.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (len(v) > LIMITS.postMax) return bad("post_length");
  return ok(v);
}
const checkAnonVis = (raw) => (typeof raw === "string" && ANON_VIS.includes(raw) ? ok(raw) : bad("visibility_invalid"));
const checkVisibility = (raw) => (typeof raw === "string" && VISIBILITIES.includes(raw) ? ok(raw) : bad("visibility_invalid"));
const checkRelationKind = (raw) => (typeof raw === "string" && RELATION_KINDS.includes(raw) ? ok(raw) : bad("relation_kind_invalid"));
function checkPassword(raw, username) {
  if (typeof raw !== "string") return bad("password_invalid");
  if (raw.length < LIMITS.passwordMin) return bad("password_short");
  if (raw.length > LIMITS.passwordMax) return bad("password_long");
  if (username && raw.toLowerCase() === username.toLowerCase()) return bad("password_same_as_username");
  return ok(raw);
}
function parseCalendarDate(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
function ageOn(b, today) {
  let age = today.getUTCFullYear() - b.y;
  if (today.getUTCMonth() + 1 < b.m || (today.getUTCMonth() + 1 === b.m && today.getUTCDate() < b.d)) age -= 1;
  return age;
}
function checkBirthDate(raw) {
  const p = parseCalendarDate(raw);
  if (!p || p.y < 1900) return bad("birth_date_invalid");
  const age = ageOn(p, new Date());
  if (age < 0) return bad("birth_date_future");
  if (age < LIMITS.minAge) return bad("underage");
  if (age > 120) return bad("birth_date_invalid");
  return ok(raw);
}
function checkComment(raw) {
  if (typeof raw !== "string") return bad("comment_invalid");
  const v = raw.replace(/\r\n/g, "\n").trim();
  if (!v) return bad("comment_empty");
  if (len(v) > LIMITS.commentMax) return bad("comment_length");
  const stripped = v.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}‍️︎⃣\u{1F3FB}-\u{1F3FF}\s]/gu, "");
  if (!/[\p{L}\p{N}]/u.test(stripped)) return bad("comment_emoji_only");
  return ok(v);
}
const checkStars = (raw) => (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5 ? ok(raw) : bad("stars_invalid"));

// ------------------------------------------------------------------ Util
const fail = (status, code) => { throw new ApiError(code, status); };
let lastMs = 0, seq = 0;
function deviceId() {
  try { let id = localStorage.getItem("hh_device"); if (!id) { id = newId(); localStorage.setItem("hh_device", id); } return id; } catch { return "tanpa-penyimpanan"; }
}
function newId() {
  const now = Date.now();
  if (now > lastMs) { lastMs = now; seq = 0; } else seq++;
  const hex = (n, w) => n.toString(16).padStart(w, "0");
  const rnd = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => hex(b, 2)).join("");
  return hex(lastMs, 12) + hex(seq, 4) + rnd;
}
function randomInt(n) {
  const limit = Math.floor(2 ** 32 / n) * n, buf = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(buf); if (buf[0] < limit) return buf[0] % n; }
}
const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const encodeCursor = (ts, id) => `${ts}_${id}`;
function decodeCursor(raw) {
  if (!raw) return null;
  const m = /^(\d{1,16})_([A-Za-z0-9]{1,64})$/.exec(raw);
  if (!m) fail(400, "bad_cursor");
  return { ts: Number(m[1]), id: m[2] };
}
const newerFirst = (a, b) => (b.createdAt - a.createdAt) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);
const beforeCursor = (cur) => (x) => !cur || x.createdAt < cur.ts || (x.createdAt === cur.ts && x.id < cur.id);

// ------------------------------------------------------------------ Kata sandi (PBKDF2 bila tersedia, cadangan hash sederhana)
const enc = new TextEncoder();
const b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pw, salt, iter) {
  if (crypto.subtle) {
    const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
  }
  // Tanpa Web Crypto (konteks tidak aman/http) kata sandi TIDAK boleh di-hash dengan cadangan lemah: tolak.
  throw new ApiError("insecure_context", 500);
}
async function hashPassword(pw) { const salt = crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2-sha256$100000$${b64(salt)}$${b64(await derive(pw.normalize("NFKC"), salt, 100000))}`; }
async function verifyPassword(pw, stored) {
  const [scheme, iter, s, h] = String(stored).split("$");
  if (scheme !== "pbkdf2-sha256") return false;
  const got = await derive(pw.normalize("NFKC"), unb64(s), Number(iter)), want = unb64(h);
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got[i] ^ want[i];
  return d === 0;
}
async function sha256Hex(str) {
  if (crypto.subtle) return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(str)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  throw new ApiError("insecure_context", 500);
}
let dummy = null;
const DUMMY_HASH = () => (dummy ??= hashPassword("dummy-password-for-timing"));
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newRecoveryCode() { let r = ""; for (let i = 0; i < 12; i++) r += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]; return `${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8, 12)}`; }
const normalizeCode = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// ------------------------------------------------------------------ Penyimpanan
const EMPTY = () => ({ users: [], recovery: [], posts: [], media: [], follows: [], relations: [], ratings: [], postLikes: [], saves: [], comments: [], commentLikes: [], notifs: [], views: {}, reports: [] });
let cache = null, rawSeen = null;
function db() {
  if (cache) return cache;
  const raw = localStorage.getItem(DB_KEY);
  try { cache = { ...EMPTY(), ...JSON.parse(raw || "{}") }; } catch { cache = EMPTY(); }
  rawSeen = raw;
  return cache;
}
/** Awal tiap permintaan: bila tab/jendela lain sudah mengubah DB, buang cache usang (mencegah data hilang saat menimpa). */
function syncCache() {
  if (cache && localStorage.getItem(DB_KEY) === rawSeen) return;
  cache = null; rawSeen = null;
}
function commit() {
  try { const s = JSON.stringify(cache); localStorage.setItem(DB_KEY, s); rawSeen = s; }
  catch { cache = null; rawSeen = null; fail(413, "post_too_large"); } // kuota localStorage penuh
}

// ------------------------------------------------------------------ Pembatas laju (setara apps/api; di mode lokal hanya penahan kecerobohan, bukan keamanan sungguhan)
const RL_KEY = "hh_local_rl";
function rlRead() { try { return JSON.parse(localStorage.getItem(RL_KEY) || "{}") || {}; } catch { return {}; } }
function rlWrite(rl) { try { localStorage.setItem(RL_KEY, JSON.stringify(rl)); } catch { /* kuota penuh: abaikan */ } }
function rateLimit(key, max, windowMs) {
  const rl = rlRead(), now = Date.now(), e = rl[key];
  for (const k of Object.keys(rl)) if (now - rl[k].t > 24 * 3600_000) delete rl[k];
  if (!e || now - e.t >= windowMs) rl[key] = { t: now, n: 1 };
  else if (e.n >= max) { rlWrite(rl); fail(429, "rate_limited"); }
  else e.n++;
  rlWrite(rl);
}
function clearRateLimit(key) { const rl = rlRead(); if (key in rl) { delete rl[key]; rlWrite(rl); } }
// ---- Penyimpanan media (IndexedDB). Bentuk data (DTO) dibangun sinkron, jadi blob: URL disimpan di urlCache dan dimuat sebelum tiap permintaan (hydrate).
const IDB_NAME = "hulhup_media", IDB_STORE = "blobs";
let idbPromise = null;
function idb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("no_idb"));
    const rq = indexedDB.open(IDB_NAME, 1);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(IDB_STORE)) rq.result.createObjectStore(IDB_STORE); };
    rq.onsuccess = () => { const database = rq.result; database.onversionchange = () => { database.close(); idbPromise = null; }; res(database); };
    rq.onerror = () => rej(rq.error || new Error("idb"));
    rq.onblocked = () => rej(new Error("idb_blocked"));
  }).catch((e) => { idbPromise = null; throw e; });
  return idbPromise;
}
async function idbTx(mode, fn) {
  const database = await idb();
  return new Promise((res, rej) => {
    const tx = database.transaction(IDB_STORE, mode);
    let out;
    const rq = fn(tx.objectStore(IDB_STORE));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("abort"));
  });
}
const urlCache = new Map(); // kunci → blob: URL ("" = tidak ada berkasnya)
async function putBlob(key, blob) {
  // Urutan percobaan: Blob utuh → salinan ArrayBuffer (sebagian peramban/WebView gagal menyimpan Blob/File di IndexedDB) → hanya memori (sesi ini).
  const quota = (e) => e?.name === "QuotaExceededError";
  try { await idbTx("readwrite", (st) => st.put(blob, key)); }
  catch (e1) {
    if (quota(e1)) fail(413, "storage_full");
    try { const buf = await blob.arrayBuffer(); await idbTx("readwrite", (st) => st.put({ __buf: buf, type: blob.type }, key)); }
    catch (e2) {
      if (quota(e2)) fail(413, "storage_full");
      console.warn("Onym: IndexedDB tidak bisa dipakai, media hanya disimpan di memori sesi ini", e2); // tetap berhasil diposting; hilang saat muat ulang
    }
  }
  const old = urlCache.get(key); if (old) URL.revokeObjectURL(old);
  urlCache.set(key, URL.createObjectURL(blob));
}
const blobUrl = (key) => urlCache.get(key) || null;
function delBlob(key) {
  const u = urlCache.get(key); if (u) URL.revokeObjectURL(u);
  urlCache.delete(key);
  idbTx("readwrite", (st) => st.delete(key)).catch(() => { /* abaikan */ });
  try { localStorage.removeItem(key); } catch { /* abaikan */ } // sisa format lama
}
function dataUrlToBlob(u) {
  if (typeof u !== "string" || !u.startsWith("data:")) return null;
  const comma = u.indexOf(","); if (comma < 0) return null;
  const head = u.slice(5, comma), isB64 = /;base64$/i.test(head), type = head.replace(/;base64$/i, "") || "application/octet-stream";
  const bin = isB64 ? atob(u.slice(comma + 1)) : decodeURIComponent(u.slice(comma + 1));
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
/** Muat blob: URL semua media yang dipakai DB. Berkas format lama (data URL di localStorage) dipindahkan ke IndexedDB di sini.
 *  Cepat: SATU transaksi IndexedDB untuk semua kunci (dulu satu transaksi per berkas), dan permintaan paralel menunggu satu pekerjaan yang sama
 *  (dulu tiap permintaan memuat ulang & membocorkan blob: URL ganda). */
let hydrating = null;
const missingKeys = () => {
  const d = db();
  return [
    ...d.users.filter((u) => u.avatarVersion > 0).map((u) => AVATAR_PREFIX + u.id),
    ...d.users.filter((u) => u.avatarVersion > 0).map((u) => AVATAR_SRC_PREFIX + u.id),
    ...d.media.map((m) => MEDIA_PREFIX + m.id),
    ...d.comments.flatMap((c) => cmMedia(c).map((m) => m.key)),
  ].filter((k) => !urlCache.has(k));
};
async function hydrateBatch(keys) {
  let database; try { database = await idb(); } catch { return; }
  const got = new Map();
  try {
    await new Promise((res) => {
      const tx = database.transaction(IDB_STORE, "readonly"), st = tx.objectStore(IDB_STORE);
      for (const k of keys) { const rq = st.get(k); rq.onsuccess = () => got.set(k, rq.result || null); rq.onerror = () => got.set(k, null); }
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    });
  } catch { /* lanjut: kunci yang tak terbaca dianggap kosong dan dicoba lagi di bawah */ }
  for (const k of keys) {
    let blob = got.get(k) ?? null;
    if (blob && blob.__buf) blob = new Blob([blob.__buf], { type: blob.type || "application/octet-stream" });
    if (!blob) { // format lama?
      try {
        const legacy = localStorage.getItem(k), b = legacy ? dataUrlToBlob(legacy) : null;
        if (b) { await idbTx("readwrite", (st) => st.put(b, k)); localStorage.removeItem(k); blob = b; }
      } catch { /* biarkan; dicoba lagi lain kali */ }
    }
    if (!urlCache.has(k)) urlCache.set(k, blob ? URL.createObjectURL(blob) : "");
  }
}
async function hydrate() {
  for (let guard = 0; guard < 4; guard++) {
    if (hydrating) { try { await hydrating; } catch { /* abaikan */ } }
    const keys = missingKeys();
    if (!keys.length) return;
    if (hydrating) continue; // pekerjaan lain baru dimulai saat kita menunggu; tunggu lagi
    hydrating = hydrateBatch(keys).finally(() => { hydrating = null; });
    await hydrating;
  }
}

// ------------------------------------------------------------------ Sesi
function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function auth() {
  const s = readSession();
  if (!s) return null;
  if (!s.createdAt || Date.now() - s.createdAt > SESSION_TTL_MS) { try { localStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ } return null; }
  const user = db().users.find((u) => u.id === s.userId);
  if (!user) { try { localStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ } return null; }
  return { user, session: s };
}
const SESSION_TTL_MS = 90 * 24 * 3600_000;
const requireAuth = () => auth() ?? fail(401, "unauthorized");
function startSession(user) {
  const s = { id: newId(), userId: user.id, createdAt: Date.now(), lastSeenAt: Date.now(), device: (navigator.userAgent || "Peramban").slice(0, 80) };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { fail(500, "internal"); }
  return s;
}
const endSession = () => { try { localStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ } };

// ------------------------------------------------------------------ Bentuk data
const avatarUrl = (u) => (u.avatarVersion > 0 ? blobUrl(AVATAR_PREFIX + u.id) : null);
const ANON_AUTHOR = { id: "", username: "", displayName: "Anonim", avatarUrl: null };
const toSummary = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: avatarUrl(u) });
const userById = (id) => db().users.find((u) => u.id === id);
function toMe(u) {
  const d = db();
  return {
    ...toSummary(u), avatarSourceUrl: u.avatarVersion > 0 ? blobUrl(AVATAR_SRC_PREFIX + u.id) : null, bio: u.bio, birthDate: u.birthDate, birthDatePublic: !!u.birthDatePublic,
    defaultVisibility: u.defaultVisibility, anonVisibility: u.anonVisibility || "me", commentWho: u.commentWho || "public", relationWho: u.relationWho || "public", hideLikes: !!u.hideLikes, hideViews: !!u.hideViews, defaultAnon: !!u.defaultAnon, defaultInRandom: !!u.defaultInRandom, lang: u.lang, theme: u.theme,
    notifFollow: !!u.notifFollow, notifComment: !!u.notifComment, notifReply: !!u.notifReply, notifRelation: !!u.notifRelation,
    unreadNotifications: d.notifs.filter((n) => n.userId === u.id && n.readAt == null).length,
    pendingRelationRequests: d.relations.filter((r) => r.targetId === u.id && r.status === "pending").length,
  };
}
const relBetween = (a, b) => db().relations.find((r) => r.pairKey === pairKey(a, b)) ?? null;
const isFollowing = (follower, followee) => db().follows.some((f) => f.followerId === follower && f.followeeId === followee);
/** Aturan "siapa" (public/followers/following/mutual/relationship/friend/…/me) terhadap pemilik `ownerId`. Pemilik selalu lolos. */
function ruleAllows(rule, ownerId, viewer) {
  if (rule === "public" || (viewer && ownerId === viewer)) return true;
  if (!viewer || rule === "me") return false;
  if (rule === "followers") return isFollowing(viewer, ownerId);
  if (rule === "following") return isFollowing(ownerId, viewer); // orang yang diikuti pemilik
  if (rule === "mutual") return isFollowing(viewer, ownerId) && isFollowing(ownerId, viewer);
  const r = relBetween(viewer, ownerId);
  if (!r || r.status !== "accepted") return false;
  return rule === "relationship" || r.kind === rule;
}
const canSee = (p, viewer) => ruleAllows(p.visibility, p.ownerId, viewer);
/** Bagian "Anonym" di profil `t` terlihat oleh `viewer`? Pemilik selalu bisa. */
function canSeeAnon(t, viewer) {
  if (viewer && viewer === t.id) return true;
  const v = t.anonVisibility || "me";
  if (v === "me" || !viewer) return v === "everyone";
  if (v === "everyone") return true;
  if (v === "followers") return isFollowing(viewer, t.id);
  if (v === "following") return isFollowing(t.id, viewer);
  if (v === "mutual") return isFollowing(viewer, t.id) && isFollowing(t.id, viewer);
  const r = relBetween(viewer, t.id);
  if (!r || r.status !== "accepted") return false;
  return v === "relations" || r.kind === v;
}
function toPostDTO(p, viewer) {
  const d = db(), owner = userById(p.ownerId);
  const likes = (d.postLikes || []).filter((l) => l.postId === p.id);
  return {
    id: p.id, author: p.anon ? ANON_AUTHOR : toSummary(owner), anon: !!p.anon, hideLikes: viewer !== p.ownerId && !!owner.hideLikes, hideViews: viewer !== p.ownerId && !!owner.hideViews, body: p.body, visibility: p.visibility, createdAt: p.createdAt,
    media: d.media.filter((m) => m.postId === p.id).sort((a, b) => a.position - b.position).map((m) => ({
      id: m.id, kind: m.kind, mime: m.mime, durationMs: m.durationMs, width: m.width, height: m.height, url: blobUrl(MEDIA_PREFIX + m.id) || "", backsound: m.kind === "audio" && !!m.backsound,
      inRandom: viewer === p.ownerId ? mediaInRandom(m, p) : null,
    })),
    viewCount: p.viewCount,
    likeCount: likes.length, liked: !!viewer && likes.some((l) => l.userId === viewer),
    commentCount: d.comments.filter((c) => c.postId === p.id).length,
    saved: !!viewer && d.saves.some((s) => s.userId === viewer && s.postId === p.id),
    mine: viewer === p.ownerId,
    inRandom: viewer === p.ownerId ? d.media.some((m) => m.postId === p.id && mediaInRandom(m, p)) : null,
  };
}
/** Acak dipilih PER MEDIA. Data lama (tanpa penanda per media) mengikuti penanda lama milik post. */
const mediaInRandom = (m, p) => (typeof m.inRandom === "boolean" ? m.inRandom : !!p.inRandom);
const visiblePosts = (viewer) => db().posts.filter((p) => canSee(p, viewer));
function pageOf(rows, viewer, tsOf = (x) => x.createdAt) {
  const slice = rows.slice(0, LIMITS.pageSize), last = rows[LIMITS.pageSize - 1];
  return { items: slice.map((p) => toPostDTO(p, viewer)), nextCursor: rows.length > LIMITS.pageSize && last ? encodeCursor(tsOf(last), last.id) : null };
}
function getPost(viewer, id) { const p = db().posts.find((x) => x.id === id); return p && canSee(p, viewer) ? p : null; }

function notify({ to, type, actor, postId = null, commentId = null, kind = null }) {
  if (to === actor.id) return;
  const rcpt = userById(to);
  if (!rcpt) return;
  const enabled = type === "follow" ? rcpt.notifFollow : (type === "comment" || type === "comment_like" || type === "post_like") ? rcpt.notifComment : type === "reply" ? rcpt.notifReply : rcpt.notifRelation;
  if (!enabled) return;
  db().notifs.push({ id: newId(), userId: to, type, actorId: actor.id, postId, commentId, kind, createdAt: Date.now(), readAt: null });
}
function removeUserData(id) {
  const d = db();
  for (const m of d.media.filter((m) => d.posts.some((p) => p.id === m.postId && p.ownerId === id))) delBlob(MEDIA_PREFIX + m.id);
  delBlob(AVATAR_PREFIX + id); delBlob(AVATAR_SRC_PREFIX + id);
  const myPosts = new Set(d.posts.filter((p) => p.ownerId === id).map((p) => p.id));
  const myComments = new Set(d.comments.filter((c) => c.userId === id || myPosts.has(c.postId)).map((c) => c.id));
  d.users = d.users.filter((u) => u.id !== id);
  d.recovery = d.recovery.filter((r) => r.userId !== id);
  d.media = d.media.filter((m) => !myPosts.has(m.postId));
  d.posts = d.posts.filter((p) => p.ownerId !== id);
  d.follows = d.follows.filter((f) => f.followerId !== id && f.followeeId !== id);
  d.relations = d.relations.filter((r) => r.requesterId !== id && r.targetId !== id);
  d.ratings = d.ratings.filter((r) => r.userId !== id && !myPosts.has(r.postId));
  d.postLikes = (d.postLikes || []).filter((l) => l.userId !== id && !myPosts.has(l.postId));
  d.saves = d.saves.filter((s) => s.userId !== id && !myPosts.has(s.postId));
  dropComments(withDescendants(myComments));
  d.commentLikes = (d.commentLikes || []).filter((l) => l.userId !== id);
  d.notifs = d.notifs.filter((n) => n.userId !== id && n.actorId !== id && !myPosts.has(n.postId));
}
function makeRecoveryCodes(userId) {
  const codes = Array.from({ length: 8 }, newRecoveryCode);
  return Promise.all(codes.map((c) => sha256Hex(normalizeCode(c)))).then((hashes) => {
    const d = db();
    d.recovery = d.recovery.filter((r) => r.userId !== userId);
    hashes.forEach((h) => d.recovery.push({ id: newId(), userId, codeHash: h, usedAt: null }));
    return codes;
  });
}
const cleanUname = (v) => (typeof v === "string" ? v.trim().replace(/^@/, "").toLowerCase() : "");
function findUser(username) {
  const u = checkUsername(username);
  return (u.ok && db().users.find((x) => x.username === u.value)) || fail(404, "not_found");
}
const bodyOf = (o) => (o && typeof o === "object" ? o : {});

// ------------------------------------------------------------------ Rute
const routes = [];
const add = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

add("GET", "/api/config", () => ({
  maxVideoMs: LIMITS.maxVideoMs, maxAudioMs: LIMITS.maxAudioMs, maxAudioBytes: LIMITS.maxAudioBytes, maxPhotos: LIMITS.maxPhotos, maxVideoBytes: LIMITS.maxVideoBytes, maxPhotoBytes: LIMITS.maxPhotoBytes,
  maxRequestBytes: LIMITS.maxRequestBytes, maxAvatarBytes: LIMITS.maxAvatarBytes, postMax: LIMITS.postMax, commentMax: LIMITS.commentMax,
  minAge: LIMITS.minAge, relationKinds: RELATION_KINDS,
}));

// ---- Autentikasi
add("GET", "/api/username-available", (c) => {
  const u = checkUsername(c.query.get("u"));
  if (!u.ok) return { available: false, code: u.code };
  return { available: !db().users.some((x) => x.username === u.value) };
});
add("POST", "/api/auth/register", async (c) => {
  rateLimit("reg", 10, 3600_000);
  const b = bodyOf(c.body);
  const name = checkDisplayName(b.displayName); if (!name.ok) fail(400, name.code);
  const uname = checkUsername(b.username); if (!uname.ok) fail(400, uname.code);
  const pw = checkPassword(b.password, uname.value); if (!pw.ok) fail(400, pw.code);
  const birth = checkBirthDate(b.birthDate); if (!birth.ok) fail(birth.code === "underage" ? 403 : 400, birth.code);
  if (db().users.some((x) => x.username === uname.value)) fail(409, "username_taken");
  const user = {
    id: newId(), username: uname.value, displayName: name.value, passwordHash: await hashPassword(pw.value), birthDate: birth.value,
    bio: "", birthDatePublic: false, defaultVisibility: "public", anonVisibility: "me", defaultInRandom: true, lang: "id", theme: "light",
    notifFollow: true, notifComment: true, notifReply: true, notifRelation: true, avatarVersion: 0, createdAt: Date.now(),
  };
  db().users.push(user);
  const recoveryCodes = await makeRecoveryCodes(user.id);
  commit();
  const s = startSession(user);
  return { token: s.id, me: toMe(user), recoveryCodes };
});
add("POST", "/api/auth/login", async (c) => {
  const b = bodyOf(c.body);
  const uname = cleanUname(b.username), password = typeof b.password === "string" ? b.password : "";
  if (!uname || !password || uname.length > 64 || password.length > 256) fail(400, "bad_credentials");
  rateLimit(`login-u:${uname}`, 10, 15 * 60_000);
  const user = db().users.find((u) => u.username === uname);
  // Selalu hitung hash (kata sandi tiruan bila pengguna tak ada) agar waktu respons tidak membocorkan keberadaan akun.
  const valid = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH()));
  if (!user || !valid) fail(401, "bad_credentials");
  clearRateLimit(`login-u:${uname}`);
  const s = startSession(user);
  return { token: s.id, me: toMe(user) };
});
add("POST", "/api/auth/logout", () => { requireAuth(); endSession(); return { ok: true }; });
add("POST", "/api/auth/recover", async (c) => {
  const b = bodyOf(c.body);
  const uname = cleanUname(b.username), code = typeof b.recoveryCode === "string" ? normalizeCode(b.recoveryCode) : "";
  if (!uname || code.length !== 12) fail(400, "bad_recovery");
  rateLimit(`recover-u:${uname}`, 5, 3600_000);
  const pw = checkPassword(b.newPassword, uname); if (!pw.ok) fail(400, pw.code);
  const user = db().users.find((u) => u.username === uname);
  const hash = await sha256Hex(code);
  const row = user && db().recovery.find((r) => r.userId === user.id && r.codeHash === hash && r.usedAt == null);
  if (!user || !row) fail(400, "bad_recovery");
  row.usedAt = Date.now();
  user.passwordHash = await hashPassword(pw.value);
  const s = readSession(); if (s && s.userId === user.id) endSession();
  commit();
  return { ok: true, remainingCodes: db().recovery.filter((r) => r.userId === user.id && r.usedAt == null).length };
});
add("GET", "/api/session", () => { const a = auth(); return { me: a ? toMe(a.user) : null }; });
add("GET", "/api/me", () => ({ me: toMe(requireAuth().user) }));
add("PATCH", "/api/me", (c) => {
  const u = requireAuth().user, b = bodyOf(c.body), patch = {};
  if ("displayName" in b) { const v = checkDisplayName(b.displayName); if (!v.ok) fail(400, v.code); patch.displayName = v.value; }
  if ("bio" in b) { const v = checkBio(b.bio); if (!v.ok) fail(400, v.code); patch.bio = v.value; }
  if ("username" in b) {
    const v = checkUsername(b.username); if (!v.ok) fail(400, v.code);
    if (v.value !== u.username) { if (db().users.some((x) => x.username === v.value && x.id !== u.id)) fail(409, "username_taken"); patch.username = v.value; }
  }
  if ("birthDate" in b) { const v = checkBirthDate(b.birthDate); if (!v.ok) fail(v.code === "underage" ? 403 : 400, v.code); patch.birthDate = v.value; }
  if ("birthDatePublic" in b) patch.birthDatePublic = b.birthDatePublic === true;
  if ("defaultVisibility" in b) { const v = checkVisibility(b.defaultVisibility); if (!v.ok) fail(400, v.code); patch.defaultVisibility = v.value; }
  if ("commentWho" in b) { const v = checkVisibility(b.commentWho); if (!v.ok) fail(400, v.code); patch.commentWho = v.value; }
  if ("relationWho" in b) { if (!["public", "followers", "following", "mutual", "me"].includes(b.relationWho)) fail(400, "visibility_invalid"); patch.relationWho = b.relationWho; }
  for (const k of ["hideLikes", "hideViews", "defaultAnon"]) if (k in b) patch[k] = b[k] === true;
  if ("anonVisibility" in b) { const v = checkAnonVis(b.anonVisibility); if (!v.ok) fail(400, v.code); patch.anonVisibility = v.value; }
  if ("defaultInRandom" in b) patch.defaultInRandom = b.defaultInRandom === true;
  if ("lang" in b) { if (!["id", "en"].includes(b.lang)) fail(400, "lang_invalid"); patch.lang = b.lang; }
  if ("theme" in b) { if (!["light", "dark"].includes(b.theme)) fail(400, "theme_invalid"); patch.theme = b.theme; }
  for (const k of ["notifFollow", "notifComment", "notifReply", "notifRelation"]) if (k in b) patch[k] = b[k] === true;
  Object.assign(u, patch); commit();
  return { me: toMe(u) };
});
add("POST", "/api/me/password", async (c) => {
  const a = requireAuth(), b = bodyOf(c.body);
  if (typeof b.currentPassword !== "string" || !(await verifyPassword(b.currentPassword, a.user.passwordHash))) fail(403, "wrong_password");
  const pw = checkPassword(b.newPassword, a.user.username); if (!pw.ok) fail(400, pw.code);
  a.user.passwordHash = await hashPassword(pw.value); commit();
  return { ok: true };
});
add("POST", "/api/me/recovery-codes", async (c) => {
  const a = requireAuth(), b = bodyOf(c.body);
  if (typeof b.password !== "string" || !(await verifyPassword(b.password, a.user.passwordHash))) fail(403, "wrong_password");
  const recoveryCodes = await makeRecoveryCodes(a.user.id); commit();
  return { recoveryCodes };
});
add("GET", "/api/sessions", () => {
  const a = requireAuth();
  return { items: [{ id: a.session.id, device: a.session.device, createdAt: a.session.createdAt, lastSeenAt: Date.now(), current: true }] };
});
add("DELETE", "/api/sessions/:id", () => { requireAuth(); return { ok: true }; });
add("POST", "/api/sessions/revoke-others", () => { requireAuth(); return { ok: true }; });
add("DELETE", "/api/me", async (c) => {
  const a = requireAuth(), b = bodyOf(c.body);
  if (typeof b.password !== "string" || !(await verifyPassword(b.password, a.user.passwordHash))) fail(403, "wrong_password");
  removeUserData(a.user.id); endSession(); commit();
  return { ok: true };
});

// ---- Avatar
add("PUT", "/api/me/avatar", async (c) => {
  const a = requireAuth();
  const blob = c.raw;
  if (!blob || blob.size > LIMITS.maxAvatarBytes) fail(413, "avatar_too_large");
  if (!/^image\/(jpeg|png|webp)$/.test(blob.type)) fail(415, "avatar_unsupported");
  await putBlob(AVATAR_PREFIX + a.user.id, blob);
  a.user.avatarVersion = Date.now(); commit();
  return { avatarUrl: avatarUrl(a.user), sourceUrl: blobUrl(AVATAR_SRC_PREFIX + a.user.id) };
});
// Foto asli (belum dipotong): dipakai untuk mengatur ulang posisi/zoom dan untuk pratinjau penuh.
add("PUT", "/api/me/avatar/source", async (c) => {
  const a = requireAuth(), blob = c.raw;
  if (!blob || blob.size > LIMITS.maxPhotoBytes) fail(413, "avatar_too_large");
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(blob.type)) fail(415, "avatar_unsupported");
  await putBlob(AVATAR_SRC_PREFIX + a.user.id, blob);
  return { sourceUrl: blobUrl(AVATAR_SRC_PREFIX + a.user.id) };
});
add("DELETE", "/api/me/avatar", () => { const a = requireAuth(); delBlob(AVATAR_PREFIX + a.user.id); delBlob(AVATAR_SRC_PREFIX + a.user.id); a.user.avatarVersion = 0; commit(); return { ok: true }; });

// ---- Feed, Acak
add("GET", "/api/feed", (c) => {
  const viewer = auth()?.user.id ?? null, cur = decodeCursor(c.query.get("cursor"));
  let rows = visiblePosts(viewer);
  if (c.query.get("scope") === "following") {
    if (!viewer) fail(401, "unauthorized");
    const d = db();
    const ok2 = new Set([viewer, ...d.follows.filter((f) => f.followerId === viewer).map((f) => f.followeeId),
      ...d.relations.filter((r) => r.status === "accepted" && (r.requesterId === viewer || r.targetId === viewer)).map((r) => (r.requesterId === viewer ? r.targetId : r.requesterId))]);
    rows = rows.filter((p) => ok2.has(p.ownerId));
  }
  return pageOf(rows.filter(beforeCursor(cur)).sort(newerFirst).slice(0, LIMITS.pageSize + 1), viewer);
});
add("POST", "/api/random", (c) => {
  // Acak sungguhan: SATU media (foto/video/suara) dari seluruh media yang diizinkan pemiliknya, peluang sama rata.
  const viewer = auth()?.user.id ?? null, d = db();
  const exclude = String(bodyOf(c.body).exclude || "");
  const pool = [];
  for (const p of visiblePosts(viewer)) for (const m of d.media) if (m.postId === p.id && mediaInRandom(m, p)) pool.push({ p, m });
  if (!pool.length) fail(404, "no_media");
  const fresh = pool.length > 1 ? pool.filter((x) => x.m.id !== exclude) : pool; // jangan langsung mengulang media yang sama
  const { p, m } = fresh[randomInt(fresh.length)];
  const dto = toPostDTO(p, viewer);
  dto.media = dto.media.filter((x) => x.id === m.id);
  return { post: dto, item: dto.media[0] ?? null, total: pool.length };
});

// ---- Post
/** Periksa berkas unggahan baru. `have` = jumlah media yang dipertahankan (edit) per jenis. */
async function readMedia(form, have = { photo: 0, audio: 0, video: 0 }) {
  const files = form.getAll("media").filter((x) => typeof x !== "string");
  if (files.length > LIMITS.maxPhotos + 2) fail(400, "too_many_files");
  const hints = String(form.get("durations") ?? "").split(",").map((x) => Math.max(0, Math.min(120_000, Number(x) || 0)));
  const randoms = form.get("randoms") === null ? null : String(form.get("randoms")).split(",").map((x) => x === "1");
  const backs = String(form.get("backsounds") ?? "").split(",").map((x) => x === "1"); // hanya suara yang boleh jadi backsound
  const items = [], n = { ...have };
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; try { await f.slice(0, 16).arrayBuffer(); } catch { fail(422, "media_corrupt"); } // cukup uji terbaca: isi sudah disalin ke memori saat dipilih (attach.js/compose.js); menyalin lagi memboroskan RAM untuk video besar
    const type = String(f.type || "").split(";")[0].toLowerCase();
    if (type.startsWith("image/") && !/^image\/(jpeg|jpg|png|webp|gif|avif|bmp|heic|heif)$/.test(type)) fail(415, "media_unsupported"); // tolak SVG & format aktif lain
    const kind = type.startsWith("image/") ? "photo" : type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : null;
    if (!kind) fail(415, "media_unsupported");
    const item = { file: f, kind, mime: type, durationMs: hints[i] ?? 0, width: 0, height: 0, random: randoms ? !!randoms[i] : null, backsound: kind === "audio" && !!backs[i] };
    if (kind === "photo") {
      if (++n.photo + n.video > LIMITS.maxPhotos) fail(400, "too_many_photos");
      if (f.size > LIMITS.maxPhotoBytes) fail(413, "photo_too_large");
      try { const bmp = await createImageBitmap(f); item.width = bmp.width; item.height = bmp.height; bmp.close?.(); } catch { /* format yang tak bisa didekode peramban: tetap simpan apa adanya */ }
      if (item.width * item.height > LIMITS.maxPhotoPixels) fail(422, "photo_too_big_dims");
      item.durationMs = 0;
    } else if (kind === "audio") {
      if (++n.audio > LIMITS.maxAudios) fail(400, "too_many_audio");
      if (f.size > LIMITS.maxAudioBytes) fail(413, "audio_too_large");
      if (item.durationMs <= 0) item.durationMs = await probeMs(f, "audio");
      if (item.durationMs > LIMITS.maxAudioMs + LIMITS.audioToleranceMs) fail(422, "audio_too_long");
    } else {
      if (n.photo + ++n.video > LIMITS.maxPhotos) fail(400, "too_many_photos");
      if (f.size > LIMITS.maxVideoBytes) fail(413, "video_too_large");
      if (item.durationMs <= 0) item.durationMs = await probeMs(f, "video");
      if (item.durationMs <= 0) fail(422, "media_corrupt");
      { const dm = await probeVideoDims(f); item.width = dm.w; item.height = dm.h; } // ukuran asli → video tampil sesuai aslinya (landscape/portrait), tanpa dipotong
      if (item.durationMs > LIMITS.maxVideoMs + LIMITS.videoToleranceMs) fail(422, "video_too_long");
    }
    items.push(item);
  }
  return items;
}
function probeMs(blob, kind) {
  return new Promise((res) => {
    const el = document.createElement(kind === "video" ? "video" : "audio"), url = URL.createObjectURL(blob);
    const done = (v) => { URL.revokeObjectURL(url); res(v); };
    el.preload = "metadata"; el.onerror = () => done(0);
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0);
    el.src = url; setTimeout(() => done(0), 6000);
  });
}
function probeVideoDims(blob) {
  return new Promise((res) => {
    const el = document.createElement("video"), url = URL.createObjectURL(blob);
    const done = (w, h) => { URL.revokeObjectURL(url); el.removeAttribute("src"); el.load(); res({ w, h }); };
    el.preload = "metadata"; el.muted = true; el.onerror = () => done(0, 0);
    el.onloadedmetadata = () => done(el.videoWidth || 0, el.videoHeight || 0);
    el.src = url; setTimeout(() => done(0, 0), 6000);
  });
}
const MEDIA_ORDER = { video: 0, photo: 0, audio: 1 }; // foto & video tetap berurutan sesuai pilihan pengguna (geser seperti Instagram); suara selalu terakhir
/** Simpan berkas baru ke IndexedDB; mengembalikan baris media. Menghapus yang sudah tertulis bila gagal. */
const oneBacksound = (...lists) => { let seen = false; for (const it of lists.flat()) if (it.backsound) { if (seen) it.backsound = false; seen = true; } }; // maks. satu backsound per post
async function storeMedia(postId, items, written) {
  const rows = [];
  for (const it of items) {
    const mid = newId();
    await putBlob(MEDIA_PREFIX + mid, it.file); written.push(MEDIA_PREFIX + mid);
    rows.push({ id: mid, postId, position: 0, kind: it.kind, mime: it.mime, sizeBytes: it.file.size, durationMs: it.durationMs, width: it.width, height: it.height, inRandom: it.random, backsound: it.kind === "audio" && !!it.backsound });
  }
  return rows;
}
const renumber = (rows) => rows.sort((a, b) => MEDIA_ORDER[a.kind] - MEDIA_ORDER[b.kind]).forEach((m, i) => { m.position = i; });

add("POST", "/api/posts", async (c) => {
  const me = requireAuth().user, form = c.form;
  rateLimit(`post:${me.id}`, 40, 3600_000);
  if (!form) fail(400, "bad_form");
  const body = checkPostBody(form.get("body") ?? ""); if (!body.ok) fail(400, body.code);
  const vis = checkVisibility(form.get("visibility") ?? me.defaultVisibility); if (!vis.ok) fail(400, vis.code);
  const items = await readMedia(form); oneBacksound(items);
  // Acak dipilih per media ("randoms"); tanpa itu, ikuti pilihan bawaan akun.
  const irRaw = form.get("inRandom");
  const globalRandom = irRaw === null ? !!me.defaultInRandom : irRaw === "1" || irRaw === "true";
  items.forEach((it) => { if (it.random === null) it.random = globalRandom; });
  const inRandom = items.some((it) => it.random);
  if (!body.value && !items.length) fail(400, "post_empty");
  items.sort((a, b) => MEDIA_ORDER[a.kind] - MEDIA_ORDER[b.kind]);

  const postId = newId(), written = [], d = db();
  const post = { id: postId, ownerId: me.id, anon: form.get("anon") === "1", body: body.value, visibility: vis.value, inRandom: !!inRandom, hasMedia: items.length > 0, viewCount: 0, createdAt: Date.now() };
  try {
    const rows = await storeMedia(postId, items, written); renumber(rows);
    d.posts.push(post); d.media.push(...rows); commit();
  } catch (e) { written.forEach(delBlob); cache = null; throw e; }
  return { post: toPostDTO(post, me.id) };
});
add("GET", "/api/posts/:id", (c) => {
  const viewer = auth()?.user.id ?? null, p = getPost(viewer, c.params.id);
  if (!p) fail(404, "not_found");
  return { post: toPostDTO(p, viewer) };
});
add("PATCH", "/api/posts/:id", async (c) => {
  const me = requireAuth().user, d = db();
  const p = d.posts.find((x) => x.id === c.params.id && x.ownerId === me.id); if (!p) fail(404, "not_found");
  // Edit penuh (multipart): teks, visibilitas, Acak, media yang dipertahankan (`keep`, berurutan) + media baru.
  if (c.form) {
    const form = c.form;
    const body = checkPostBody(form.get("body") ?? ""); if (!body.ok) fail(400, body.code);
    const vis = checkVisibility(form.get("visibility") ?? p.visibility); if (!vis.ok) fail(400, vis.code);
    const keepIds = String(form.get("keep") ?? "").split(",").filter(Boolean);
    const keepRand = form.get("keepRandom") === null ? null : String(form.get("keepRandom")).split(",").map((x) => x === "1");
    const mine = d.media.filter((m) => m.postId === p.id);
    const keepBs = form.get("keepBacksound") === null ? null : String(form.get("keepBacksound")).split(",").map((x) => x === "1");
    const kept = keepIds.map((id, i) => { const m = mine.find((x) => x.id === id); if (!m) return null; return { ...m, inRandom: keepRand ? !!keepRand[i] : mediaInRandom(m, p), backsound: m.kind === "audio" && (keepBs ? !!keepBs[i] : !!m.backsound) }; }).filter(Boolean);
    const have = { photo: 0, audio: 0, video: 0 }; kept.forEach((m) => { have[m.kind]++; });
    const items = await readMedia(form, have);
    items.forEach((it) => { if (it.random === null) it.random = false; });
    oneBacksound(kept, items);
    if (!body.value && !kept.length && !items.length) fail(400, "post_empty");
    const written = [];
    try {
      const rows = await storeMedia(p.id, items, written);
      // Urutan akhir sesuai "layout" (k:<id> = media lama, n:<i> = media baru); tanpa itu: lama dulu lalu baru.
      const keptBy = new Map(kept.map((m) => [m.id, m]));
      let finalRows = [];
      const layout = String(form.get("layout") ?? "").split(",").filter(Boolean);
      if (layout.length) for (const tok of layout) { const [k, v] = tok.split(":"); const r = k === "k" ? keptBy.get(v) : rows[Number(v)]; if (r && !finalRows.includes(r)) finalRows.push(r); }
      for (const r of [...kept, ...rows]) if (!finalRows.includes(r)) finalRows.push(r);
      renumber(finalRows);
      const dropped = mine.filter((m) => !keptBy.has(m.id));
      d.media = d.media.filter((m) => m.postId !== p.id).concat(finalRows);
      Object.assign(p, { body: body.value, visibility: vis.value, inRandom: finalRows.some((m) => m.inRandom), hasMedia: finalRows.length > 0, editedAt: Date.now() });
      commit();
      dropped.forEach((m) => delBlob(MEDIA_PREFIX + m.id));
    } catch (e) { written.forEach(delBlob); cache = null; throw e; }
    return { post: toPostDTO(db().posts.find((x) => x.id === p.id), me.id) };
  }
  const b = bodyOf(c.body), patch = {};
  if ("visibility" in b) { const v = checkVisibility(b.visibility); if (!v.ok) fail(400, v.code); patch.visibility = v.value; }
  if ("inRandom" in b) { patch.inRandom = b.inRandom === true; d.media.filter((m) => m.postId === p.id).forEach((m) => { m.inRandom = b.inRandom === true; }); } // menu post: ikutkan/keluarkan SEMUA media
  if ("body" in b) {
    const v = checkPostBody(b.body); if (!v.ok) fail(400, v.code);
    if (!v.value && !d.media.some((m) => m.postId === p.id)) fail(400, "post_empty");
    patch.body = v.value;
  }
  Object.assign(p, patch); commit();
  return { post: toPostDTO(p, me.id) };
});
add("DELETE", "/api/posts/:id", (c) => {
  const me = requireAuth().user, d = db();
  const p = d.posts.find((x) => x.id === c.params.id && x.ownerId === me.id); if (!p) fail(404, "not_found");
  d.media.filter((m) => m.postId === p.id).forEach((m) => delBlob(MEDIA_PREFIX + m.id));
  const cids = new Set(d.comments.filter((x) => x.postId === p.id).map((x) => x.id));
  d.posts = d.posts.filter((x) => x.id !== p.id); d.media = d.media.filter((m) => m.postId !== p.id);
  d.ratings = d.ratings.filter((r) => r.postId !== p.id); d.postLikes = (d.postLikes || []).filter((l) => l.postId !== p.id); d.saves = d.saves.filter((s) => s.postId !== p.id);
  dropComments(cids); d.notifs = d.notifs.filter((n) => n.postId !== p.id);
  delete d.views[p.id]; commit();
  return { ok: true };
});
add("POST", "/api/posts/:id/view", (c) => {
  const a = auth(), viewer = a?.user.id ?? null, p = getPost(viewer, c.params.id);
  if (!p) fail(404, "not_found");
  // Aturan: 1 akun = 1 kali dilihat per post, selamanya. Tamu (belum masuk) dihitung per perangkat.
  const d = db(), key = viewer ? `u:${viewer}` : `d:${deviceId()}`;
  const v = (d.views[p.id] ??= {});
  if (v[key]) return { counted: false, viewCount: p.viewCount };
  v[key] = Date.now(); p.viewCount = Object.keys(v).filter((k) => k !== "a:anon").length; commit();
  return { counted: true, viewCount: p.viewCount };
});
function setPostLike(c, want) {
  const me = requireAuth().user, p = getPost(me.id, c.params.id); if (!p) fail(404, "not_found");
  rateLimit(`plike:${me.id}`, 400, 3600_000);
  const d = db(); d.postLikes ||= [];
  const has = d.postLikes.some((l) => l.postId === p.id && l.userId === me.id);
  const same = (n) => n.type === "post_like" && n.postId === p.id && n.actorId === me.id;
  if (want && !has) { d.postLikes.push({ postId: p.id, userId: me.id, createdAt: Date.now() }); notify({ to: p.ownerId, type: "post_like", actor: me, postId: p.id }); }
  if (!want && has) { d.postLikes = d.postLikes.filter((l) => !(l.postId === p.id && l.userId === me.id)); d.notifs = d.notifs.filter((n) => !same(n)); }
  commit();
  return { liked: want, likeCount: d.postLikes.filter((l) => l.postId === p.id).length };
}
add("PUT", "/api/posts/:id/like", (c) => setPostLike(c, true));
add("DELETE", "/api/posts/:id/like", (c) => setPostLike(c, false));
add("PUT", "/api/posts/:id/save", (c) => {
  const me = requireAuth().user, p = getPost(me.id, c.params.id); if (!p) fail(404, "not_found");
  const d = db(); if (!d.saves.some((s) => s.userId === me.id && s.postId === p.id)) d.saves.push({ userId: me.id, postId: p.id, createdAt: Date.now() });
  commit(); return { saved: true };
});
add("DELETE", "/api/posts/:id/save", (c) => {
  const me = requireAuth().user, d = db();
  d.saves = d.saves.filter((s) => !(s.userId === me.id && s.postId === c.params.id)); commit();
  return { saved: false };
});

// ---- Komentar (gaya Threads: balasan bersarang, suka, foto)
/** Media sebuah komentar → [{id,key,kind,mime,durationMs,width,height}]. Komentar lama (satu foto / satu suara) diterjemahkan, berkasnya tidak dipindah. */
function cmMedia(cm) {
  if (cm.media) return cm.media;
  const out = [];
  if (cm.photo) out.push({ id: "lp", key: COMMENT_PREFIX + cm.id, kind: "photo", mime: cm.photo.mime || "image/jpeg", durationMs: 0, width: cm.photo.width || 0, height: cm.photo.height || 0 });
  if (cm.audio) out.push({ id: "la", key: COMMENT_AUDIO_PREFIX + cm.id, kind: "audio", mime: cm.audio.mime || "audio/webm", durationMs: cm.audio.durationMs || 0, width: 0, height: 0 });
  return out;
}
/** Simpan berkas baru komentar ke IndexedDB; menulis kunci ke `written` agar bisa dibatalkan bila gagal. */
async function storeCommentMedia(items, written) {
  const rows = [];
  for (const it of items) {
    const mid = newId(), key = COMMENT_MEDIA_PREFIX + mid;
    await putBlob(key, it.file); written.push(key);
    rows.push({ id: mid, key, kind: it.kind, mime: it.mime, durationMs: it.durationMs, width: it.width, height: it.height });
  }
  return rows;
}
const orderCommentMedia = (rows) => rows.slice().sort((a, b) => MEDIA_ORDER[a.kind] - MEDIA_ORDER[b.kind]); // foto & video berurutan sesuai pilihan; suara terakhir
function toCommentDTO(x, viewer, post) {
  const likes = db().commentLikes || [], rt = x.replyToUserId ? userById(x.replyToUserId) : null, au = userById(x.userId);
  return {
    id: x.id, parentId: x.parentId, body: x.body, createdAt: x.createdAt, editedAt: x.editedAt || null, mine: viewer === x.userId, byOwner: !!post && post.ownerId === x.userId,
    author: au ? toSummary(au) : { id: x.userId, username: "pengguna", displayName: "Pengguna", avatarUrl: null },
    replyTo: rt ? { username: rt.username, displayName: rt.displayName } : null,
    media: cmMedia(x).map((m) => ({ id: m.id, kind: m.kind, mime: m.mime, durationMs: m.durationMs || 0, width: m.width || 0, height: m.height || 0, url: blobUrl(m.key) || "" })),
    likeCount: likes.filter((l) => l.commentId === x.id).length, liked: !!viewer && likes.some((l) => l.commentId === x.id && l.userId === viewer),
  };
}
/** Himpunan id ditambah SEMUA keturunannya (balasan bersarang di segala tingkat). */
function withDescendants(seed) {
  const d = db(), out = new Set(seed);
  for (let grew = true; grew;) { grew = false; for (const c of d.comments) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; } }
  return out;
}
/** Hapus komentar-komentar (foto, suara, suka) dari DB; pemanggil yang meng-commit. */
function dropComments(ids) {
  const d = db();
  for (const c of d.comments) if (ids.has(c.id)) cmMedia(c).forEach((m) => delBlob(m.key));
  d.comments = d.comments.filter((x) => !ids.has(x.id));
  d.commentLikes = (d.commentLikes || []).filter((l) => !ids.has(l.commentId));
  d.notifs = d.notifs.filter((n) => !ids.has(n.commentId));
}
add("GET", "/api/posts/:id/comments", (c) => {
  const viewer = auth()?.user.id ?? null, post = getPost(viewer, c.params.id);
  if (!post) fail(404, "not_found");
  const cur = decodeCursor(c.query.get("cursor")), d = db();
  // Halaman = komentar utama (terbaru dulu) beserta SEMUA balasannya (lama → baru), jadi balasan tak pernah terpisah dari induknya.
  const tops = d.comments.filter((x) => x.postId === post.id && !x.parentId).filter(beforeCursor(cur)).sort(newerFirst).slice(0, LIMITS.pageSize + 1);
  const page = tops.slice(0, LIMITS.pageSize), last = tops[LIMITS.pageSize - 1], ids = withDescendants(new Set(page.map((x) => x.id)));
  const replies = d.comments.filter((x) => x.parentId && ids.has(x.id)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return { items: [...page, ...replies].map((x) => toCommentDTO(x, viewer, post)), nextCursor: tops.length > LIMITS.pageSize && last ? encodeCursor(last.createdAt, last.id) : null };
});
add("POST", "/api/posts/:id/comments", async (c) => {
  const me = requireAuth().user;
  const form = c.form, b = form ? { body: form.get("body") ?? "", parentId: form.get("parentId") || undefined } : bodyOf(c.body);
  // Media komentar = sama seperti post: foto, video (maks. 10 dtk), suara; banyak sekaligus. Validasi memakai pemeriksa yang sama dengan post.
  const items = form ? await readMedia(form) : [];
  let body;
  if (items.length && (typeof b.body !== "string" || !b.body.trim())) body = ok(""); // komentar hanya media
  else { body = checkComment(b.body ?? ""); if (!body.ok) fail(400, body.code); }
  rateLimit(`comment:${me.id}`, 60, 3600_000);
  const post = getPost(me.id, c.params.id); if (!post) fail(404, "not_found");
  if (!ruleAllows(userById(post.ownerId)?.commentWho || "public", post.ownerId, me.id)) fail(403, "comments_restricted");
  let parent = null;
  if (typeof b.parentId === "string" && b.parentId) { parent = db().comments.find((x) => x.id === b.parentId && x.postId === post.id); if (!parent) fail(404, "not_found"); }
  const id = newId(), written = [];
  try {
    const rows = orderCommentMedia(await storeCommentMedia(items, written));
    const d = db(); // diambil SETELAH await: cache bisa saja sudah diganti
    if (parent && !d.comments.some((x) => x.id === parent.id)) fail(404, "not_found"); // induk dihapus saat berkas diunggah
    const parentId = parent ? parent.id : null; // bersarang sungguhan: induknya adalah komentar yang dibalas
    const cm = { id, postId: post.id, userId: me.id, parentId, replyToUserId: parent ? parent.userId : null, body: body.value, createdAt: Date.now() };
    if (rows.length) cm.media = rows;
    d.comments.push(cm);
    if (parent) notify({ to: parent.userId, type: "reply", actor: me, postId: post.id, commentId: cm.id });
    if (!parent || parent.userId !== post.ownerId) notify({ to: post.ownerId, type: "comment", actor: me, postId: post.id, commentId: cm.id });
    commit();
    return { comment: toCommentDTO(cm, me.id, post) };
  } catch (e) { written.forEach(delBlob); cache = null; rawSeen = null; throw e; }
});
function setCommentLike(c, want) {
  const me = requireAuth().user, d = db(), cm = d.comments.find((x) => x.id === c.params.id);
  if (!cm || !getPost(me.id, cm.postId)) fail(404, "not_found");
  rateLimit(`clike:${me.id}`, 400, 3600_000);
  d.commentLikes ||= [];
  const has = d.commentLikes.some((l) => l.commentId === cm.id && l.userId === me.id);
  const same = (n) => n.type === "comment_like" && n.commentId === cm.id && n.actorId === me.id;
  if (want && !has) { d.commentLikes.push({ commentId: cm.id, userId: me.id, createdAt: Date.now() }); notify({ to: cm.userId, type: "comment_like", actor: me, postId: cm.postId, commentId: cm.id }); }
  if (!want && has) { d.commentLikes = d.commentLikes.filter((l) => !(l.commentId === cm.id && l.userId === me.id)); d.notifs = d.notifs.filter((n) => !same(n)); }
  commit();
  return { liked: want, likeCount: d.commentLikes.filter((l) => l.commentId === cm.id).length };
}
add("PUT", "/api/comments/:id/like", (c) => setCommentLike(c, true));
add("DELETE", "/api/comments/:id/like", (c) => setCommentLike(c, false));
add("PATCH", "/api/comments/:id", async (c) => {
  // Hanya pemilik komentar yang boleh mengubah. Multipart: teks + media (yang dipertahankan `keep`, urutan `layout`, dan berkas baru). JSON: hanya teks.
  const me = requireAuth().user;
  const cm0 = db().comments.find((x) => x.id === c.params.id); if (!cm0) fail(404, "not_found");
  if (cm0.userId !== me.id) fail(403, "forbidden");
  rateLimit(`cedit:${me.id}`, 120, 3600_000);
  if (c.form) {
    const form = c.form, mine = cmMedia(cm0);
    const keepIds = String(form.get("keep") ?? "").split(",").filter(Boolean);
    const kept = keepIds.map((id) => mine.find((m) => m.id === id)).filter(Boolean);
    const have = { photo: 0, audio: 0, video: 0 }; kept.forEach((m) => { have[m.kind]++; });
    const items = await readMedia(form, have);
    const rawBody = form.get("body") ?? "";
    let body;
    if ((kept.length || items.length) && (typeof rawBody !== "string" || !rawBody.trim())) body = ok("");
    else { body = checkComment(rawBody); if (!body.ok) fail(400, body.code); }
    const written = [];
    try {
      const rows = await storeCommentMedia(items, written);
      const keptBy = new Map(kept.map((m) => [m.id, m]));
      const finalRows = [];
      for (const tok of String(form.get("layout") ?? "").split(",").filter(Boolean)) { const [k, v] = tok.split(":"); const r = k === "k" ? keptBy.get(v) : rows[Number(v)]; if (r && !finalRows.includes(r)) finalRows.push(r); }
      for (const r of [...kept, ...rows]) if (!finalRows.includes(r)) finalRows.push(r);
      const d = db(), cm = d.comments.find((x) => x.id === cm0.id); if (!cm) fail(404, "not_found");
      const dropped = mine.filter((m) => !keptBy.has(m.id));
      const ordered = orderCommentMedia(finalRows);
      cm.body = body.value; cm.editedAt = Date.now();
      delete cm.photo; delete cm.audio; // format lama dipindah ke daftar media
      if (ordered.length) cm.media = ordered; else delete cm.media;
      commit();
      dropped.forEach((m) => delBlob(m.key));
      return { comment: toCommentDTO(cm, me.id, d.posts.find((p) => p.id === cm.postId)) };
    } catch (e) { written.forEach(delBlob); cache = null; rawSeen = null; throw e; }
  }
  const d = db(), cm = d.comments.find((x) => x.id === c.params.id);
  const raw = bodyOf(c.body).body;
  let body;
  if (cmMedia(cm).length && (typeof raw !== "string" || !raw.trim())) body = ok("");
  else { body = checkComment(raw ?? ""); if (!body.ok) fail(400, body.code); }
  cm.body = body.value; cm.editedAt = Date.now(); commit();
  return { comment: toCommentDTO(cm, me.id, d.posts.find((p) => p.id === cm.postId)) };
});
add("DELETE", "/api/comments/:id", (c) => {
  const me = requireAuth().user, d = db();
  const cm = d.comments.find((x) => x.id === c.params.id); if (!cm) fail(404, "not_found");
  const post = d.posts.find((p) => p.id === cm.postId);
  if (cm.userId !== me.id && post?.ownerId !== me.id) fail(403, "forbidden");
  dropComments(withDescendants(new Set([cm.id]))); commit();
  return { ok: true };
});
add("POST", "/api/reports", (c) => {
  const me = requireAuth().user, b = bodyOf(c.body);
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
  if (!reason) fail(400, "reason_required");
  if (!["post", "comment", "user"].includes(String(b.targetType)) || typeof b.targetId !== "string" || b.targetId.length > 64) fail(400, "bad_request");
  rateLimit(`report:${me.id}`, 20, 3600_000);
  const d = db();
  if (!d.reports.some((r) => r.reporterId === me.id && r.targetType === b.targetType && r.targetId === b.targetId)) {
    d.reports.push({ id: newId(), reporterId: me.id, targetType: b.targetType, targetId: b.targetId, reason, createdAt: Date.now() });
    if (d.reports.length > 500) d.reports.splice(0, d.reports.length - 500);
    commit();
  }
  return { ok: true };
});

// ---- Profil, ikuti, hubungan
add("GET", "/api/users/:username", (c) => {
  const t = findUser(c.params.username), me = auth()?.user.id ?? null, d = db();
  let relation = null;
  if (me && me !== t.id) {
    const rel = relBetween(me, t.id);
    if (rel) relation = { kind: rel.kind, status: rel.status, direction: rel.status === "accepted" ? "mutual" : rel.requesterId === me ? "outgoing" : "incoming" };
  }
  return {
    profile: {
      ...toSummary(t), bio: t.bio, self: me === t.id,
      postCount: visiblePosts(me).filter((p) => p.ownerId === t.id && !p.anon).length,
      anonAccess: canSeeAnon(t, me), anonVisibility: me === t.id ? (t.anonVisibility || "me") : undefined,
      followerCount: d.follows.filter((f) => f.followeeId === t.id).length,
      followingCount: d.follows.filter((f) => f.followerId === t.id).length,
      relationCount: d.relations.filter((r) => r.status === "accepted" && (r.requesterId === t.id || r.targetId === t.id)).length,
      following: !!me && isFollowing(me, t.id), followsMe: !!me && isFollowing(t.id, me), relation,
      birthDate: t.birthDatePublic ? t.birthDate : null, joinedAt: t.createdAt,
    },
  };
});
add("GET", "/api/users/:username/posts", (c) => {
  const viewer = auth()?.user.id ?? null, t = findUser(c.params.username), cur = decodeCursor(c.query.get("cursor"));
  let rows = visiblePosts(viewer).filter((p) => p.ownerId === t.id && !p.anon); // post anonim tidak pernah tampil di tab biasa
  if (c.query.get("media") === "1") rows = rows.filter((p) => p.hasMedia);
  return pageOf(rows.filter(beforeCursor(cur)).sort(newerFirst).slice(0, LIMITS.pageSize + 1), viewer);
});
add("GET", "/api/users/:username/anon", (c) => {
  const viewer = auth()?.user.id ?? null, t = findUser(c.params.username), cur = decodeCursor(c.query.get("cursor"));
  if (!canSeeAnon(t, viewer)) fail(403, "anon_hidden");
  const rows = visiblePosts(viewer).filter((p) => p.ownerId === t.id && p.anon);
  return pageOf(rows.filter(beforeCursor(cur)).sort(newerFirst).slice(0, LIMITS.pageSize + 1), viewer);
});
add("POST", "/api/users/:username/follow", (c) => {
  const me = requireAuth().user, t = findUser(c.params.username);
  if (t.id === me.id) fail(400, "cannot_follow_self");
  if (!isFollowing(me.id, t.id)) { db().follows.push({ followerId: me.id, followeeId: t.id, createdAt: Date.now() }); notify({ to: t.id, type: "follow", actor: me }); commit(); }
  return { following: true };
});
add("DELETE", "/api/users/:username/follow", (c) => {
  const me = requireAuth().user, t = findUser(c.params.username), d = db();
  d.follows = d.follows.filter((f) => !(f.followerId === me.id && f.followeeId === t.id));
  d.notifs = d.notifs.filter((n) => !(n.userId === t.id && n.actorId === me.id && n.type === "follow")); commit();
  return { following: false };
});
for (const [path, mine, other] of [["followers", "followeeId", "followerId"], ["following", "followerId", "followeeId"]]) {
  add("GET", `/api/users/:username/${path}`, (c) => {
    const t = findUser(c.params.username), cur = decodeCursor(c.query.get("cursor"));
    const rows = db().follows.filter((f) => f[mine] === t.id).map((f) => ({ id: f[other], createdAt: f.createdAt }))
      .filter((x) => userById(x.id)).filter(beforeCursor(cur)).sort(newerFirst).slice(0, LIMITS.pageSize + 1);
    const last = rows[LIMITS.pageSize - 1];
    return { items: rows.slice(0, LIMITS.pageSize).map((x) => toSummary(userById(x.id))), nextCursor: rows.length > LIMITS.pageSize && last ? encodeCursor(last.createdAt, last.id) : null };
  });
}
add("GET", "/api/users/:username/relations", (c) => { // hubungan DISETUJUI milik pengguna ini; bisa dilihat siapa saja
  const t = findUser(c.params.username);
  const rows = db().relations.filter((r) => r.status === "accepted" && (r.requesterId === t.id || r.targetId === t.id))
    .sort((a, b) => (b.acceptedAt ?? b.createdAt) - (a.acceptedAt ?? a.createdAt)).slice(0, 500)
    .map((r) => ({ r, u: userById(r.requesterId === t.id ? r.targetId : r.requesterId) })).filter((x) => x.u);
  return { items: rows.map((x) => ({ user: toSummary(x.u), kind: x.r.kind, since: x.r.acceptedAt ?? x.r.createdAt })) };
});
add("GET", "/api/relations", () => {
  const me = requireAuth().user.id;
  const rows = db().relations.filter((r) => r.requesterId === me || r.targetId === me)
    .sort((a, b) => (b.acceptedAt ?? b.createdAt) - (a.acceptedAt ?? a.createdAt)).slice(0, 500)
    .map((r) => ({ r, u: userById(r.requesterId === me ? r.targetId : r.requesterId) })).filter((x) => x.u);
  const pick = (f) => rows.filter(f).map((x) => ({ user: toSummary(x.u), kind: x.r.kind, since: x.r.acceptedAt ?? x.r.createdAt }));
  return { accepted: pick((x) => x.r.status === "accepted"), incoming: pick((x) => x.r.status === "pending" && x.r.requesterId !== me), outgoing: pick((x) => x.r.status === "pending" && x.r.requesterId === me) };
});
add("POST", "/api/relations", (c) => {
  const me = requireAuth().user, b = bodyOf(c.body), d = db();
  const kind = checkRelationKind(b.kind); if (!kind.ok) fail(400, kind.code);
  const t = findUser(String(b.username ?? ""));
  if (t.id === me.id) fail(400, "cannot_relate_self");
  if (!ruleAllows(t.relationWho || "public", t.id, me.id)) fail(403, "relations_restricted");
  const ex = relBetween(me.id, t.id);
  if (ex?.status === "accepted") fail(409, "relation_exists");
  if (ex && ex.requesterId === t.id) fail(409, "relation_pending_incoming");
  if (ex) { ex.kind = kind.value; ex.createdAt = Date.now(); }
  else d.relations.push({ pairKey: pairKey(me.id, t.id), requesterId: me.id, targetId: t.id, kind: kind.value, status: "pending", createdAt: Date.now(), acceptedAt: null });
  d.notifs = d.notifs.filter((n) => !(n.userId === t.id && n.actorId === me.id && n.type === "relation_request"));
  notify({ to: t.id, type: "relation_request", actor: me, kind: kind.value }); commit();
  return { relation: { kind: kind.value, status: "pending", direction: "outgoing" } };
});
add("POST", "/api/relations/:username/accept", (c) => {
  const me = requireAuth().user, t = findUser(c.params.username), d = db();
  const rel = relBetween(me.id, t.id);
  if (!rel || rel.status !== "pending" || rel.targetId !== me.id) fail(404, "not_found");
  rel.status = "accepted"; rel.acceptedAt = Date.now();
  d.notifs = d.notifs.filter((n) => !(n.userId === me.id && n.actorId === t.id && n.type === "relation_request"));
  notify({ to: t.id, type: "relation_accepted", actor: me, kind: rel.kind }); commit();
  return { relation: { kind: rel.kind, status: "accepted", direction: "mutual" } };
});
add("DELETE", "/api/relations/:username", (c) => {
  const me = requireAuth().user, t = findUser(c.params.username), d = db(), key = pairKey(me.id, t.id);
  d.relations = d.relations.filter((r) => r.pairKey !== key);
  d.notifs = d.notifs.filter((n) => !(["relation_request", "relation_accepted"].includes(n.type) && ((n.userId === me.id && n.actorId === t.id) || (n.userId === t.id && n.actorId === me.id)))); commit();
  return { relation: null };
});

// ---- Tersimpan, notifikasi, pencarian
add("GET", "/api/me/saved", (c) => {
  const me = requireAuth().user.id, cur = decodeCursor(c.query.get("cursor")), d = db();
  const rows = d.saves.filter((s) => s.userId === me).map((s) => ({ s, p: d.posts.find((p) => p.id === s.postId) })).filter((x) => x.p && canSee(x.p, me))
    .map((x) => ({ ...x.p, createdAt: x.p.createdAt, savedAt: x.s.createdAt }))
    .filter((x) => !cur || x.savedAt < cur.ts || (x.savedAt === cur.ts && x.id < cur.id))
    .sort((a, b) => (b.savedAt - a.savedAt) || (b.id < a.id ? -1 : 1)).slice(0, LIMITS.pageSize + 1);
  const last = rows[LIMITS.pageSize - 1];
  return { items: rows.slice(0, LIMITS.pageSize).map((p) => toPostDTO(p, me)), nextCursor: rows.length > LIMITS.pageSize && last ? encodeCursor(last.savedAt, last.id) : null };
});
add("GET", "/api/notifications", (c) => {
  const me = requireAuth().user.id, cur = decodeCursor(c.query.get("cursor")), d = db();
  const rows = d.notifs.filter((n) => n.userId === me && userById(n.actorId)).filter(beforeCursor(cur)).sort(newerFirst).slice(0, LIMITS.pageSize + 1);
  const pending = new Set(d.relations.filter((r) => r.targetId === me && r.status === "pending").map((r) => r.requesterId));
  const last = rows[LIMITS.pageSize - 1];
  return {
    items: rows.slice(0, LIMITS.pageSize).map((n) => {
      const cm = n.commentId ? d.comments.find((x) => x.id === n.commentId) : null;
      return { id: n.id, type: n.type, kind: n.kind, createdAt: n.createdAt, read: n.readAt != null, actor: toSummary(userById(n.actorId)), postId: n.postId, commentId: n.commentId,
        commentPreview: cm ? ([...cm.body].slice(0, 80).join("") || (cm.photo ? "📷" : "")) : null, actionable: n.type === "relation_request" && pending.has(n.actorId) };
    }),
    nextCursor: rows.length > LIMITS.pageSize && last ? encodeCursor(last.createdAt, last.id) : null,
  };
});
add("POST", "/api/notifications/read", () => {
  const me = requireAuth().user.id; db().notifs.forEach((n) => { if (n.userId === me && n.readAt == null) n.readAt = Date.now(); }); commit();
  return { ok: true };
});
add("GET", "/api/search", (c) => {
  const viewer = auth()?.user.id ?? null;
  const raw = (c.query.get("q") ?? "").trim().replace(/^@/, "").slice(0, 50).toLowerCase();
  if (raw.length < 2) return { users: [], posts: [] };
  const users = db().users.filter((u) => u.username.includes(raw) || u.displayName.toLowerCase().includes(raw))
    .sort((a, b) => (Number(b.username.startsWith(raw)) - Number(a.username.startsWith(raw))) || (a.username < b.username ? -1 : 1)).slice(0, 15);
  const posts = visiblePosts(viewer).filter((p) => p.body.toLowerCase().includes(raw)).sort(newerFirst).slice(0, 15);
  return { users: users.map(toSummary), posts: posts.map((p) => toPostDTO(p, viewer)) };
});

// ------------------------------------------------------------------ Pintu masuk
/** Jalankan satu permintaan API di peramban. `form` (FormData) / `raw` (Blob) untuk unggahan. */
export async function handle(method, fullPath, { body, form, raw } = {}) {
  const url = new URL(fullPath, "http://local");
  const path = url.pathname.replace(/\/$/, "");
  syncCache();
  try { await hydrate(); } catch (e) { console.warn("hydrate", e); }
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = {};
    try { for (const [k, v] of Object.entries(m.groups ?? {})) params[k] = decodeURIComponent(v); }
    catch { throw new ApiError("bad_request", 400); } // %-encoding rusak
    syncCache();
    try {
      const out = await r.fn({ params, query: url.searchParams, body, form, raw });
      return out === undefined ? { ok: true } : out;
    } catch (e) {
      cache = null; rawSeen = null; // buang perubahan yang belum di-commit (rollback)
      if (e instanceof ApiError) throw e;
      console.error(e);
      throw new ApiError("internal", 500);
    }
  }
  throw new ApiError("not_found", 404);
}
