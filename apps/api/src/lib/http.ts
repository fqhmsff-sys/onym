import type { Env } from "../env";

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function fail(status: number, code: string): never {
  throw new HttpError(status, code);
}

export async function readJson(req: Request, maxBytes = 32_768): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) fail(413, "body_too_large");
  const text = await req.text();
  if (text.length > maxBytes) fail(413, "body_too_large");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== "object" || Array.isArray(v)) fail(400, "bad_json");
    return v as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, "bad_json");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}

/**
 * Pembatas laju berbasis D1 (jendela tetap). SATU pernyataan UPSERT atomik: tanpa celah balapan baca-lalu-tulis
 * yang memungkinkan permintaan paralel melewati batas. Melempar 429 bila melewati batas.
 */
export async function rateLimit(env: Env, key: string, max: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END,
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END
     RETURNING count`,
  ).bind(key, now, windowMs).first<{ count: number }>();
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 24 * 3600_000).run();
  }
  if ((row?.count ?? 1) > max) fail(429, "rate_limited");
}

export async function clearRateLimit(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
}

export function encodeCursor(ts: number, id: string): string {
  return `${ts}_${id}`;
}
export function decodeCursor(raw: string | null): { ts: number; id: string } | null {
  if (!raw) return null;
  const m = /^(\d{1,16})_([A-Za-z0-9]{1,64})$/.exec(raw);
  if (!m) return fail(400, "bad_cursor");
  return { ts: Number(m[1]), id: m[2]! };
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}
