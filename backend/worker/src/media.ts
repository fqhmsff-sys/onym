// Penyimpanan berkas: video & audio → Supabase Storage (privat, URL bertanda tangan) · foto posting → MongoDB (GridFS, lewat gateway) ·
// foto profil → D1 · semua dicatat di D1 media_index (kepemilikan, kuota, pembersihan).
import { b64, hex, hmac, safeEqual, unb64 } from "./crypto";
import { HttpError } from "./http";

export interface MediaEnv {
  DB: D1Database; SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_KEY: string; INTERNAL_SECRET: string; JWT_SECRET: string;
}

export const KEY_PHOTO = /^p\/[0-9a-f]{24}$/;
export const keyVideo = (uid: string) => new RegExp(`^v/${uid}/[0-9a-f-]{36}\\.mp4$`);
export const keyAudio = (uid: string) => new RegExp(`^a/${uid}/[0-9a-f-]{36}\\.(m4a|mp3|ogg|webm)$`);
export const ANY_KEY = /^(p\/[0-9a-f]{24}|[va]\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|m4a|mp3|ogg|webm))$/;

export const LIMITS = {
  photoMax: 900 * 1024, avatarMax: 90 * 1024, fileMax: 50 * 1024 * 1024,
  userPhotoBytes: 60 * 1024 * 1024, userFileBytes: 250 * 1024 * 1024,
  globalPhotoBytes: 400 * 1024 * 1024,   // MongoDB M0 = 512 MB → sisakan ruang untuk linimasa/notifikasi
  globalFileBytes: 900 * 1024 * 1024,    // Supabase Free = 1 GB
};
export const FILE_TYPES: Record<string, { kind: "video" | "audio"; mime: string }> = {
  mp4: { kind: "video", mime: "video/mp4" }, m4a: { kind: "audio", mime: "audio/mp4" }, mp3: { kind: "audio", mime: "audio/mpeg" }, ogg: { kind: "audio", mime: "audio/ogg" }, webm: { kind: "audio", mime: "audio/webm" },
};

export function sniff(ext: string, b: Uint8Array): boolean {
  const at = (o: number, s: string) => [...s].every((ch, i) => b[o + i] === ch.charCodeAt(0));
  switch (ext) {
    case "jpg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "png": return b[0] === 0x89 && at(1, "PNG");
    case "webp": return at(0, "RIFF") && at(8, "WEBP");
    case "mp4": case "m4a": return at(4, "ftyp");
    case "mp3": return at(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case "ogg": return at(0, "OggS");
    case "webm": return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    default: return false;
  }
}
export const imageExt = (b: Uint8Array): string | null => (sniff("jpg", b) ? "jpg" : sniff("png", b) ? "png" : sniff("webp", b) ? "webp" : null);
export const imageMime = (e: string) => (e === "jpg" ? "image/jpeg" : `image/${e}`);

// ---------------------------------------------------------------- Kuota (D1)
export async function usage(env: MediaEnv, owner?: string): Promise<{ photo: number; file: number }> {
  const q = owner
    ? env.DB.prepare("select coalesce(sum(case when key like 'p/%' then size end), 0) as photo, coalesce(sum(case when key not like 'p/%' then size end), 0) as file from media_index where owner = ?").bind(owner)
    : env.DB.prepare("select coalesce(sum(case when key like 'p/%' then size end), 0) as photo, coalesce(sum(case when key not like 'p/%' then size end), 0) as file from media_index");
  return (await q.first<{ photo: number; file: number }>()) ?? { photo: 0, file: 0 };
}
export async function reserve(env: MediaEnv, owner: string, key: string, size: number, mime: string, status: "pending" | "ready") {
  await env.DB.prepare("insert into media_index (key, owner, size, mime, status, created_at) values (?, ?, ?, ?, ?, ?)").bind(key, owner, size, mime, status, Math.floor(Date.now() / 1000)).run();
}

// ---------------------------------------------------------------- Supabase Storage (kunci layanan hanya ada di Worker)
const sbHeaders = (env: MediaEnv) => ({ apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` });
const sbUrl = (env: MediaEnv, p: string) => `${env.SUPABASE_URL}/storage/v1${p}`;
export async function sbSignUpload(env: MediaEnv, key: string): Promise<string> {
  const r = await fetch(sbUrl(env, `/object/upload/sign/media/${key}`), { method: "POST", headers: { ...sbHeaders(env), "content-type": "application/json", "x-upsert": "false" }, body: "{}", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(502, "upstream");
  const j = (await r.json()) as { url?: string }; if (!j.url) throw new HttpError(502, "upstream");
  return sbUrl(env, j.url);
}
export async function sbSignRead(env: MediaEnv, keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const r = await fetch(sbUrl(env, "/object/sign/media"), { method: "POST", headers: { ...sbHeaders(env), "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 3600, paths: keys }), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(502, "upstream");
  const out: Record<string, string> = {};
  for (const x of (await r.json()) as { path?: string; signedURL?: string; error?: string }[]) if (x.path && x.signedURL && !x.error) out[x.path] = sbUrl(env, x.signedURL);
  return out;
}
/** Satu permintaan Range: ukuran total berkas (dari Content-Range) + 16 byte pertama (untuk cek isi). null = belum ada. */
export async function sbProbe(env: MediaEnv, key: string): Promise<{ size: number; head: Uint8Array } | null> {
  const r = await fetch(sbUrl(env, `/object/media/${key}`), { headers: { ...sbHeaders(env), range: "bytes=0-15" }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok && r.status !== 206) throw new HttpError(502, "upstream");
  const buf = new Uint8Array(await r.arrayBuffer());
  const m = /\/(\d+)$/.exec(r.headers.get("content-range") ?? "");
  const size = m ? Number(m[1]) : r.status === 200 ? Number(r.headers.get("content-length") ?? buf.length) : NaN;
  if (!Number.isFinite(size)) throw new HttpError(502, "upstream");
  return { size, head: buf.slice(0, 16) };
}
export async function sbRemove(env: MediaEnv, keys: string[]): Promise<void> {
  const k = keys.filter((x) => !x.startsWith("p/")); if (!k.length) return;
  await fetch(sbUrl(env, "/object/media"), { method: "DELETE", headers: { ...sbHeaders(env), "content-type": "application/json" }, body: JSON.stringify({ prefixes: k }), signal: AbortSignal.timeout(8000) }).catch(() => {});
}

// ---------------------------------------------------------------- MongoDB (lewat gateway Edge Function; rahasia bersama)
export async function mongo(env: MediaEnv, op: string, q: Record<string, string> = {}, body?: BodyInit, headers: Record<string, string> = {}, method = "POST"): Promise<Response> {
  const u = new URL(`${env.SUPABASE_URL}/functions/v1/mongo`); u.searchParams.set("op", op); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return fetch(u, { method, headers: { "x-internal-secret": env.INTERNAL_SECRET, apikey: env.SUPABASE_ANON_KEY, ...headers }, body, signal: AbortSignal.timeout(12000) });
}
export async function mongoJson(env: MediaEnv, op: string, q: Record<string, string> = {}, body?: unknown, method = "POST"): Promise<any> {
  const r = await mongo(env, op, q, body === undefined ? undefined : JSON.stringify(body), { "content-type": "application/json" }, method);
  if (!r.ok) throw new HttpError(502, "upstream"); return r.json();
}

// ---------------------------------------------------------------- URL bertanda tangan untuk foto (HMAC, tanpa DB)
const photoKey = (env: MediaEnv) => hmac(env.JWT_SECRET, "media-v1");
export async function signPhoto(env: MediaEnv, id: string, ttlSec = 3600): Promise<{ url: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec; const s = hex((await hmac(await photoKey(env), `${id}.${exp}`)).slice(0, 16));
  return { url: `/api/photo/${id}?e=${exp}&s=${s}`, exp };
}
export async function verifyPhoto(env: MediaEnv, id: string, e: string | null, s: string | null): Promise<boolean> {
  if (!e || !s || !/^\d{10}$/.test(e) || Number(e) < Date.now() / 1000) return false;
  return safeEqual(hex((await hmac(await photoKey(env), `${id}.${e}`)).slice(0, 16)), s);
}
export { b64, unb64 };
