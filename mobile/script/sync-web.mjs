// Menyalin web/ → mobile/www dan menulis config.js (alamat server). Kode web yang dipakai aplikasi sama persis dengan PWA.
import { cpSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../web"), dst = join(here, "../www");
const api = (process.env.ONYM_API_URL || "").replace(/\/$/, "");
// Mode lokal (web/js/localapi.js): seluruh backend berjalan di dalam aplikasi, jadi alamat server TIDAK wajib.
// Isi ONYM_API_URL hanya bila nanti beralih ke server sungguhan (apps/api).
if (api && !/^https:\/\/[^/\s]+$/.test(api)) {
  console.error("ONYM_API_URL harus alamat HTTPS tanpa garis miring akhir, mis. https://onym.namamu.workers.dev (atau kosongkan untuk mode lokal)");
  process.exit(1);
}
if (existsSync(dst)) rmSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
rmSync(join(dst, "sw.js"), { force: true }); // service worker hanya untuk web; aplikasi memuat berkas lokal
writeFileSync(join(dst, "config.js"), `// Dihasilkan oleh sync-web.mjs\nwindow.ONYM_CONFIG = { apiBase: ${JSON.stringify(api)}, webUrl: ${JSON.stringify(process.env.ONYM_WEB_URL || api || "")} };\n`);
// CSP ketat: tanpa wildcard https:. Bila memakai server sungguhan, HANYA asal API itu yang ditambahkan (mencegah kebocoran data lewat skrip tak dikenal).
if (api) {
  const idx = join(dst, "index.html"); let html = readFileSync(idx, "utf8");
  html = html.replace("img-src 'self' data: blob:;", `img-src 'self' data: blob: ${api};`).replace("media-src 'self' data: blob:;", `media-src 'self' data: blob: ${api};`).replace("connect-src 'self';", `connect-src 'self' ${api};`);
  writeFileSync(idx, html);
}
console.log("OK: web/ → mobile/www, API =", api);
