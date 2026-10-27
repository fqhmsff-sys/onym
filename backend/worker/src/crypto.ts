// Primitif kripto murah (aman untuk batas CPU Workers gratis): HMAC, SHA-256, acak, JWT HS256.
const enc = new TextEncoder();
export const b64 = (b: Uint8Array | ArrayBuffer): string => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s: string): Uint8Array => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export const b64u = (b: Uint8Array | ArrayBuffer): string => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string): Uint8Array => unb64(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
export const hex = (b: ArrayBuffer | Uint8Array): string => [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha256hex = async (s: string | Uint8Array): Promise<string> => hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));
export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

export async function hmac(key: string | Uint8Array, msg: string | Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof msg === "string" ? enc.encode(msg) : msg));
}
export function safeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const x = typeof a === "string" ? enc.encode(a) : a, y = typeof b === "string" ? enc.encode(b) : b;
  let r = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) r |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return r === 0;
}

export interface Claims { sub: string; sid: string; exp: number; token: string }

export async function signJwt(secret: string, payload: { sub: string; sid: string }, ttlSec: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))), p = b64u(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec, typ: "access" })));
  return `${h}.${p}.${b64u(await hmac(secret, `${h}.${p}`))}`;
}
export async function verifyJwt(secret: string, token: string): Promise<Claims | null> {
  if (token.length > 2048) return null;
  const parts = token.split("."); if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(unb64u(parts[0])));
    if (header.alg !== "HS256") return null;                                  // tidak pernah memercayai alg lain (none/RS256 …)
    if (!safeEqual(b64u(await hmac(secret, `${parts[0]}.${parts[1]}`)), parts[2])) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (p.typ !== "access" || typeof p.exp !== "number" || p.exp <= now) return null;
    if (typeof p.sub !== "string" || !/^[0-9a-f-]{36}$/.test(p.sub) || typeof p.sid !== "string") return null;
    return { sub: p.sub, sid: p.sid, exp: p.exp, token };
  } catch { return null; }
}
