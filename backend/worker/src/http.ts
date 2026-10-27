// Utilitas HTTP: respons aman, validasi masukan, pembacaan badan dengan batas ukuran.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message?: string) { super(message ?? code); this.status = status; this.code = code; }
}

const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-site",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}
export const fail = (status: number, code: string, extra: Record<string, string> = {}) => json({ error: code }, status, extra);

export function withSecurity(res: Response, origin: string | null, allowed: string[]): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) if (!h.has(k)) h.set(k, v);
  if (origin && allowed.includes(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("vary", "Origin");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** Baca JSON dengan batas ukuran KETAT (juga untuk body tanpa Content-Length). */
export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) throw new HttpError(415, "unsupported_media_type");
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "too_large");
  if (!req.body) throw new HttpError(400, "empty");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new HttpError(413, "too_large"); }
    chunks.push(value);
  }
  const buf = new Uint8Array(total); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf));
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v as Record<string, unknown>;
  } catch { throw new HttpError(400, "bad_json"); }
}

export function str(v: unknown, min: number, max: number, field: string): string {
  if (typeof v !== "string") throw new HttpError(422, `${field}_invalid`);
  const s = v.normalize("NFC");
  if (s.length < min || s.length > max) throw new HttpError(422, `${field}_length`);
  // tolak karakter kontrol selain \n \t, dan pemisah arah teks (trojan-source)
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(s)) throw new HttpError(422, `${field}_chars`);
  return s;
}

export function parseCursor(raw: string | null): { ts: string; id: string | null } | null {
  if (!raw) return null;
  const [ts, id] = raw.split("_");
  if (!ts || !ISO_RE.test(ts) || Number.isNaN(Date.parse(ts))) throw new HttpError(400, "cursor");
  if (id !== undefined && !UUID_RE.test(id)) throw new HttpError(400, "cursor");
  return { ts, id: id ?? null };
}

export function intParam(raw: string | null, def: number, min: number, max: number): number {
  const n = raw === null ? def : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new HttpError(400, "param");
  return Math.min(Math.max(n, min), max);
}
