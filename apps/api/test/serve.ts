// Server uji lokal (hanya untuk pengembangan/QA): menjalankan Worker yang sama dengan SQLite + R2 tiruan di memori.
// Jalankan: tsx test/serve.ts [port]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { handle } from "../src/index";
import { createEnv } from "./shim";

const port = Number(process.argv[2] ?? 8787);
const dist = join(import.meta.dirname, "../../../web");
const { env } = createEnv();
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };

env.ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    let p = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!p.startsWith(dist)) return new Response("forbidden", { status: 403 });
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(dist, "index.html"); // mode SPA
    return new Response(readFileSync(p), { headers: { "content-type": MIME[extname(p)] ?? "application/octet-stream" } });
  },
};

createServer(async (nreq, nres) => {
  const chunks: Buffer[] = [];
  for await (const c of nreq) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(nreq.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  headers.set("cf-connecting-ip", nreq.socket.remoteAddress ?? "127.0.0.1");
  const req = new Request(`http://${nreq.headers.host}${nreq.url}`, { method: nreq.method, headers, body: nreq.method === "GET" || nreq.method === "HEAD" ? undefined : body });
  const res = await handle(req, env, { waitUntil() {} } as ExecutionContext);
  const out: Record<string, string | string[]> = {};
  res.headers.forEach((v, k) => { out[k] = v; });
  const sc = res.headers.getSetCookie?.();
  if (sc?.length) out["set-cookie"] = sc;
  nres.writeHead(res.status, out);
  if (res.body) Readable.fromWeb(res.body as never).pipe(nres); else nres.end();
}).listen(port, () => console.log(`Onym uji lokal di http://localhost:${port}`));
