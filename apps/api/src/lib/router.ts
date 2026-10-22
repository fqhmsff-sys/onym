import type { Env } from "../env";
import type { Auth } from "./auth";
import { authenticate } from "./auth";
import { HttpError, clientIp, fail, json } from "./http";

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  /** Selalu terisi pada rute `required`; mungkin null pada rute `optional`. */
  auth: Auth | null;
  ip: string;
  ec: ExecutionContext;
}
/** Ctx dengan auth dijamin ada. */
export type AuthedCtx = Ctx & { auth: Auth };

type Mode = "required" | "optional" | "none";
type Handler = (c: any) => Promise<Response> | Response;
interface Route { method: string; parts: string[]; mode: Mode; handler: Handler }

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, mode: "required", handler: (c: AuthedCtx) => Promise<Response> | Response): this;
  add(method: string, pattern: string, mode: "optional" | "none", handler: (c: Ctx) => Promise<Response> | Response): this;
  add(method: string, pattern: string, mode: Mode, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), mode, handler });
    return this;
  }

  async handle(req: Request, env: Env, ec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      const params = match(r.parts, parts);
      if (!params) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      try {
        let auth: Auth | null = null;
        if (r.mode !== "none") {
          auth = await authenticate(req, env);
          if (!auth && r.mode === "required") fail(401, "unauthorized");
          // Perlindungan CSRF untuk autentikasi cookie: tolak permintaan mengubah data lintas-situs.
          if (auth?.viaCookie && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            const origin = req.headers.get("origin");
            if (origin && originHost(origin) !== url.host) fail(403, "bad_origin");
            if (!origin && req.headers.get("sec-fetch-site") === "cross-site") fail(403, "bad_origin");
          }
        }
        return await r.handler({ req, env, url, params, auth, ip: clientIp(req), ec });
      } catch (e) {
        if (e instanceof HttpError) return json({ error: { code: e.code } }, e.status);
        console.error("unhandled", e);
        return json({ error: { code: "internal" } }, 500);
      }
    }
    return json({ error: { code: pathMatched ? "method_not_allowed" : "not_found" } }, pathMatched ? 405 : 404);
  }
}

/** Host dari header Origin; nilai tak valid (mis. "null" dari iframe tersandbox) → null sehingga permintaan ditolak 403, bukan galat 500. */
function originHost(origin: string): string | null {
  try { return new URL(origin).host; } catch { return null; }
}

function match(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p.startsWith(":")) {
      try { params[p.slice(1)] = decodeURIComponent(parts[i]!); } catch { return null; }
    } else if (p !== parts[i]) return null;
  }
  return params;
}
