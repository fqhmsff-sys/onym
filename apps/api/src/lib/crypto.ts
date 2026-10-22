const enc = new TextEncoder();

export const PBKDF2_ITERATIONS = 100_000; // batas maksimum PBKDF2 di Cloudflare Workers

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
export function randomToken(bytes = 32): string {
  return toB64(randomBytes(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
let lastMs = 0;
let seq = 0;
/**
 * ID 28 karakter heksadesimal yang naik monoton menurut waktu pembuatan (milidetik + urutan + acak).
 * Karena itu urutan ID cocok dengan urutan pembuatan dan layak jadi pemecah seri yang stabil.
 */
export function newId(): string {
  const now = Date.now();
  if (now > lastMs) { lastMs = now; seq = 0; } else seq++;
  const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
  const rnd = [...randomBytes(6)].map((b) => hex(b, 2)).join("");
  return hex(lastMs, 12) + hex(seq, 4) + rnd;
}

/**
 * Bilangan bulat acak seragam di [0, n) dari sumber kriptografis.
 * Memakai rejection sampling supaya tidak ada modulo bias.
 */
export function secureRandomInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError("n harus bilangan bulat 1..2^32");
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password.normalize("NFKC"), salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterStr || !saltB64 || !hashB64) return false;
  const got = await pbkdf2(password.normalize("NFKC"), fromB64(saltB64), Number(iterStr));
  return timingSafeEqual(got, fromB64(hashB64));
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? enc.encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Alfabet tanpa karakter yang mudah tertukar (0/O, 1/I/L).
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function newRecoveryCode(): string {
  let raw = "";
  for (let i = 0; i < 12; i++) raw += CODE_ALPHABET[secureRandomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
