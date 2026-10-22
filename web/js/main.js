// Titik masuk Onym: cangkang aplikasi, router dengan transisi halaman, layar muat, mode fokus.
import { api, isNative } from "./api.js";
import { openCompose } from "./compose.js";
import { setLang, t } from "./i18n.js";
import { pauseAll } from "./media.js";
import { feedPage, postPage, randomPage } from "./pages-feed.js";
import { loginPage, recoverPage, registerPage } from "./pages-auth.js";
import { aboutPage, notificationsPage, searchPage } from "./pages-misc.js";
import { followListPage, profilePage, relationsPage, userRelationsPage } from "./pages-profile.js";
import { settingsPage } from "./pages-settings.js";
import { mark, word } from "./brand.js";
import { back, go, here, nav, parentOf, state } from "./router.js";
import { onMe, refreshMe, applyTheme } from "./session.js";
import { avatar, emptyState, h, icon, toast } from "./ui.js";

const DEFAULT_CONFIG = { maxVideoMs: 10000, maxAudioMs: 180000, maxAudioBytes: 41943040, maxPhotos: 10, maxAudios: 10, maxVideoBytes: 67108864, maxPhotoBytes: 6291456, maxAvatarBytes: 307200, postMax: 500, commentMax: 500, minAge: 13 };
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } }; // %-encoding rusak tidak boleh merusak layar
const TAB_ROOTS = ["/", "/random", "/me"];
const AUTH_ROUTES = ["/login", "/register", "/recover"];
const NEEDS_LOGIN = (p) => p === "/me" || p === "/notifications" || p === "/relations" || p.startsWith("/settings");

// ------------------------------------------------------------------ Cangkang
let view, tabbar, topbar, fab, tabInd, bell, titleEl, backBtn, brand, searchBtn, tabEls = [], focusBtn;
function buildShell() {
  const app = document.getElementById("app");
  brand = h("a", { class: "brand", href: "#/", "aria-label": "Onym" }, mark("o-mark"), word("o-word"));
  backBtn = h("button", { class: "icon-btn back-btn", type: "button", "aria-label": t("common.back"), hidden: true, onclick: () => back(parentOf(here())) }, icon("back", 24));
  titleEl = h("div", { class: "top-title", hidden: true });
  searchBtn = h("a", { class: "icon-btn", href: "#/search", "aria-label": t("nav.search") }, icon("search", 22));
  const badge = h("i", { class: "dot-badge", hidden: true });
  bell = h("a", { class: "icon-btn bell", href: "#/notifications", "aria-label": t("nav.notifications") }, icon("bell", 22), badge);
  bell.badge = badge;
  topbar = h("header", { class: "topbar" }, backBtn, brand, titleEl, h("div", { class: "top-actions" }, searchBtn, bell));
  view = h("main", { id: "view", class: "view", tabindex: "-1" });
  const mk = (href, ic, label) => h("a", { class: "tab-link", href, "aria-label": label }, h("span", { class: "tab-ic" }, icon(ic, 24)), h("span", { class: "tab-lb" }, label));
  tabEls = [mk("#/", "home", t("nav.home")), mk("#/random", "shuffle", t("nav.random")), mk("#/me", "user", t("nav.profile"))];
  tabInd = h("i", { class: "tab-pill" });
  tabbar = h("nav", { class: "tabbar", "aria-label": "Navigasi" }, tabInd, ...tabEls);
  fab = h("button", { class: "fab", type: "button", "aria-label": t("compose.title"), onclick: () => openCompose({ onPosted: () => { if (here() !== "/") { go("/"); setTimeout(() => document.querySelector(".page.feed")?.refresh?.(), 480); } else document.querySelector(".page.feed")?.refresh?.(); } }) }, icon("plus", 26));
  focusBtn = buildFocus();
  app.replaceChildren(topbar, view, fab, tabbar, focusBtn);
  app.hidden = false;
  updateMe();
}
function buildFocus() {
  const b = h("button", { class: "focus-btn", type: "button", "aria-label": t("nav.focus"), "aria-pressed": "false" }, icon("eye", 20));
  let sx, sy, ox = 0, oy = 0, moved = false, drag = false;
  try { const p = JSON.parse(localStorage.getItem("hh_focus_pos") || "null"); if (p) { ox = p.x; oy = p.y; b.style.setProperty("transform", `translate(${ox}px, ${oy}px)`); } } catch { /* abaikan */ }
  b.addEventListener("pointerdown", (e) => { drag = true; moved = false; sx = e.clientX - ox; sy = e.clientY - oy; b.setPointerCapture(e.pointerId); });
  b.addEventListener("pointermove", (e) => { if (!drag) return; const nx = e.clientX - sx, ny = e.clientY - sy; if (Math.abs(nx - ox) + Math.abs(ny - oy) > 6) moved = true; if (moved) { ox = Math.max(-(innerWidth - 80), Math.min(0, nx)); oy = Math.max(-(innerHeight - 160), Math.min(0, ny)); b.style.setProperty("transform", `translate(${ox}px, ${oy}px)`); } });
  b.addEventListener("pointerup", () => { drag = false; if (moved) { try { localStorage.setItem("hh_focus_pos", JSON.stringify({ x: ox, y: oy })); } catch { /* abaikan */ } return; } const on = document.body.classList.toggle("focus"); b.setAttribute("aria-pressed", String(on)); b.replaceChildren(icon(on ? "eyeoff" : "eye", 20)); });
  return b;
}
function updateMe() {
  if (!bell) return;
  const m = state.me;
  const n = m ? m.unreadNotifications + m.pendingRelationRequests : 0;
  bell.badge.hidden = n === 0; bell.badge.textContent = n > 9 ? "9+" : String(n);
  bell.classList.toggle("has", n > 0);
  bell.hidden = !m;
  const meTab = tabEls[2];
  if (meTab) { const ic = meTab.querySelector(".tab-ic"); ic.replaceChildren(m ? avatar(m, 26, "tab-avatar") : icon("user", 24)); meTab.querySelector(".tab-lb").textContent = m ? t("nav.profile") : t("auth.login"); meTab.setAttribute("href", m ? "#/me" : "#/login"); }
}
onMe(updateMe);

function setChrome(path, { root, title, auth, quiet }) {
  document.body.classList.toggle("is-auth", auth);
  brand.hidden = !root; titleEl.hidden = root || !!quiet; backBtn.hidden = root;
  titleEl.textContent = quiet ? "" : title || ""; // halaman yang sudah punya judul besar (Pengaturan) tidak mengulang judul di bilah atas
  document.title = title ? `${title} · Onym` : "Onym";
  const idx = path === "/" ? 0 : path === "/random" ? 1 : path === "/me" || (state.me && path === `/u/${state.me.username}`) ? 2 : -1;
  tabbar.classList.toggle("none", idx < 0);
  tabEls.forEach((el, i) => { el.classList.toggle("on", i === idx); if (i === idx) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); });
  if (idx >= 0) requestAnimationFrame(() => { const el = tabEls[idx]; tabInd.style.setProperty("width", `${el.offsetWidth}px`); tabInd.style.setProperty("transform", `translateX(${el.offsetLeft}px)`); });
  fab.hidden = !state.me || !(path === "/" || idx === 2) || auth;
}

// ------------------------------------------------------------------ Router
const routes = [
  [/^\/$/, () => feedPage(), { root: true }],
  [/^\/random$/, () => randomPage(), { title: "nav.random", root: true }],
  [/^\/me$/, () => (state.me ? (go(`/u/${state.me.username}`), null) : (go("/login"), null)), {}],
  [/^\/u\/([^/]+)$/, (m) => profilePage({ username: dec(m[1]) }), { title: "", root: false }],
  [/^\/u\/([^/]+)\/(followers|following)$/, (m) => followListPage({ username: dec(m[1]), kind: m[2] }), { title: "" }],
  [/^\/u\/([^/]+)\/relations$/, (m) => userRelationsPage({ username: dec(m[1]) }), { title: "" }],
  [/^\/relations$/, () => relationsPage(), { title: "profile.relations" }],
  [/^\/notifications$/, () => notificationsPage(), { title: "notif.title" }],
  [/^\/search$/, () => searchPage(), { title: "nav.search" }],
  [/^\/settings$/, () => settingsPage({}), { title: "nav.settings", quiet: true }],
  [/^\/settings\/([a-z]+)$/, (m) => settingsPage({ section: m[1] }), { title: "nav.settings", quiet: true }],
  [/^\/about$/, () => aboutPage(), { title: "set.about" }],
  [/^\/p\/([0-9a-f]+)$/, (m) => postPage({ id: m[1] }), { title: "post.title" }],
  [/^\/login$/, () => loginPage(), { auth: true, title: "auth.login" }],
  [/^\/register$/, () => registerPage(), { auth: true, title: "auth.register" }],
  [/^\/recover$/, () => recoverPage(), { auth: true, title: "recover.title" }],
];

const stack = [], keep = new Map(), scrollAt = new Map();
let current = null, seq = 0, progress;

function startProgress() { progress ||= document.body.appendChild(h("div", { class: "progress" }, h("i"))); progress.classList.remove("done"); progress.classList.add("run"); }
function endProgress() { progress?.classList.add("done"); setTimeout(() => progress?.classList.remove("run", "done"), 380); }

async function render() {
  let path = here();
  if (!location.hash) { history.replaceState(null, "", "#/"); path = "/"; }
  if (current?.path === path && current.el?.isConnected) return;
  if (!state.me && NEEDS_LOGIN(path)) { go("/login"); return; }
  if (state.me && AUTH_ROUTES.includes(path)) { go("/"); return; }
  const my = ++seq;
  let match = null;
  for (const [re, fn, meta] of routes) { const m = re.exec(path); if (m) { match = { m, fn, meta }; break; } }

  const from = current?.path;
  let dir = "fade";
  if (from !== undefined) {
    const a = TAB_ROOTS.indexOf(from), b = TAB_ROOTS.indexOf(path);
    if (a >= 0 && b >= 0) dir = b > a ? "tab-r" : "tab-l";
    else if (stack.length > 1 && stack[stack.length - 2] === path) { dir = "back"; stack.pop(); nav.depth = Math.max(0, nav.depth - 1); }
    else { dir = "forward"; stack.push(path); nav.depth++; }
  } else stack.push(path);
  if (from === undefined || dir === "tab-r" || dir === "tab-l") { if (stack[stack.length - 1] !== path) stack.splice(0, stack.length, path); nav.depth = 0; }

  startProgress();
  pauseAll();
  if (current?.el) scrollAt.set(current.path, scrollY);
  let el;
  try {
    if (!match) el = emptyState("search", t("err.not_found"), null, h("a", { class: "btn ghost", href: "#/" }, t("nav.home")));
    else if (keep.has(path)) el = keep.get(path);
    else el = await match.fn(match.m);
  } catch (e) {
    console.error(e);
    el = h("div", { class: "page" }, emptyState("info", t("err.unknown"), null, h("button", { class: "btn ghost", type: "button", onclick: () => { current = null; render(); } }, icon("refresh", 18), t("common.retry"))));
  }
  if (my !== seq) { endProgress(); return; } // navigasi lain mendahului
  if (el === null) { endProgress(); return; }
  const meta = match?.meta || {};
  const old = current;
  const isTab = TAB_ROOTS.includes(path) || (state.me && path === `/u/${state.me.username}`);
  const titleKey = meta.title;
  setChrome(path, { root: !!meta.root || isTab && path === "/", title: titleKey ? t(titleKey) : path.startsWith("/u/") ? "@" + dec(path.split("/")[2]) : "", auth: !!meta.auth, quiet: !!meta.quiet });
  // transisi
  // Halaman yang disimpan (Beranda) bisa dipakai ulang: bersihkan sisa kelas keluar & batalkan pencopotan yang tertunda,
  // kalau tidak, ia tetap "page-out" (transparan, absolut) dan Beranda tampak kosong saat kembali.
  clearTimeout(el._rm); el._rm = null;
  el.className = el.className.split(/\s+/).filter((c) => c && c !== "page-out" && !c.startsWith("dir-") && c !== "page-in").join(" ");
  el.classList.add("page-in", `dir-${dir}`);
  view.append(el);
  if (old?.el && old.el !== el) {
    const oe = old.el; oe.classList.add("page-out", `dir-${dir}`);
    if (old.keep) { oe._rm = setTimeout(() => { oe.remove(); oe._rm = null; }, 260); } else { setTimeout(() => { oe.cleanup?.(); oe.remove(); }, 260); }
    if (old.keep) keep.set(old.path, oe);
  }
  current = { path, el, keep: !!el.keep };
  if (el.keep && !keep.has(path)) keep.set(path, el);
  requestAnimationFrame(() => { window.scrollTo(0, dir === "back" || keep.has(path) ? scrollAt.get(path) || 0 : 0); });
  setTimeout(() => el.classList.remove("page-in", `dir-${dir}`), 420);
  endProgress();
  if (dir !== "back") view.focus({ preventScroll: true });
}

window.addEventListener("hashchange", render);
// Halaman yang disimpan (Beranda) HANYA dibuang bila identitas akun benar-benar berganti (masuk/keluar/ganti akun).
// Dulu setiap penyegaran sesi (tiap 45 dtk / saat kembali ke aplikasi) ikut memanggil cleanup() yang MENGOSONGKAN daftar post → Beranda jadi kosong.
let lastMeId = undefined;
onMe((me) => {
  const id = me?.id ?? null;
  if (lastMeId !== undefined && id !== lastMeId) {
    keep.forEach((el) => { if (el !== current?.el) el.cleanup?.(); }); keep.clear();
    if (current?.el && current.keep) { current.el.cleanup?.(); current = null; render(); } // halaman aktif ikut dimuat ulang untuk akun baru
  }
  lastMeId = id;
  if (!me && current && NEEDS_LOGIN(current.path)) go("/login");
});

// ------------------------------------------------------------------ Boot
async function boot() {
  const started = performance.now();
  try { navigator.storage?.persist?.(); } catch { /* abaikan */ } // minta penyimpanan permanen agar media tidak dihapus peramban saat ruang menipis
  try { state.config = await api("/api/config"); } catch { state.config = DEFAULT_CONFIG; }
  state.config = { ...DEFAULT_CONFIG, ...state.config };
  await refreshMe();
  if (!state.me) { try { const l = localStorage.getItem("hh_lang"); if (l) setLang(l); } catch { /* abaikan */ } }
  buildShell();
  await render();
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "off";
  const wait = Math.max(0, (calm ? 500 : 2100) - (performance.now() - started)); // layar muat: cukup lama agar animasi logo + tulisan onym selesai terbaca
  setTimeout(() => { const s = document.getElementById("splash"); s.classList.add("hide"); setTimeout(() => s.remove(), 600); }, wait);
  // Segarkan lencana notifikasi saat aplikasi aktif.
  setInterval(() => { if (!document.hidden && state.me) refreshMe(); }, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me) refreshMe(); });
  // Ketuk tab aktif → ke atas / segarkan.
  tabbar.addEventListener("click", (e) => { const a = e.target.closest(".tab-link.on"); if (a && here() === "/") { current?.el?.refresh?.(); } else if (a) window.scrollTo({ top: 0, behavior: "smooth" }); });
  brand.addEventListener("click", () => { if (here() === "/") current?.el?.refresh?.(); });
}

if ("serviceWorker" in navigator && !isNative && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
void toast; void applyTheme;
boot().catch((e) => {
  console.error(e);
  document.getElementById("splash")?.classList.add("hide");
  const app = document.getElementById("app"); app.hidden = false;
  app.replaceChildren(h("div", { class: "page" }, emptyState("info", "Onym", "Tidak dapat memuat. Periksa koneksi lalu coba lagi.", h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Coba lagi"))));
});
