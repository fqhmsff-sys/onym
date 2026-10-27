// Onym · satu Worker = web (Flutter web, aset statis) + API /api/*.
// D1: akun, sesi, batas login, konfigurasi, perangkat, foto profil, indeks media  ·  Neon: isi sosial (lewat fungsi api_*)
// MongoDB: linimasa, notifikasi, foto posting (gateway Edge Function)  ·  Supabase Storage: video & audio saja.
import { b64, unb64 } from "./crypto";
import { verifyJwt, type Claims } from "./crypto";
import * as A from "./auth";
import { fail, HttpError, intParam, ISO_RE, json, parseCursor, readJson, str, UUID_RE, withSecurity } from "./http";
import * as M from "./media";
import { audit, hashIp, nq, nv, type NeonEnv } from "./neon";

export interface Env extends NeonEnv, M.MediaEnv, A.AuthEnv {
  ASSETS: Fetcher;
  RL_ANON: RateLimit; RL_AUTH: RateLimit; RL_READ: RateLimit; RL_WRITE: RateLimit; RL_UPLOAD: RateLimit;
}
type Ctx = ExecutionContext;
interface Req { req: Request; url: URL; env: Env; ctx: Ctx; ip: string }
const nowSec = () => Math.floor(Date.now() / 1000);
const VIS = ["public", "followers", "following", "mutual", "relationship", "friend", "bestfriend", "partner", "family", "me"];
const vis = (v: unknown) => { if (typeof v !== "string" || !VIS.includes(v)) throw new HttpError(422, "visibility_invalid"); return v; };
const uuidOr = (v: unknown, f: string) => { if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(422, `${f}_invalid`); return v; };
const optUuid = (v: unknown, f: string) => (v === undefined || v === null ? null : uuidOr(v, f));
const UNAME = /^[a-z0-9_]{3,20}$/;
const uname = (v: string) => { const x = decodeURIComponent(v).toLowerCase(); if (!UNAME.test(x)) throw new HttpError(404, "not_found"); return x; };
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const cursorOf = (rows: any[], lim: number) => (rows.length === lim ? `${iso(rows[rows.length - 1].created_at)}_${rows[rows.length - 1].id}` : null);

function webHeaders(): Record<string, string> {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; media-src 'self' blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co; font-src 'self' data:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "permissions-policy": "camera=(self), microphone=(self), geolocation=()", "cross-origin-opener-policy": "same-origin",
  };
}

// ---------------------------------------------------------------- umum
async function limit(c: Req, rl: RateLimit, key: string, route: string, uid?: string) {
  const { success } = await rl.limit({ key });
  if (!success) { audit(c.env, c.ctx, { kind: "rate_limited", userId: uid, ip: c.ip, route, status: 429 }); throw new HttpError(429, "rate_limited"); }
}
async function authenticate(c: Req, route: string): Promise<Claims> {
  const m = /^Bearer ([A-Za-z0-9._-]{20,2048})$/.exec(c.req.headers.get("authorization") ?? "");
  const cl = m ? await verifyJwt(c.env.JWT_SECRET, m[1]) : null;
  if (!cl) { if (Math.random() < 0.05) audit(c.env, c.ctx, { kind: "auth_invalid", ip: c.ip, route, status: 401 }); throw new HttpError(401, "unauthorized"); }
  return cl;
}

// ---------------------------------------------------------------- akun (D1) + profil (Neon)
const userOut = (id: string, username: string, displayName: string) => ({ id, username, display_name: displayName });
async function authRoutes(c: Req): Promise<Response> {
  const p = c.url.pathname, m = c.req.method; if (m !== "POST") throw new HttpError(405, "method");
  const ipk = await hashIp(c.env, c.ip);
  await limit(c, c.env.RL_AUTH, `a:${ipk}`, p);
  const ua = c.req.headers.get("user-agent");

  if (p === "/api/auth/salt") {
    const b = await readJson(c.req, 512); const u = A.parseUsername(b.username);
    return json({ salt: await A.saltFor(c.env, u), kdf: "pbkdf2-sha256", iterations: A.KDF_ITER });
  }
  if (p === "/api/auth/register") {
    const open = await c.env.DB.prepare("select value from app_config where key = 'flag_signup'").first<{ value: string }>();
    if (open && open.value === "0") throw new HttpError(403, "signup_closed");
    await A.checkLock(c.env, `reg:${ipk}`);
    const b = await readJson(c.req, 2048);
    const username = A.parseUsername(b.username), display = str(b.displayName ?? username, 1, 40, "displayName");
    const birthDate = str(b.birthDate, 10, 10, "birthDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new HttpError(422, "birth_date_invalid");
    const bd = new Date(`${birthDate}T00:00:00Z`), now = new Date();
    if (Number.isNaN(bd.getTime()) || bd.toISOString().slice(0, 10) !== birthDate) throw new HttpError(422, "birth_date_invalid");
    let age = now.getUTCFullYear() - bd.getUTCFullYear();
    const beforeBirthday = now.getUTCMonth() < bd.getUTCMonth() || (now.getUTCMonth() === bd.getUTCMonth() && now.getUTCDate() < bd.getUTCDate());
    if (beforeBirthday) age--;
    if (age < 11 || bd < new Date("1900-01-01T00:00:00Z")) throw new HttpError(422, "age_minimum");
    const salt = A.parseKey(b.salt, 16, "salt"), key = A.parseKey(b.key, 32, "key");
    await A.hit(c.env, `reg:${ipk}`, 5, 3600, 3600);
    const id = crypto.randomUUID();
    const codes = await A.createAccount(c.env, id, username, salt, key);
    try { await nq(c.env, "api_create_profile", [id, username, display, birthDate]); }
    catch (e) { await A.dropAccount(c.env, id); throw e; } // dua penyimpanan: gagal di Neon → batalkan akun di D1
    return json({ user: userOut(id, username, display), tokens: await A.issue(c.env, id, ua), recovery_codes: codes }, 201);
  }
  if (p === "/api/auth/login") {
    const b = await readJson(c.req, 1024); const username = A.parseUsername(b.username), key = A.parseKey(b.key, 32, "key");
    await A.checkLock(c.env, `u:${username}`); await A.checkLock(c.env, `i:${ipk}`);
    let acc: A.Account;
    try { acc = await A.verifyLogin(c.env, username, key); }
    catch (e) {
      if (e instanceof HttpError && e.status === 401) { await A.hit(c.env, `u:${username}`, 8, 900, 900); await A.hit(c.env, `i:${ipk}`, 40, 900, 900); audit(c.env, c.ctx, { kind: "login_failed", ip: c.ip, route: p, status: 401 }); }
      throw e;
    }
    await A.clearHits(c.env, `u:${username}`);
    const me = (await nq(c.env, "api_me", [acc.id]))[0];
    return json({ user: userOut(acc.id, acc.username, me?.display_name ?? acc.username), tokens: await A.issue(c.env, acc.id, ua) });
  }
  if (p === "/api/auth/refresh") { const b = await readJson(c.req, 512); const t = await A.refresh(c.env, b.refresh, ua); return json({ tokens: { access: t.access, refresh: t.refresh, expiresIn: t.expiresIn } }); }
  if (p === "/api/auth/logout") { const b = await readJson(c.req, 512); await A.logout(c.env, b.refresh); return json({ ok: true }); }
  if (p === "/api/auth/recover") {
    const b = await readJson(c.req, 1024); const username = A.parseUsername(b.username);
    const code = str(b.code, 8, 24, "code"), salt = A.parseKey(b.salt, 16, "salt"), key = A.parseKey(b.key, 32, "key");
    await A.checkLock(c.env, `rec:${username}`); await A.checkLock(c.env, `rec:${ipk}`);
    let r;
    try { r = await A.recover(c.env, username, code, salt, key); }
    catch (e) { if (e instanceof HttpError && e.status === 401) { await A.hit(c.env, `rec:${username}`, 5, 3600, 3600); await A.hit(c.env, `rec:${ipk}`, 20, 3600, 3600); } throw e; }
    return json({ recovery_codes: r.codes, tokens: await A.issue(c.env, r.id, ua) });
  }
  const cl = await authenticate(c, p);
  if (p === "/api/auth/password") {
    const b = await readJson(c.req, 2048);
    await A.changePassword(c.env, cl.sub, A.parseKey(b.oldKey, 32, "oldKey"), A.parseKey(b.salt, 16, "salt"), A.parseKey(b.key, 32, "key"), cl.sid);
    return json({ ok: true });
  }
  if (p === "/api/auth/logout-all") { await A.revokeAll(c.env, cl.sub); return json({ ok: true }); }
  throw new HttpError(404, "not_found");
}

// ---------------------------------------------------------------- publik
async function config(c: Req) {
  await limit(c, c.env.RL_ANON, `ip:${c.ip}`, "config");
  const key = new Request("https://cache.onym.invalid/config"); const hit = await caches.default.match(key); if (hit) return hit;
  const { results } = await c.env.DB.prepare("select key, value from app_config").all<{ key: string; value: string }>();
  const cfg: Record<string, string> = {}; for (const r of results) cfg[r.key] = r.value;
  const res = json(cfg, 200, { "cache-control": "public, max-age=60" }); c.ctx.waitUntil(caches.default.put(key, res.clone())); return res;
}
async function feedPublic(c: Req) {
  await limit(c, c.env.RL_ANON, `ip:${c.ip}`, "feed.public");
  const cur = parseCursor(c.url.searchParams.get("cursor")); const lim = intParam(c.url.searchParams.get("limit"), 20, 1, 30);
  const key = new Request(`https://cache.onym.invalid/feed/public?c=${cur ? `${cur.ts}_${cur.id ?? ""}` : ""}&l=${lim}`);
  const hit = await caches.default.match(key); if (hit) return hit;
  const rows = await nq(c.env, "api_feed", [null, cur?.ts ?? null, cur?.id ?? null, lim]);
  const res = json({ posts: rows, next: cursorOf(rows, lim) }, 200, { "cache-control": "public, max-age=10, s-maxage=10" }); c.ctx.waitUntil(caches.default.put(key, res.clone())); return res;
}
async function getAvatar(c: Req) {
  const m = /^\/api\/avatar\/([0-9a-f-]{36})\/\d{1,13}$/.exec(c.url.pathname); if (!m) throw new HttpError(404, "not_found");
  const r = await c.env.DB.prepare("select mime, data from avatars where user_id = ?").bind(m[1]).first<{ mime: string; data: string }>();
  if (!r) throw new HttpError(404, "not_found");
  return new Response(unb64(r.data), { headers: { "content-type": r.mime, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "cross-origin", "content-security-policy": "default-src 'none'; sandbox" } });
}
async function getPhoto(c: Req) {
  const m = /^\/api\/photo\/([0-9a-f]{24})$/.exec(c.url.pathname); if (!m) throw new HttpError(404, "not_found");
  if (!(await M.verifyPhoto(c.env, m[1], c.url.searchParams.get("e"), c.url.searchParams.get("s")))) throw new HttpError(403, "forbidden");
  const ck = new Request(`https://cache.onym.invalid/photo/${m[1]}`);
  let res = await caches.default.match(ck);
  if (!res) {
    const up = await M.mongo(c.env, "photo-get", { id: m[1] }, undefined, {}, "GET");
    if (up.status === 404) throw new HttpError(404, "not_found"); if (!up.ok) throw new HttpError(502, "upstream");
    const body = new Uint8Array(await up.arrayBuffer()); const ext = M.imageExt(body); if (!ext) throw new HttpError(502, "upstream");
    res = new Response(body, { headers: { "content-type": M.imageMime(ext), "cache-control": "public, max-age=31536000, immutable" } });
    c.ctx.waitUntil(caches.default.put(ck, res.clone()));
  }
  const h = new Headers(res.headers); h.set("cache-control", "private, max-age=3000"); h.set("x-content-type-options", "nosniff"); h.set("cross-origin-resource-policy", "cross-origin"); h.set("content-security-policy", "default-src 'none'; sandbox");
  return new Response(res.body, { status: 200, headers: h });
}

// ---------------------------------------------------------------- media (login)
async function readRaw(req: Request, max: number): Promise<Uint8Array> {
  const len = Number(req.headers.get("content-length") ?? "0"); if (!len) throw new HttpError(411, "length_required"); if (len > max) throw new HttpError(413, "too_large");
  if (!req.body) throw new HttpError(400, "empty");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > max) { await reader.cancel(); throw new HttpError(413, "too_large"); } chunks.push(value); }
  const out = new Uint8Array(total); let o = 0; for (const ch of chunks) { out.set(ch, o); o += ch.byteLength; } return out;
}
async function uploadPhoto(c: Req, u: Claims) {
  const buf = await readRaw(c.req, M.LIMITS.photoMax); const ext = M.imageExt(buf);
  if (!ext) { audit(c.env, c.ctx, { kind: "upload_rejected", userId: u.sub, ip: c.ip, route: "media.photo", status: 415 }); throw new HttpError(415, "content_mismatch"); }
  const mine = await M.usage(c.env, u.sub), all = await M.usage(c.env);
  if (mine.photo + buf.length > M.LIMITS.userPhotoBytes) throw new HttpError(429, "quota");
  if (all.photo + buf.length > M.LIMITS.globalPhotoBytes) throw new HttpError(507, "storage_full");
  const r = await M.mongo(c.env, "photo-put", { owner: u.sub }, buf, { "content-type": M.imageMime(ext) });
  if (!r.ok) throw new HttpError(502, "upstream");
  const id = ((await r.json()) as { id?: string }).id; if (!id || !/^[0-9a-f]{24}$/.test(id)) throw new HttpError(502, "upstream");
  const key = `p/${id}`; await M.reserve(c.env, u.sub, key, buf.length, M.imageMime(ext), "ready");
  return json({ key, size: buf.length }, 201);
}
async function uploadUrl(c: Req, u: Claims) {
  const b = await readJson(c.req, 512); const ext = typeof b.ext === "string" ? b.ext : ""; const spec = M.FILE_TYPES[ext]; if (!spec) throw new HttpError(415, "ext");
  const size = b.size; if (typeof size !== "number" || !Number.isInteger(size) || size < 16 || size > M.LIMITS.fileMax) throw new HttpError(413, "too_large");
  const mine = await M.usage(c.env, u.sub), all = await M.usage(c.env);
  if (mine.file + size > M.LIMITS.userFileBytes) throw new HttpError(429, "quota");
  if (all.file + size > M.LIMITS.globalFileBytes) throw new HttpError(507, "storage_full");
  const key = `${spec.kind === "video" ? "v" : "a"}/${u.sub}/${crypto.randomUUID()}.${ext}`;
  const url = await M.sbSignUpload(c.env, key);
  await M.reserve(c.env, u.sub, key, size, spec.mime, "pending");
  return json({ key, url, headers: { "content-type": spec.mime } }, 201);
}
async function commit(c: Req, u: Claims) {
  const b = await readJson(c.req, 512); const key = b.key;
  if (typeof key !== "string" || !(M.keyVideo(u.sub).test(key) || M.keyAudio(u.sub).test(key))) throw new HttpError(422, "key_invalid");
  const rec = await c.env.DB.prepare("select size from media_index where key = ? and owner = ?").bind(key, u.sub).first<{ size: number }>(); if (!rec) throw new HttpError(404, "not_found");
  const probe = await M.sbProbe(c.env, key); if (!probe) throw new HttpError(404, "not_uploaded");
  const drop = async (why: string) => { await M.sbRemove(c.env, [key]); await c.env.DB.prepare("delete from media_index where key = ?").bind(key).run(); audit(c.env, c.ctx, { kind: "upload_rejected", userId: u.sub, ip: c.ip, route: "media.commit", status: 422, detail: { why } }); };
  if (probe.size !== rec.size) { await drop("size"); throw new HttpError(422, "size_mismatch"); }
  if (!M.sniff(key.split(".").pop()!, probe.head)) { await drop("magic"); throw new HttpError(415, "content_mismatch"); }
  await c.env.DB.prepare("update media_index set status = 'ready' where key = ?").bind(key).run();
  return json({ key, size: probe.size });
}
async function signMedia(c: Req, u: Claims) {
  const b = await readJson(c.req, 2048); const keys = Array.isArray(b.keys) ? (b.keys as unknown[]) : null;
  if (!keys || keys.length > 24 || !keys.every((k) => typeof k === "string" && M.ANY_KEY.test(k))) throw new HttpError(422, "keys_invalid");
  const uniq = [...new Set(keys as string[])]; if (!uniq.length) return json({ urls: {} });
  const owned = new Set<string>(); const need: string[] = [];
  const ph = uniq.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(`select key from media_index where owner = ? and key in (${ph})`).bind(u.sub, ...uniq).all<{ key: string }>();
  for (const r of results) owned.add(r.key);
  for (const k of uniq) if (!owned.has(k)) need.push(k);
  const visible = need.length ? new Set<string>((await nv<string[]>(c.env, "api_media_visible", [u.sub, need])) ?? []) : new Set<string>();
  const allowed = uniq.filter((k) => owned.has(k) || visible.has(k));
  const urls: Record<string, string> = {};
  for (const k of allowed.filter((k) => k.startsWith("p/"))) urls[k] = (await M.signPhoto(c.env, k.slice(2))).url;
  Object.assign(urls, await M.sbSignRead(c.env, allowed.filter((k) => !k.startsWith("p/"))));
  return json({ urls, ttl: 3300 });
}
async function uploadAvatar(c: Req, u: Claims) {
  const buf = await readRaw(c.req, M.LIMITS.avatarMax); const ext = M.imageExt(buf); if (!ext) throw new HttpError(415, "content_mismatch");
  const ver = Date.now();
  await c.env.DB.prepare("insert into avatars (user_id, mime, data, updated_at) values (?, ?, ?, ?) on conflict(user_id) do update set mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at").bind(u.sub, M.imageMime(ext), b64(buf), nowSec()).run();
  await nq(c.env, "api_set_avatar", [u.sub, ver]);
  return json({ key: `${u.sub}/${ver}` }, 201);
}
async function parseMedia(c: Req, v: unknown, uid: string) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 4) throw new HttpError(422, "media_invalid");
  const out: { kind: string; key: string; w: number; h: number; d: number }[] = [];
  const int = (x: unknown, hi: number, f: string) => { if (x === undefined) return 0; if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > hi) throw new HttpError(422, `${f}_invalid`); return x; };
  for (const it of v) {
    if (typeof it !== "object" || it === null) throw new HttpError(422, "media_invalid");
    const { kind, key, w, h, d } = it as Record<string, unknown>;
    const ok = typeof key === "string" && ((kind === "photo" && M.KEY_PHOTO.test(key)) || (kind === "video" && M.keyVideo(uid).test(key)) || (kind === "audio" && M.keyAudio(uid).test(key)));
    if (!ok) throw new HttpError(422, "media_invalid");
    if (kind === "video" && typeof d === "number" && d > 10500) throw new HttpError(422, "video_too_long");
    out.push({ kind: kind as string, key: key as string, w: int(w, 20000, "w"), h: int(h, 20000, "h"), d: int(d, 86_400_000, "d") });
  }
  if (out.length) {
    const ph = out.map(() => "?").join(",");
    const { results } = await c.env.DB.prepare(`select key from media_index where owner = ? and status in ('ready','attached') and key in (${ph})`).bind(uid, ...out.map((x) => x.key)).all<{ key: string }>();
    if (results.length !== new Set(out.map((x) => x.key)).size) throw new HttpError(422, "media_missing"); // hanya berkas milik sendiri yang sudah selesai diunggah
  }
  return out;
}

// ---------------------------------------------------------------- notifikasi & linimasa (MongoDB)
function notify(c: Req, userId: unknown, type: string, actor: string, extra: Record<string, unknown> = {}) {
  if (typeof userId !== "string" || userId === actor) return;
  c.ctx.waitUntil(M.mongoJson(c.env, "notify", {}, { userId, type, actorId: actor, ...extra }).catch(() => {}));
}
async function fanout(c: Req, postId: string, author: string, vis: string) {
  if (vis === "me") return;
  const targets = ((await nv<string[]>(c.env, "api_fanout_targets", [author, 5000])) ?? []) as string[];
  await M.mongoJson(c.env, "fanout", {}, { postId, authorId: author, createdAt: new Date().toISOString(), userIds: [author, ...targets] });
}
async function feedHome(c: Req, u: Claims) {
  const lim = intParam(c.url.searchParams.get("limit"), 20, 1, 30); const cur = c.url.searchParams.get("cursor"); if (cur && !ISO_RE.test(cur)) throw new HttpError(400, "cursor");
  const t = await M.mongoJson(c.env, "timeline", { user: u.sub, limit: String(lim), ...(cur ? { before: cur } : {}) }, undefined, "GET") as { ids: string[]; next: string | null };
  let rows: any[] = [];
  if (t.ids.length) { const by = new Map((await nq(c.env, "api_posts_by_ids", [u.sub, t.ids])).map((r: any) => [r.id, r])); rows = t.ids.map((id) => by.get(id)).filter(Boolean) as any[]; }
  else if (!cur) rows = await nq(c.env, "api_feed", [u.sub, null, null, lim]);
  return json({ posts: rows, next: t.next ?? null });
}
async function notifications(c: Req, u: Claims) {
  const cur = c.url.searchParams.get("cursor"); if (cur && !ISO_RE.test(cur)) throw new HttpError(400, "cursor");
  const r = await M.mongoJson(c.env, "notifications", { user: u.sub, limit: "30", ...(cur ? { before: cur } : {}) }, undefined, "GET") as { items: any[]; next: string | null };
  const ids = [...new Set(r.items.map((i) => i.actorId).filter((x: unknown) => typeof x === "string" && UUID_RE.test(x as string)))];
  const users = ids.length ? new Map((await nq(c.env, "api_users_lite", [ids])).map((x: any) => [x.id, x])) : new Map();
  return json({ items: r.items.map((i) => ({ type: i.type, post_id: i.postId ?? null, created_at: i.createdAt, read: !!i.read, actor: users.get(i.actorId) ?? null })), next: r.next ?? null });
}

// ---------------------------------------------------------------- router login
async function api(c: Req): Promise<Response> {
  const p = c.url.pathname, m = c.req.method;
  if (p === "/api/health") {
    const missing = ["NEON_DATABASE_URL", "AUTH_PEPPER", "JWT_SECRET", "INTERNAL_SECRET", "IP_HASH_SALT", "SUPABASE_SERVICE_KEY"]
      .filter((k) => !String((c.env as any)[k] ?? "").trim());
    return json({ ok: missing.length === 0, ready: missing.length === 0, missing: missing.length }, missing.length ? 503 : 200);
  }
  if (m === "GET" && p === "/api/config") return config(c);
  if (m === "GET" && p === "/api/feed/public") return feedPublic(c);
  if (m === "GET" && p.startsWith("/api/avatar/")) return getAvatar(c);
  if (m === "GET" && p.startsWith("/api/photo/")) return getPhoto(c);
  if (p.startsWith("/api/auth/")) return authRoutes(c);

  const u = await authenticate(c, p);
  const write = m !== "GET";
  await limit(c, write ? c.env.RL_WRITE : c.env.RL_READ, `${write ? "w" : "r"}:${u.sub}`, p, u.sub);
  if (write) await A.assertNotBanned(c.env, u.sub);
  const N = (fn: string, args: unknown[]) => nq(c.env, fn, args);

  if (m === "GET" && p === "/api/me") { const r = await N("api_me", [u.sub]); if (!r.length) throw new HttpError(401, "unauthorized"); return json(r[0]); }
  if (m === "PATCH" && p === "/api/me") {
    const b = await readJson(c.req, 4096); const patch: Record<string, unknown> = {};
    if (b.displayName !== undefined) patch.display_name = str(b.displayName, 1, 40, "displayName");
    if (b.bio !== undefined) patch.bio = b.bio === null ? "" : str(b.bio, 0, 160, "bio");
    if (b.birthDate !== undefined) { if (b.birthDate !== null && !(typeof b.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.birthDate))) throw new HttpError(422, "birthDate_invalid"); patch.birth_date = b.birthDate ?? ""; }
    for (const [k, f] of [["birthDateVisibility", "birth_date_visibility"], ["defaultVisibility", "default_visibility"], ["relationsVisibility", "relations_visibility"]] as const) if (b[k] !== undefined) patch[f] = vis(b[k]);
    if (b.settings !== undefined) {
      const st = b.settings as Record<string, unknown>; if (typeof st !== "object" || st === null || Array.isArray(st)) throw new HttpError(422, "settings_invalid");
      const clean: Record<string, unknown> = {};
      if (st.theme !== undefined) { if (!["light", "dark", "system"].includes(st.theme as string)) throw new HttpError(422, "theme_invalid"); clean.theme = st.theme; }
      if (st.lang !== undefined) { if (!["id", "en"].includes(st.lang as string)) throw new HttpError(422, "lang_invalid"); clean.lang = st.lang; }
      if (st.motion !== undefined) { if (typeof st.motion !== "boolean") throw new HttpError(422, "motion_invalid"); clean.motion = st.motion; }
      patch.settings = clean;
    }
    if (!Object.keys(patch).length) throw new HttpError(422, "empty");
    await N("api_update_me", [u.sub, patch]); return json({ ok: true });
  }
  if (m === "DELETE" && p === "/api/me") {
    const keys = ((await nv<string[]>(c.env, "api_delete_me", [u.sub])) ?? []) as string[];
    const mine = await c.env.DB.prepare("select key from media_index where owner = ?").bind(u.sub).all<{ key: string }>();
    await c.env.DB.batch([c.env.DB.prepare("delete from sessions where user_id = ?").bind(u.sub), c.env.DB.prepare("delete from accounts where id = ?").bind(u.sub), c.env.DB.prepare("delete from devices where user_id = ?").bind(u.sub), c.env.DB.prepare("delete from avatars where user_id = ?").bind(u.sub)]);
    c.ctx.waitUntil((async () => {
      const all = new Set([...keys, ...mine.results.map((r) => r.key)]);
      await M.sbRemove(c.env, [...all]);
      for (const k of all) if (k.startsWith("p/")) await M.mongo(c.env, "photo-del", { id: k.slice(2) }).catch(() => {});
      await M.mongoJson(c.env, "user-delete", { user: u.sub }).catch(() => {});
      await c.env.DB.prepare("delete from media_index where owner = ?").bind(u.sub).run();
    })());
    return json({ ok: true });
  }
  if (m === "POST" && p === "/api/avatar") { await limit(c, c.env.RL_UPLOAD, `u:${u.sub}`, p, u.sub); return uploadAvatar(c, u); }
  if (m === "POST" && p === "/api/media/photo") { await limit(c, c.env.RL_UPLOAD, `u:${u.sub}`, p, u.sub); return uploadPhoto(c, u); }
  if (m === "POST" && p === "/api/media/upload-url") { await limit(c, c.env.RL_UPLOAD, `u:${u.sub}`, p, u.sub); return uploadUrl(c, u); }
  if (m === "POST" && p === "/api/media/commit") return commit(c, u);
  if (m === "POST" && p === "/api/media/sign") return signMedia(c, u);

  if (m === "GET" && p === "/api/feed/home") return feedHome(c, u);
  if (m === "GET" && p === "/api/random") return json({ posts: await N("api_random", [u.sub, intParam(c.url.searchParams.get("limit"), 10, 1, 20)]) });
  if (m === "GET" && p === "/api/saves") return json({ posts: await N("api_saved", [u.sub, 50]) });
  if (m === "GET" && p === "/api/search") {
    const q = (c.url.searchParams.get("q") ?? "").trim(); if (q.length < 2 || q.length > 60) throw new HttpError(400, "q");
    return c.url.searchParams.get("type") === "posts" ? json({ posts: await N("api_search_posts", [u.sub, q]) }) : json({ users: await N("api_search_users", [u.sub, q]) });
  }
  if (m === "GET" && p === "/api/notifications") return notifications(c, u);
  if (m === "GET" && p === "/api/notifications/unread") return json(await M.mongoJson(c.env, "unread", { user: u.sub }, undefined, "GET"));
  if (m === "POST" && p === "/api/notifications/read") { await M.mongoJson(c.env, "read", { user: u.sub }); return json({ ok: true }); }
  if (m === "POST" && p === "/api/devices") {
    const b = await readJson(c.req, 2048); const token = str(b.token, 20, 1024, "token"); if (!/^[A-Za-z0-9_:\-.]+$/.test(token)) throw new HttpError(422, "token_invalid");
    await c.env.DB.batch([
      c.env.DB.prepare("insert into devices (token, user_id, platform, updated_at) values (?, ?, ?, ?) on conflict(token) do update set user_id = excluded.user_id, updated_at = excluded.updated_at").bind(token, u.sub, b.platform === "web" ? "web" : "android", nowSec()),
      c.env.DB.prepare("delete from devices where user_id = ? and token not in (select token from devices where user_id = ? order by updated_at desc limit 5)").bind(u.sub, u.sub)]);
    return json({ ok: true }, 201);
  }
  if (m === "DELETE" && p === "/api/devices") { const b = await readJson(c.req, 2048); await c.env.DB.prepare("delete from devices where token = ? and user_id = ?").bind(str(b.token, 20, 1024, "token"), u.sub).run(); return json({ ok: true }); }

  if (m === "POST" && p === "/api/posts") {
    const b = await readJson(c.req, 16 * 1024);
    const id = b.id === undefined ? crypto.randomUUID() : uuidOr(b.id, "id"); const body = b.body === undefined ? "" : str(b.body, 0, 2000, "body");
    const media = await parseMedia(c, b.media, u.sub); if (!body.trim() && !media.length) throw new HttpError(422, "empty");
    const v = b.visibility === undefined ? "public" : vis(b.visibility); const rnd = b.inRandom === true && media.length > 0 && v === "public";
    const created = await nv<boolean>(c.env, "api_create_post", [u.sub, id, body, media, v, rnd]);
    if (created) {
      if (media.length) c.ctx.waitUntil(c.env.DB.prepare(`update media_index set status = 'attached' where owner = ? and key in (${media.map(() => "?").join(",")})`).bind(u.sub, ...media.map((x) => x.key)).run());
      c.ctx.waitUntil(fanout(c, id, u.sub, v).catch(() => {}));
    }
    return json({ id, duplicate: !created }, created ? 201 : 200);
  }
  const pm = /^\/api\/posts\/([0-9a-f-]{36})(\/(star|comments|report|save|rating|view))?$/.exec(p);
  if (pm && UUID_RE.test(pm[1])) {
    const id = pm[1], sub = pm[3];
    if (!sub && m === "GET") { const r = await N("api_posts_by_ids", [u.sub, [id]]); if (!r.length) throw new HttpError(404, "not_found"); return json(r[0]); }
    if (!sub && m === "PATCH") {
      const b = await readJson(c.req, 16 * 1024); const patch: Record<string, unknown> = {};
      if (b.body !== undefined) patch.body = str(b.body, 0, 2000, "body"); if (b.visibility !== undefined) patch.visibility = vis(b.visibility);
      if (b.inRandom !== undefined) { if (typeof b.inRandom !== "boolean") throw new HttpError(422, "inRandom_invalid"); patch.in_random = b.inRandom; }
      if (!Object.keys(patch).length) throw new HttpError(422, "empty"); await N("api_edit_post", [u.sub, id, patch]); return json({ ok: true });
    }
    if (!sub && m === "DELETE") {
      const media = (await nv<any[]>(c.env, "api_delete_post", [u.sub, id])) ?? []; const keys = media.map((x) => x.key).filter((k: unknown) => typeof k === "string") as string[];
      if (keys.length) c.ctx.waitUntil((async () => { await M.sbRemove(c.env, keys); for (const k of keys) if (k.startsWith("p/")) await M.mongo(c.env, "photo-del", { id: k.slice(2) }).catch(() => {}); await c.env.DB.prepare(`delete from media_index where owner = ? and key in (${keys.map(() => "?").join(",")})`).bind(u.sub, ...keys).run(); })());
      return json({ ok: true });
    }
    if (sub === "star" && (m === "PUT" || m === "DELETE")) { const a = await nv<string>(c.env, "api_set_star", [u.sub, id, m === "PUT"]); if (m === "PUT") notify(c, a, "post_like", u.sub, { postId: id }); return json({ ok: true }); }
    if (sub === "save" && (m === "PUT" || m === "DELETE")) { await N("api_set_save", [u.sub, id, m === "PUT"]); return json({ ok: true }); }
    if (sub === "rating" && (m === "PUT" || m === "DELETE")) {
      let stars: number | null = null;
      if (m === "PUT") { const b = await readJson(c.req, 256); if (typeof b.stars !== "number" || !Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) throw new HttpError(422, "stars_invalid"); stars = b.stars; }
      await N("api_rate", [u.sub, id, stars]); return json({ ok: true });
    }
    if (sub === "view" && m === "POST") { await N("api_view", [u.sub, id]); return json({ ok: true }); }
    if (sub === "comments" && m === "GET") return json({ items: await N("api_comments", [u.sub, id]) });
    if (sub === "comments" && m === "POST") {
      const b = await readJson(c.req, 4096); const cid = b.id === undefined ? crypto.randomUUID() : uuidOr(b.id, "id"); const body = str(b.body, 1, 1000, "body"); if (!body.trim()) throw new HttpError(422, "empty");
      const parent = optUuid(b.parentId, "parent");
      const r = await nv<{ created: boolean; post_author: string; parent_author: string | null }>(c.env, "api_add_comment", [u.sub, cid, id, parent, body]);
      if (r.created) { notify(c, r.post_author, "comment", u.sub, { postId: id }); if (r.parent_author && r.parent_author !== r.post_author) notify(c, r.parent_author, "reply", u.sub, { postId: id }); }
      return json({ id: cid, duplicate: !r.created }, r.created ? 201 : 200);
    }
    if (sub === "report" && m === "POST") {
      const b = await readJson(c.req, 2048);
      if (typeof b.reason !== "string" || !["spam", "kekerasan", "pelecehan", "ilegal", "lainnya"].includes(b.reason)) throw new HttpError(422, "reason_invalid");
      await N("api_report", [u.sub, id, b.reason, b.note === undefined || b.note === null ? null : str(b.note, 0, 500, "note")]); return json({ ok: true }, 201);
    }
  }
  const cm = /^\/api\/comments\/([0-9a-f-]{36})(\/like)?$/.exec(p);
  if (cm && UUID_RE.test(cm[1])) {
    const id = cm[1];
    if (cm[2] && (m === "PUT" || m === "DELETE")) { const a = await nv<string>(c.env, "api_like_comment", [u.sub, id, m === "PUT"]); if (m === "PUT") notify(c, a, "comment_like", u.sub); return json({ ok: true }); }
    if (!cm[2] && m === "PATCH") { const b = await readJson(c.req, 4096); await N("api_edit_comment", [u.sub, id, str(b.body, 1, 1000, "body")]); return json({ ok: true }); }
    if (!cm[2] && m === "DELETE") { await N("api_delete_comment", [u.sub, id]); return json({ ok: true }); }
  }
  const um = /^\/api\/users\/([^/]{3,20})(\/(posts|followers|following|relations|follow|block))?$/.exec(p);
  if (um) {
    const name = uname(um[1]), sub = um[3];
    if (!sub && m === "GET") { const r = await N("api_profile", [u.sub, name]); if (!r.length) throw new HttpError(404, "not_found"); return json(r[0]); }
    if (sub === "posts" && m === "GET") { const cur = parseCursor(c.url.searchParams.get("cursor")); const lim = intParam(c.url.searchParams.get("limit"), 20, 1, 30); const rows = await N("api_user_posts", [u.sub, name, cur?.ts ?? null, cur?.id ?? null, lim]); return json({ posts: rows, next: cursorOf(rows, lim) }); }
    if ((sub === "followers" || sub === "following") && m === "GET") { const cur = c.url.searchParams.get("cursor"); if (cur && !ISO_RE.test(cur)) throw new HttpError(400, "cursor"); const rows = await N("api_follow_list", [u.sub, name, sub, cur, 30]); return json({ items: rows, next: rows.length === 30 ? iso(rows[29].at) : null }); }
    if (sub === "relations" && m === "GET") return json({ items: await N("api_user_relations", [u.sub, name]) });
    if (sub === "follow" && (m === "PUT" || m === "DELETE")) { const t = await nv<string>(c.env, "api_follow", [u.sub, name, m === "PUT"]); if (m === "PUT") notify(c, t, "follow", u.sub); return json({ ok: true }); }
    if (sub === "block" && (m === "PUT" || m === "DELETE")) { await N("api_block", [u.sub, name, m === "PUT"]); return json({ ok: true }); }
  }
  if (m === "GET" && p === "/api/blocked") return json({ items: await N("api_blocked", [u.sub]) });
  if (m === "GET" && p === "/api/relations") return json({ items: await N("api_my_relations", [u.sub]) });
  if (m === "POST" && p === "/api/relations") {
    const b = await readJson(c.req, 1024); if (typeof b.username !== "string" || !["friend", "bestfriend", "partner", "family"].includes(b.kind as string)) throw new HttpError(422, "invalid");
    const r = await nv<{ id: string; target: string }>(c.env, "api_request_relation", [u.sub, uname(b.username), b.kind]); notify(c, r.target, "relation_request", u.sub); return json({ id: r.id }, 201);
  }
  const rm = /^\/api\/relations\/([0-9a-f-]{36})(\/approve)?$/.exec(p);
  if (rm && UUID_RE.test(rm[1])) {
    if (rm[2] && m === "POST") { const a = await nv<string>(c.env, "api_approve_relation", [u.sub, rm[1]]); notify(c, a, "relation_accepted", u.sub); return json({ ok: true }); }
    if (!rm[2] && m === "DELETE") { await N("api_remove_relation", [u.sub, rm[1]]); return json({ ok: true }); }
  }
  throw new HttpError(404, "not_found");
}

export default {
  async scheduled(_e: ScheduledController, env: Env, ctx: Ctx): Promise<void> {
    ctx.waitUntil((async () => {
      try { await nq(env, "api_purge", []); } catch { /* besok lagi */ }
      try { // berkas yang diunggah tapi tak pernah dipasang pada posting (>24 jam) → hapus
        const { results } = await env.DB.prepare("select key from media_index where status in ('pending','ready') and created_at < ? limit 200").bind(nowSec() - 86400).all<{ key: string }>();
        if (results.length) {
          const keys = results.map((r) => r.key); await M.sbRemove(env, keys);
          for (const k of keys) if (k.startsWith("p/")) await M.mongo(env, "photo-del", { id: k.slice(2) }).catch(() => {});
          await env.DB.prepare(`delete from media_index where status in ('pending','ready') and key in (${keys.map(() => "?").join(",")})`).bind(...keys).run();
        }
        await env.DB.prepare("delete from sessions where expires_at < ?").bind(nowSec()).run();
        await env.DB.prepare("delete from attempts where locked_until < ? and window_start < ?").bind(nowSec(), nowSec() - 86400).run();
      } catch { /* besok lagi */ }
    })());
  },
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url); const c: Req = { req, url, env, ctx, ip: req.headers.get("cf-connecting-ip") ?? "0.0.0.0" };
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return withSecurity(fail(405, "method"), null, []);
      const res = await env.ASSETS.fetch(req); const h = new Headers(res.headers); for (const [k, v] of Object.entries(webHeaders())) h.set(k, v);
      if ((h.get("content-type") ?? "").includes("text/html")) h.set("cache-control", "no-cache");
      return withSecurity(new Response(res.body, { status: res.status, headers: h }), null, []);
    }
    try { return withSecurity(await api(c), null, []); }
    catch (e) {
      if (e instanceof HttpError) return withSecurity(fail(e.status, e.code, e.status === 429 ? { "retry-after": "30" } : {}), null, []);
      console.error("unhandled", e instanceof Error ? e.message : String(e)); return withSecurity(fail(500, "internal"), null, []);
    }
  },
} satisfies ExportedHandler<Env>;
