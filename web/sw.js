// Service worker Onym: cangkang aplikasi tersedia offline & terbuka instan; API & media TIDAK pernah di-cache (data selalu segar & privat).
// PENTING: naikkan VERSION setiap kali merilis berkas web baru (agar cache lama dibuang).
const VERSION = "onym-v3.14";
const SHELL = [
  "./", "index.html", "config.js", "theme-init.js", "manifest.webmanifest", "favicon.svg", "css/app.css", "js/api.js", "js/attach.js", "js/avatar-editor.js", "js/brand.js", "js/capture.js", "js/compose.js", "js/datepicker.js", "js/i18n.js", "js/localapi.js", "js/main.js", "js/media.js", "js/pages-auth.js", "js/pages-feed.js", "js/pages-misc.js", "js/pages-profile.js", "js/pages-settings.js", "js/post.js", "js/router.js", "js/session.js", "js/trim.js", "js/ui.js", "js/viewer.js", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  // cache: "reload" → ambil versi terbaru dari jaringan (lewati cache HTTP) agar cangkang baru utuh.
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isDoc = (req, url) => req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html") || url.pathname.endsWith("config.js") || url.pathname.endsWith("sw.js");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Hanya GET asal-sama, bukan API, dan BUKAN permintaan Range (video/audio) → tak pernah menyentuh media.
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || req.headers.has("range")) return;
  if (isDoc(req, url)) {
    // Halaman & konfigurasi: jaringan lebih dulu (selalu terbaru), cache sebagai cadangan offline.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
    return;
  }
  // JS/CSS/ikon: cache dulu → terbuka INSTAN (tanpa menunggu jaringan 25+ modul satu per satu); diperbarui diam-diam di latar.
  e.respondWith(caches.open(VERSION).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok && res.type === "basic") c.put(req, res.clone()); return res; });
    if (hit) { net.catch(() => {}); return hit; }
    return net.catch(() => caches.match("index.html"));
  })));
});
