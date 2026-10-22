import { LIMITS } from "@onym/shared";
import type { Env } from "../env";
import { fail } from "./http";

const enc = new TextEncoder();

async function hmacHex(env: Env, msg: string): Promise<string> {
  if (!env.MEDIA_SECRET || env.MEDIA_SECRET.length < 16) fail(500, "server_misconfigured");
  const key = await crypto.subtle.importKey("raw", enc.encode(env.MEDIA_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * URL media bertanda tangan: hanya diberikan kepada pemirsa yang boleh melihat post saat daftar dimuat, berlaku singkat.
 * Dengan begitu <img>/<video>/<audio> bekerja identik di web (cookie) dan aplikasi (token Bearer) tanpa mengirim kredensial.
 */
export async function signedMediaUrl(env: Env, mediaId: string): Promise<string> {
  const exp = Math.floor((Date.now() + LIMITS.mediaUrlTtlMs) / 60_000) * 60_000; // dibulatkan agar cache peramban efektif
  return `/api/media/${mediaId}?t=${exp}.${await hmacHex(env, `${mediaId}.${exp}`)}`;
}

export async function verifyMediaToken(env: Env, mediaId: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const m = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(token);
  if (!m || Number(m[1]) < Date.now()) return false;
  const want = await hmacHex(env, `${mediaId}.${m[1]}`);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= want.charCodeAt(i) ^ m[2]!.charCodeAt(i);
  return diff === 0;
}
