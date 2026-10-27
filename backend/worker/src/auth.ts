// Sistem akun Onym (milik sendiri): kata sandi diolah di PERANGKAT (PBKDF2-SHA256 600.000 putaran) → server hanya menerima kunci-turunan
// 32 byte dan menyimpan HMAC(pepper, kunci) sebagai verifier. Sesi, batas login, dan akun ada di Cloudflare D1.
import { b64, hex, hmac, randomBytes, safeEqual, sha256hex, signJwt, unb64, unb64u, b64u } from "./crypto";
import { HttpError } from "./http";

export interface AuthEnv { DB: D1Database; AUTH_PEPPER: string; JWT_SECRET: string }
export const ACCESS_TTL = 15 * 60, REFRESH_TTL = 60 * 86400, KDF_ITER = 600_000;
const USER_RE = /^[a-z0-9_]{3,20}$/;
const now = () => Math.floor(Date.now() / 1000);

export interface Tokens { access: string; refresh: string; expiresIn: number }
export interface Account { id: string; username: string; salt: string; verifier: string; recovery: string; banned_until: number | null }

// ---------------------------------------------------------------- batas percobaan (D1)
export async function checkLock(env: AuthEnv, k: string): Promise<void> {
  const r = await env.DB.prepare("select locked_until from attempts where k = ?").bind(k).first<{ locked_until: number }>();
  if (r && r.locked_until > now()) throw new HttpError(429, "locked");
}
export async function hit(env: AuthEnv, k: string, max: number, windowSec: number, lockSec: number): Promise<void> {
  const t = now();
  await env.DB.prepare(
    "insert into attempts (k, n, window_start, locked_until) values (?1, 1, ?2, 0) on conflict(k) do update set " +
    "n = case when ?2 - window_start > ?3 then 1 else n + 1 end, window_start = case when ?2 - window_start > ?3 then ?2 else window_start end, " +
    "locked_until = case when (case when ?2 - window_start > ?3 then 1 else n + 1 end) >= ?4 then ?2 + ?5 else locked_until end"
  ).bind(k, t, windowSec, max, lockSec).run();
}
export const clearHits = (env: AuthEnv, k: string) => env.DB.prepare("delete from attempts where k = ?").bind(k).run();

// ---------------------------------------------------------------- verifier & salt palsu (anti-enumerasi nama pengguna)
export const makeVerifier = async (env: AuthEnv, key: Uint8Array) => b64(await hmac(env.AUTH_PEPPER, key));
export async function saltFor(env: AuthEnv, username: string): Promise<string> {
  const a = await env.DB.prepare("select salt from accounts where username = ?").bind(username).first<{ salt: string }>();
  if (a) return a.salt;
  return b64((await hmac(env.AUTH_PEPPER, "salt:" + username)).slice(0, 16)); // deterministik: akun tak ada tampak sama
}

export function parseKey(v: unknown, bytes: number, field: string): Uint8Array {
  if (typeof v !== "string" || v.length > 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) throw new HttpError(422, `${field}_invalid`);
  const u = unb64(v); if (u.length !== bytes) throw new HttpError(422, `${field}_invalid`); return u;
}
export function parseUsername(v: unknown): string {
  if (typeof v !== "string") throw new HttpError(422, "username_invalid");
  const u = v.trim().toLowerCase(); if (!USER_RE.test(u)) throw new HttpError(422, "username_invalid"); return u;
}

// ---------------------------------------------------------------- kode pemulihan
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa huruf/angka yang mirip
export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => { const b = randomBytes(12); const c = [...b].map((x) => ALPHA[x % 32]).join(""); return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`; });
}
export const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashCodes = async (codes: string[]) => JSON.stringify(await Promise.all(codes.map((c) => sha256hex(normCode(c)))));

// ---------------------------------------------------------------- sesi
export async function issue(env: AuthEnv, userId: string, ua: string | null, family?: string): Promise<Tokens> {
  const sid = crypto.randomUUID(); const refresh = b64u(randomBytes(32)); const t = now();
  await env.DB.prepare("insert into sessions (id, user_id, token_hash, family, expires_at, created_at, last_used, ua) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(sid, userId, await sha256hex(refresh), family ?? sid, t + REFRESH_TTL, t, t, (ua ?? "").slice(0, 120)).run();
  return { access: await signJwt(env.JWT_SECRET, { sub: userId, sid }, ACCESS_TTL), refresh, expiresIn: ACCESS_TTL };
}

export async function getAccountById(env: AuthEnv, id: string): Promise<Account | null> {
  return (await env.DB.prepare("select id, username, salt, verifier, recovery, banned_until from accounts where id = ?").bind(id).first<Account>()) ?? null;
}
export async function assertNotBanned(env: AuthEnv, id: string): Promise<void> {
  const a = await env.DB.prepare("select banned_until from accounts where id = ?").bind(id).first<{ banned_until: number | null }>();
  if (!a) throw new HttpError(401, "unauthorized");
  if (a.banned_until && a.banned_until > now()) throw new HttpError(403, "banned");
}

export async function refresh(env: AuthEnv, token: unknown, ua: string | null): Promise<Tokens & { userId: string }> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new HttpError(401, "unauthorized");
  const h = await sha256hex(token);
  const s = await env.DB.prepare("select id, user_id, family, used, expires_at, last_used from sessions where token_hash = ?").bind(h).first<{ id: string; user_id: string; family: string; used: number; expires_at: number; last_used: number }>();
  if (!s || s.expires_at < now()) throw new HttpError(401, "unauthorized");
  if (s.used) { // token lama dipakai lagi: lonjakan wajar (dua tab) diberi jeda 10 dtk; selain itu anggap dicuri → cabut seluruh keluarga
    if (now() - s.last_used > 10) await env.DB.prepare("delete from sessions where family = ?").bind(s.family).run();
    throw new HttpError(401, "unauthorized");
  }
  const upd = await env.DB.prepare("update sessions set used = 1, last_used = ? where id = ? and used = 0").bind(now(), s.id).run();
  if ((upd.meta?.changes ?? 0) !== 1) throw new HttpError(401, "unauthorized");
  await assertNotBanned(env, s.user_id);
  const t = await issue(env, s.user_id, ua, s.family);
  return { ...t, userId: s.user_id };
}
export const logout = async (env: AuthEnv, token: unknown) => { if (typeof token === "string") await env.DB.prepare("delete from sessions where token_hash = ?").bind(await sha256hex(token)).run(); };
export const revokeAll = (env: AuthEnv, userId: string, exceptSid?: string) =>
  exceptSid ? env.DB.prepare("delete from sessions where user_id = ? and id <> ?").bind(userId, exceptSid).run() : env.DB.prepare("delete from sessions where user_id = ?").bind(userId).run();

// ---------------------------------------------------------------- alur akun
export async function createAccount(env: AuthEnv, id: string, username: string, salt: Uint8Array, key: Uint8Array): Promise<string[]> {
  const codes = newRecoveryCodes();
  try {
    await env.DB.prepare("insert into accounts (id, username, salt, verifier, recovery) values (?, ?, ?, ?, ?)").bind(id, username, b64(salt), await makeVerifier(env, key), await hashCodes(codes)).run();
  } catch (e) { if (String((e as Error).message).includes("UNIQUE")) throw new HttpError(409, "conflict"); throw e; }
  return codes;
}
export const dropAccount = (env: AuthEnv, id: string) => env.DB.prepare("delete from accounts where id = ?").bind(id).run();

export async function verifyLogin(env: AuthEnv, username: string, key: Uint8Array): Promise<Account> {
  const a = await env.DB.prepare("select id, username, salt, verifier, recovery, banned_until from accounts where username = ?").bind(username).first<Account>();
  const expected = a ? a.verifier : b64(new Uint8Array(32)); // selalu hitung → waktu respons sama
  const ok = safeEqual(await makeVerifier(env, key), expected);
  if (!a || !ok) throw new HttpError(401, "invalid_credentials");
  if (a.banned_until && a.banned_until > now()) throw new HttpError(403, "banned");
  return a;
}

export async function recover(env: AuthEnv, username: string, code: string, salt: Uint8Array, key: Uint8Array): Promise<{ id: string; codes: string[] }> {
  const a = await env.DB.prepare("select id, recovery, banned_until from accounts where username = ?").bind(username).first<{ id: string; recovery: string; banned_until: number | null }>();
  const h = await sha256hex(normCode(code));
  const list: string[] = a ? JSON.parse(a.recovery) : [];
  const okCode = list.some((x) => safeEqual(x, h));
  if (!a || !okCode) throw new HttpError(401, "invalid_code");
  if (a.banned_until && a.banned_until > now()) throw new HttpError(403, "banned");
  const codes = newRecoveryCodes();
  await env.DB.batch([
    env.DB.prepare("update accounts set salt = ?, verifier = ?, recovery = ? where id = ?").bind(b64(salt), await makeVerifier(env, key), await hashCodes(codes), a.id),
    env.DB.prepare("delete from sessions where user_id = ?").bind(a.id),
  ]);
  return { id: a.id, codes };
}

export async function changePassword(env: AuthEnv, userId: string, oldKey: Uint8Array, salt: Uint8Array, key: Uint8Array, keepSid: string): Promise<void> {
  const a = await getAccountById(env, userId); if (!a) throw new HttpError(401, "unauthorized");
  if (!safeEqual(await makeVerifier(env, oldKey), a.verifier)) throw new HttpError(401, "invalid_credentials");
  await env.DB.prepare("update accounts set salt = ?, verifier = ? where id = ?").bind(b64(salt), await makeVerifier(env, key), userId).run();
  await revokeAll(env, userId, keepSid);
}
export { hex, unb64u };
