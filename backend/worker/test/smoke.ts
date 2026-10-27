// Uji lokal Worker Onym (Node 22+): D1 sungguhan (SQLite) + Neon/Supabase/Mongo tiruan. Menguji akun, sesi, JWT, kunci, validasi, media.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

// ---- D1 di atas node:sqlite
class Stmt { db: DatabaseSync; sql: string; args: unknown[]; constructor(db: DatabaseSync, sql: string, args: unknown[] = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a: unknown[]) { return new Stmt(this.db, this.sql, a); }
  async first<T = any>() { return (this.db.prepare(this.sql).get(...(this.args as any[])) as T) ?? null; }
  async all<T = any>() { return { results: this.db.prepare(this.sql).all(...(this.args as any[])) as T[] }; }
  async run() { const r = this.db.prepare(this.sql).run(...(this.args as any[])); return { meta: { changes: Number(r.changes) } }; } }
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("../../d1/0001_edge.sql", import.meta.url), "utf8"));   // sekaligus memvalidasi SQL D1
const DB: any = { prepare: (s: string) => new Stmt(sqlite, s), batch: async (l: Stmt[]) => { sqlite.exec("begin"); try { const o = []; for (const s of l) o.push(await s.run()); sqlite.exec("commit"); return o; } catch (e) { sqlite.exec("rollback"); throw e; } } };

// ---- Neon tiruan
const profiles = new Map<string, { username: string; display: string }>(); const calls: string[] = []; const neonParams: Record<string, any[]> = {};
(globalThis as any).__neon = async (text: string, p: any[]) => {
  const fn = /public\.(\w+)\(/.exec(text)![1]; calls.push(fn); neonParams[fn] = p;
  switch (fn) {
    case "api_create_profile": { if ([...profiles.values()].some((x) => x.username === p[1])) throw new Error("conflict"); profiles.set(p[0], { username: p[1], display: p[2] }); return [{ api_create_profile: null }]; }
    case "api_me": { const x = profiles.get(p[0]); return x ? [{ id: p[0], username: x.username, display_name: x.display }] : []; }
    case "api_create_post": return [{ api_create_post: true }];
    case "api_media_visible": return [{ api_media_visible: [] }];
    case "api_audit": case "api_purge": return [];
    case "api_delete_me": return [{ api_delete_me: [] }];
    default: return [];
  } };

// ---- Supabase/Mongo tiruan
const sent: { u: string; method?: string; headers?: any }[] = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(300).fill(1)]);
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url); sent.push({ u, method: init.method, headers: init.headers });
  if (u.includes("/storage/v1/object/upload/sign/media/")) return new Response(JSON.stringify({ url: "/object/upload/sign/media/x?token=t" }));
  if (u.includes("/storage/v1/object/sign/media")) return new Response(JSON.stringify(JSON.parse(init.body).paths.map((p: string) => ({ path: p, signedURL: `/object/sign/media/${p}?token=z` }))));
  if (u.includes("/storage/v1/object/media/")) { const key = u.split("/object/media/")[1]; if (key.includes("missing")) return new Response("{}", { status: 404 }); const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 1, 1, 1, 1, 1, 1, 1]); const bad = key.includes("bad"); return new Response(bad ? new Uint8Array(16).fill(7) : mp4, { status: 206, headers: { "content-range": `bytes 0-15/${key.includes("short") ? 999 : 2000000}` } }); }
  if (u.includes("op=photo-put")) return new Response(JSON.stringify({ id: "a".repeat(24) }), { status: 201 });
  if (u.includes("op=photo-get")) return new Response(JPEG);
  if (u.includes("op=timeline")) return new Response(JSON.stringify({ ids: [], next: null }));
  return new Response("{}");
}) as any;
const cacheStore = new Map<string, Response>();
(globalThis as any).caches = { default: { match: async (r: Request) => cacheStore.get(r.url)?.clone(), put: async (r: Request, res: Response) => { cacheStore.set(r.url, res.clone()); } } };

const mod = (await import("../src/index.ts")).default; const { signJwt } = await import("../src/crypto.ts");
const rl = { limit: async () => ({ success: true }) };
const env: any = { DB, ASSETS: { fetch: async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }) }, RL_ANON: rl, RL_AUTH: rl, RL_READ: rl, RL_WRITE: rl, RL_UPLOAD: rl,
  AUTH_PEPPER: "pepper-pepper-pepper-pepper-pepper", JWT_SECRET: "jwt-secret-jwt-secret-jwt-secret-32", INTERNAL_SECRET: "internal", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "service", NEON_DATABASE_URL: "x", IP_HASH_SALT: "salt" };
const ctx: any = { waitUntil: (p: Promise<unknown>) => p.catch(() => {}) };
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64"); const rnd = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

async function call(path: string, o: { m?: string; token?: string; body?: unknown; raw?: Uint8Array; ct?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": o.ip ?? "1.1.1.1" }; if (o.token) headers.authorization = "Bearer " + o.token;
  let body: any; if (o.raw) { body = o.raw; headers["content-type"] = o.ct ?? "image/jpeg"; headers["content-length"] = String(o.raw.length); } else if (o.body !== undefined) { body = JSON.stringify(o.body); headers["content-type"] = "application/json"; }
  const r = await mod.fetch(new Request("https://onym.example" + path, { method: o.m ?? (body ? "POST" : "GET"), headers, body }), env, ctx);
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t, h: r.headers };
}
let fails = 0; const ok = (name: string, cond: boolean, extra = "") => { if (!cond) fails++; console.log(cond ? "OK  " : "FAIL", name.padEnd(46), cond ? "" : extra); };
const eq = (name: string, got: unknown, want: unknown) => ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ================= akun
const salt = rnd(16), key = rnd(32), key2 = rnd(32);
eq("salt akun tak ada: 200", (await call("/api/auth/salt", { body: { username: "nobody" } })).s, 200);
const s1 = (await call("/api/auth/salt", { body: { username: "nobody" } })).j.salt, s2 = (await call("/api/auth/salt", { body: { username: "nobody" } })).j.salt;
eq("salt palsu deterministik", s1, s2);
eq("username jelek → 422", (await call("/api/auth/register", { body: { username: "A!", displayName: "x", salt: b64(salt), key: b64(key) } })).s, 422);
eq("salt panjang salah → 422", (await call("/api/auth/register", { body: { username: "faqih", displayName: "F", salt: b64(rnd(8)), key: b64(key) } })).s, 422);
eq("usia <11 → 422", (await call("/api/auth/register", { body: { username: "kiduser", displayName: "Kid", birthDate: new Date().toISOString().slice(0, 10), salt: b64(salt), key: b64(key) } })).s, 422);
const reg = await call("/api/auth/register", { body: { username: "Faqih", displayName: "Faqih M", birthDate: "2000-06-15", salt: b64(salt), key: b64(key) } });
eq("daftar → 201", reg.s, 201); eq("8 kode pemulihan", reg.j.recovery_codes.length, 8);
ok("kode berformat XXXX-XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(reg.j.recovery_codes[0]));
const uid = reg.j.user.id; let tokens = reg.j.tokens;
ok("kata sandi/kunci TIDAK ada di D1", !JSON.stringify(sqlite.prepare("select * from accounts").all()).includes(b64(key)));
eq("nama pengguna dobel → 409", (await call("/api/auth/register", { body: { username: "faqih", displayName: "x", birthDate: "2000-06-15", salt: b64(salt), key: b64(key2) } })).s, 409);
eq("salt akun nyata = salt tersimpan", (await call("/api/auth/salt", { body: { username: "faqih" } })).j.salt, b64(salt));
eq("login kunci salah → 401", (await call("/api/auth/login", { body: { username: "faqih", key: b64(key2) } })).s, 401);
const login = await call("/api/auth/login", { body: { username: "faqih", key: b64(key) } }); eq("login benar → 200", login.s, 200);
eq("pesan galat sama untuk akun tak ada", (await call("/api/auth/login", { body: { username: "ghost", key: b64(key) } })).j.error, "invalid_credentials");
// kunci akun
for (let i = 0; i < 8; i++) await call("/api/auth/login", { body: { username: "faqih", key: b64(key2) }, ip: "9.9.9." + i });
eq("terkunci setelah 8 salah → 429", (await call("/api/auth/login", { body: { username: "faqih", key: b64(key) }, ip: "9.9.9.99" })).s, 429);
sqlite.exec("delete from attempts");

// ================= JWT & sesi
const me = await call("/api/me", { token: tokens.access }); eq("token akses sah → /api/me 200 (ke Neon)", me.s, 200);
eq("tanpa token → 401", (await call("/api/me")).s, 401);
eq("kedaluwarsa → 401", (await call("/api/me", { token: await signJwt(env.JWT_SECRET, { sub: uid, sid: "s" }, -10) })).s, 401);
eq("rahasia lain → 401", (await call("/api/me", { token: await signJwt("x".repeat(40), { sub: uid, sid: "s" }, 600) })).s, 401);
const parts = tokens.access.split("."); const forged = parts[0] + "." + Buffer.from(JSON.stringify({ sub: "11111111-1111-4111-8111-111111111111", sid: "s", typ: "access", exp: 9999999999 })).toString("base64url") + "." + parts[2];
eq("payload dirusak → 401", (await call("/api/me", { token: forged })).s, 401);
eq("alg=none → 401", (await call("/api/me", { token: Buffer.from('{"alg":"none"}').toString("base64url") + "." + parts[1] + "." })).s, 401);
const r1 = await call("/api/auth/refresh", { body: { refresh: tokens.refresh } }); eq("refresh → 200", r1.s, 200);
ok("token segar dirotasi", r1.j.tokens.refresh !== tokens.refresh);
eq("pakai ulang cepat (≤10 dtk) → 401, keluarga utuh", (await call("/api/auth/refresh", { body: { refresh: tokens.refresh } })).s, 401);
eq("token baru masih sah", (await call("/api/auth/refresh", { body: { refresh: r1.j.tokens.refresh } })).s, 200);
const r3 = (await call("/api/auth/login", { body: { username: "faqih", key: b64(key) } })).j.tokens;
const r4 = await call("/api/auth/refresh", { body: { refresh: r3.refresh } }); sqlite.exec("update sessions set last_used = last_used - 100 where used = 1");
eq("pakai ulang lama (curi) → 401", (await call("/api/auth/refresh", { body: { refresh: r3.refresh } })).s, 401);
eq("…dan SELURUH keluarga dicabut", (await call("/api/auth/refresh", { body: { refresh: r4.j.tokens.refresh } })).s, 401);
eq("refresh acak → 401", (await call("/api/auth/refresh", { body: { refresh: "a".repeat(43) } })).s, 401);
tokens = (await call("/api/auth/login", { body: { username: "faqih", key: b64(key) } })).j.tokens;

// ================= ganti sandi & pemulihan
const nsalt = rnd(16);
eq("ganti sandi: kunci lama salah → 401", (await call("/api/auth/password", { token: tokens.access, body: { oldKey: b64(key2), salt: b64(nsalt), key: b64(key2) } })).s, 401);
eq("ganti sandi benar → 200", (await call("/api/auth/password", { token: tokens.access, body: { oldKey: b64(key), salt: b64(nsalt), key: b64(key2) } })).s, 200);
eq("kunci lama tak berlaku", (await call("/api/auth/login", { body: { username: "faqih", key: b64(key) } })).s, 401);
eq("kunci baru berlaku", (await call("/api/auth/login", { body: { username: "faqih", key: b64(key2) } })).s, 200);
const codes: string[] = reg.j.recovery_codes;
eq("pemulihan kode salah → 401", (await call("/api/auth/recover", { body: { username: "faqih", code: "AAAA-BBBB-CCCC", salt: b64(salt), key: b64(key) } })).s, 401);
const rec = await call("/api/auth/recover", { body: { username: "faqih", code: codes[0].toLowerCase(), salt: b64(salt), key: b64(key) } });
eq("pemulihan kode benar → 200", rec.s, 200); eq("set kode baru 8", rec.j.recovery_codes.length, 8);
eq("kode lama tak bisa dipakai lagi", (await call("/api/auth/recover", { body: { username: "faqih", code: codes[1], salt: b64(salt), key: b64(key) } })).s, 401);
eq("semua sesi lama dicabut", (await call("/api/auth/refresh", { body: { refresh: tokens.refresh } })).s, 401);
tokens = rec.j.tokens;

// ================= blokir akun
sqlite.exec(`update accounts set banned_until = ${Math.floor(Date.now() / 1000) + 3600}`);
eq("akun diblokir: login → 403", (await call("/api/auth/login", { body: { username: "faqih", key: b64(key) } })).s, 403);
eq("akun diblokir: tulis → 403", (await call("/api/posts", { token: tokens.access, body: { body: "halo" } })).s, 403);
eq("akun diblokir: refresh → 403", (await call("/api/auth/refresh", { body: { refresh: tokens.refresh } })).s, 403);
sqlite.exec("update accounts set banned_until = null");

// ================= posting & validasi
const T = tokens.access; const post = (b: any) => call("/api/posts", { token: T, body: b });
eq("posting ok", (await post({ body: "halo", visibility: "followers" })).s, 201);
eq("visibilitas jelek → 422", (await post({ body: "x", visibility: "semua" })).s, 422);
eq("kosong → 422", (await post({})).s, 422);
eq("3000 huruf → 422", (await post({ body: "a".repeat(3000) })).s, 422);
eq("karakter bidi → 422", (await post({ body: "abc\u202Edef" })).s, 422);
eq("foto: kunci bukan milik/format salah → 422", (await post({ body: "x", media: [{ kind: "photo", key: "p/zzz" }] })).s, 422);
eq("video milik orang lain → 422", (await post({ body: "x", media: [{ kind: "video", key: "v/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4" }] })).s, 422);
eq("berkas belum diunggah → 422 media_missing", (await post({ body: "x", media: [{ kind: "photo", key: "p/" + "b".repeat(24) }] })).j.error, "media_missing");
eq("video >10 dtk → 422", (await post({ body: "x", media: [{ kind: "video", key: `v/${uid}/33333333-3333-4333-8333-333333333333.mp4`, d: 20000 }] })).j.error, "video_too_long");
eq("body bukan JSON → 400", (await call("/api/posts", { token: T, m: "POST", raw: new TextEncoder().encode("{{{"), ct: "application/json" })).s, 400);
eq("content-type salah → 415", (await call("/api/posts", { token: T, m: "POST", raw: new TextEncoder().encode("x"), ct: "text/plain" })).s, 415);
eq("nama pengguna aneh di path → 404", (await call("/api/users/" + encodeURIComponent("x'; drop table posts;--"), { token: T })).s, 404);

// ================= foto (MongoDB) + kuota + URL bertanda tangan
const up = await call("/api/media/photo", { token: T, raw: JPEG, m: "POST" }); eq("unggah foto → 201", up.s, 201);
const pkey = up.j.key; ok("kunci foto p/<24 hex>", /^p\/[0-9a-f]{24}$/.test(pkey));
eq("foto bukan gambar → 415", (await call("/api/media/photo", { token: T, raw: new TextEncoder().encode("<script>alert(1)</script>".repeat(5)), m: "POST" })).s, 415);
eq("foto terlalu besar → 413", (await call("/api/media/photo", { token: T, raw: new Uint8Array(1000 * 1024).fill(0xff), m: "POST" })).s, 413);
eq("posting dengan foto sendiri → 201", (await post({ body: "foto", media: [{ kind: "photo", key: pkey, w: 800, h: 6000 }] })).s, 201);
const sg = await call("/api/media/sign", { token: T, body: { keys: [pkey, "p/" + "c".repeat(24)] } });
ok("tanda tangan: milik sendiri ya, orang lain tidak", !!sg.j.urls[pkey] && !sg.j.urls["p/" + "c".repeat(24)]);
const purl = sg.j.urls[pkey]; eq("URL foto sah → 200", (await call(purl)).s, 200);
eq("URL foto tanpa tanda tangan → 403", (await call(purl.split("?")[0])).s, 403);
eq("URL foto tanda tangan palsu → 403", (await call(purl.replace(/s=[0-9a-f]+/, "s=" + "0".repeat(32)))).s, 403);
eq("URL foto kedaluwarsa → 403", (await call(purl.replace(/e=\d+/, "e=1700000000"))).s, 403);
// ================= video/audio (Supabase)
eq("ekstensi aneh → 415", (await call("/api/media/upload-url", { token: T, body: { ext: "exe", size: 1000 } })).s, 415);
eq("terlalu besar → 413", (await call("/api/media/upload-url", { token: T, body: { ext: "mp4", size: 60 * 1024 * 1024 } })).s, 413);
const uu = await call("/api/media/upload-url", { token: T, body: { ext: "mp4", size: 2_000_000 } }); eq("URL unggah → 201", uu.s, 201);
ok("kunci v/<uid>/<uuid>.mp4", new RegExp(`^v/${uid}/[0-9a-f-]{36}\\.mp4$`).test(uu.j.key)); ok("kunci layanan Supabase tidak bocor ke klien", !uu.t.includes("service"));
let quotaStatus = 0; for (let i = 0; i < 8 && quotaStatus !== 429; i++) quotaStatus = (await call("/api/media/upload-url", { token: T, body: { ext: "mp4", size: 49 * 1024 * 1024 } })).s;
eq("kuota video per akun terlampaui → 429", quotaStatus, 429);
const cm = await call("/api/media/commit", { token: T, body: { key: uu.j.key } }); eq("commit video sah → 200", cm.s, 200);
ok("commit: status jadi ready di D1", (sqlite.prepare("select status from media_index where key = ?").get(uu.j.key) as any).status === "ready");
eq("commit kunci orang lain → 422", (await call("/api/media/commit", { token: T, body: { key: "v/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4" } })).s, 422);
const uu2 = await call("/api/media/upload-url", { token: T, body: { ext: "mp4", size: 1000 } });
sqlite.prepare("update media_index set key = key where key = ?").run(uu2.j.key);
eq("commit: ukuran tak cocok → 422 & dihapus", (await (async () => { sqlite.prepare("update media_index set size = 777 where key = ?").run(uu2.j.key); return call("/api/media/commit", { token: T, body: { key: uu2.j.key } }); })()).s, 422);
ok("berkas bermasalah dihapus dari indeks", !sqlite.prepare("select 1 from media_index where key = ?").get(uu2.j.key));
const vid = await post({ body: "video", media: [{ kind: "video", key: uu.j.key, w: 720, h: 1280, d: 5000 }] }); eq("posting dengan video sendiri → 201", vid.s, 201);
ok("media dikirim ke Neon sebagai JSON (bukan array Postgres)", typeof neonParams.api_create_post?.[3] === "string" && JSON.parse(neonParams.api_create_post[3])[0].key === uu.j.key);
// ================= foto profil (D1)
eq("avatar bukan gambar → 415", (await call("/api/avatar", { token: T, raw: new TextEncoder().encode("hello world hello world"), m: "POST" })).s, 415);
eq("avatar >90 KB → 413", (await call("/api/avatar", { token: T, raw: new Uint8Array(100 * 1024).fill(0xff), m: "POST" })).s, 413);
const av = await call("/api/avatar", { token: T, raw: JPEG, m: "POST" }); eq("avatar → 201", av.s, 201);
const ag = await mod.fetch(new Request(`https://onym.example/api/avatar/${av.j.key}`), env, ctx); eq("avatar publik terbaca", ag.status, 200); eq("avatar bertipe gambar", ag.headers.get("content-type"), "image/jpeg");
// ================= web & lainnya
eq("web (SPA)", (await call("/")).s, 200); eq("POST ke web → 405", (await call("/", { m: "POST", body: {} })).s, 405);
const csp = (await mod.fetch(new Request("https://onym.example/"), env, ctx)).headers.get("content-security-policy") ?? ""; ok("CSP ketat", csp.includes("frame-ancestors 'none'") && !csp.includes("'unsafe-eval'"));
eq("rute tak dikenal → 404", (await call("/api/zzz", { token: T })).s, 404);
eq("config publik", (await call("/api/config")).s, 200);
const dm = await call("/api/me", { token: T, m: "DELETE" }); eq("hapus akun → 200", dm.s, 200);
ok("akun & sesi D1 langsung hilang", !sqlite.prepare("select 1 from accounts where id = ?").get(uid) && !sqlite.prepare("select 1 from sessions where user_id = ?").get(uid));
eq("setelah hapus: login gagal", (await call("/api/auth/login", { body: { username: "faqih", key: b64(key) } })).s, 401);
eq("logout", (await call("/api/auth/logout", { body: { refresh: tokens.refresh } })).s, 200);
eq("logout-all", (await call("/api/auth/logout-all", { token: T, body: {} })).s, 200);
console.log(fails ? `\n${fails} GAGAL` : "\nSEMUA LOLOS"); process.exit(fails ? 1 : 0);
