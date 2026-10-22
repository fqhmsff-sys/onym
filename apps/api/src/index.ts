import type { Env } from "./env";
import { json } from "./lib/http";
import { Router } from "./lib/router";
import { authRoutes } from "./routes/auth";
import { postRoutes } from "./routes/posts";
import { socialRoutes } from "./routes/social";

const router = new Router();
authRoutes(router);
postRoutes(router);
socialRoutes(router);

/** Asal yang boleh memanggil API lintas-situs: aplikasi Android/iOS (Capacitor) saja. Web memakai asal yang sama. */
const NATIVE_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost", "ionic://localhost"]);

const SECURITY: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "permissions-policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
};

/** CSP ketat untuk web: tanpa skrip/gaya inline, semua hanya dari asal sendiri. */
const WEB_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
  "media-src 'self' blob:", "connect-src 'self'", "font-src 'self'", "object-src 'none'",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "manifest-src 'self'", "worker-src 'self'",
].join("; ");

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export async function handle(req: Request, env: Env, ec: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    const cors: Record<string, string> = {};
    if (origin && NATIVE_ORIGINS.has(origin)) {
      cors["access-control-allow-origin"] = origin;
      cors["access-control-allow-headers"] = "authorization, content-type";
      cors["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
      cors["access-control-max-age"] = "86400";
      cors["vary"] = "origin";
    }
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...SECURITY, ...cors } });
    const res = await router.handle(req, env, ec);
    return withHeaders(res, { ...SECURITY, ...cors });
  }
  if (env.ASSETS) {
    const res = await env.ASSETS.fetch(req);
    const isSw = url.pathname === "/sw.js";
    return withHeaders(res, {
      ...SECURITY, "content-security-policy": WEB_CSP,
      ...(isSw || res.headers.get("content-type")?.includes("text/html") ? { "cache-control": "no-cache" } : {}),
    });
  }
  return json({ error: { code: "not_found" } }, 404);
}

export default { fetch: handle } satisfies { fetch: typeof handle };
