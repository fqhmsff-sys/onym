// Pembantu UI: pembuat DOM aman (tanpa innerHTML untuk data pengguna), ikon, toast, sheet, dialog, avatar.
import { abs } from "./api.js";
import { t, lang } from "./i18n.js";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, String(sv));
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ------------------------------------------------------------------ Ikon (SVG statis tepercaya)
const P = {
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
  shuffle: '<path d="M3 7h3c4 0 5 10 9 10h6"/><path d="M3 17h3c1.6 0 2.6-1.3 3.5-3"/><path d="M13 9c.8-1.2 1.8-2 3-2h5"/><path d="m18 4 3 3-3 3"/><path d="m18 14 3 3-3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  star: '<path d="m12 3.5 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.9l6.1-.8z"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  share: '<path d="M12 15V4"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7h14v-7"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5 6.5-5s5.7 1.5 6.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14.5c2.6.2 4.2 1.7 4.7 4.5"/>',
  link: '<circle cx="8" cy="12" r="4.2"/><circle cx="16" cy="12" r="4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  camera: '<path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.6"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10 6a9 9 0 0 1 2-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.2 3.9M6.4 7.9A15 15 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  flip: '<path d="M4 9V6h3"/><path d="M20 15v3h-3"/><path d="M5.5 15.5A8 8 0 0 0 18 18M18.5 8.5A8 8 0 0 0 6 6"/>',
  flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  logout: '<path d="M10 4H5v16h5"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="16" r="2.2"/>',
  send: '<path d="M4 12 20 4l-4 16-4.5-6z"/><path d="m11.5 14 8-9"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  globe2: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
};
export function icon(name, size = 22, extra = "") {
  const s = h("span", { class: `ic ${extra}`.trim(), "aria-hidden": "true" });
  s.style.setProperty("--s", `${size}px`);
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ""}</svg>`; // statis, bukan input pengguna
  return s;
}

// ------------------------------------------------------------------ Waktu & angka
export function timeAgo(ts) {
  const diff = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang() === "en" ? "en" : "id", { numeric: "auto", style: "narrow" });
  const a = Math.abs(diff);
  if (a < 45) return t("time.now");
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (a < 7 * 86400) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(ts).toLocaleDateString(lang() === "en" ? "en" : "id-ID", { day: "numeric", month: "short", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
export function compact(n) {
  return new Intl.NumberFormat(lang() === "en" ? "en" : "id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
export const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ------------------------------------------------------------------ Avatar
const TONES = ["#3A3F4A", "#5B6472", "#7B8494", "#2A2E36", "#4B5563"];
export function avatar(user, size = 40, cls = "") {
  const el = h("span", { class: `avatar ${cls}`.trim() });
  el.style.setProperty("--s", `${size}px`);
  if (user?.avatarUrl) {
    const img = h("img", { src: abs(user.avatarUrl), alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => { img.remove(); fallback(); });
    el.append(img);
  } else fallback();
  function fallback() {
    const name = user?.displayName || user?.username || "?";
    let hsh = 0; for (const c of user?.id || name) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
    el.style.setProperty("--tone", TONES[hsh % TONES.length]);
    el.classList.add("avatar-fallback");
    el.append(h("span", null, [...name][0].toUpperCase()));
  }
  return el;
}

// ------------------------------------------------------------------ Toast
let toastHost;
export function toast(msg, kind = "info") {
  toastHost ||= document.body.appendChild(h("div", { class: "toasts", role: "status", "aria-live": "polite" }));
  const el = h("div", { class: `toast ${kind}` }, kind === "ok" ? icon("check", 18) : kind === "error" ? icon("info", 18) : null, h("span", null, msg));
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => { el.classList.remove("in"); el.classList.add("out"); setTimeout(() => el.remove(), 320); }, 2800);
}

// ------------------------------------------------------------------ Sheet (panel dari bawah) & dialog
const layers = () => document.getElementById("layers");
let openCount = 0;
export function sheet({ title, content, full = false, onClose, className = "" }) {
  const back = h("div", { class: "scrim" });
  const body = h("div", { class: "sheet-body" }, content);
  const closeBtn = h("button", { class: "icon-btn", "aria-label": t("common.close"), type: "button", onclick: () => api.close() }, icon("x", 20));
  const panel = h("div", { class: `sheet ${full ? "full" : ""} ${className}`.trim(), role: "dialog", "aria-modal": "true", "aria-label": title || "" },
    h("div", { class: "sheet-grab" }),
    title !== undefined ? h("div", { class: "sheet-head" }, h("h2", null, title), closeBtn) : null,
    body);
  const root = h("div", { class: "layer" }, back, panel);
  layers().append(root);
  openCount++; document.documentElement.classList.add("no-scroll");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("in")));
  let closed = false;
  const onKey = (e) => { if (e.key === "Escape") api.close(); };
  document.addEventListener("keydown", onKey);
  back.addEventListener("click", () => api.close());
  // seret ke bawah untuk menutup
  let sy = null, dy = 0;
  const grab = panel.querySelector(".sheet-grab");
  grab.addEventListener("pointerdown", (e) => { sy = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); panel.style.transition = "none"; });
  grab.addEventListener("pointermove", (e) => { if (sy === null) return; dy = Math.max(0, e.clientY - sy); panel.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (sy === null) return; sy = null; panel.style.transition = ""; panel.style.transform = ""; if (dy > 110) api.close(); };
  grab.addEventListener("pointerup", end); grab.addEventListener("pointercancel", end);
  const api = {
    el: panel, body,
    close(result) {
      if (closed) return; closed = true;
      document.removeEventListener("keydown", onKey);
      root.classList.remove("in"); root.classList.add("out");
      setTimeout(() => { root.remove(); if (--openCount === 0) document.documentElement.classList.remove("no-scroll"); }, 320);
      onClose?.(result);
    },
  };
  return api;
}

export function confirmDialog({ title, message, confirmText, cancelText, danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
    const s = sheet({
      title: undefined, className: "dialog", onClose: () => finish(false),
      content: h("div", { class: "dialog-body" },
        h("h3", null, title), message ? h("p", null, message) : null,
        h("div", { class: "row-btns" },
          h("button", { class: "btn ghost", type: "button", onclick: () => finish(false) }, cancelText || t("common.cancel")),
          h("button", { class: `btn ${danger ? "danger" : "primary"}`, type: "button", onclick: () => finish(true) }, confirmText || t("common.continue")))),
    });
  });
}

export function actionSheet(title, actions) {
  const s = sheet({
    title,
    content: h("div", { class: "menu" }, actions.filter(Boolean).map((a) =>
      h("button", { class: `menu-item ${a.danger ? "danger" : ""}`, type: "button", onclick: () => { s.close(); setTimeout(() => a.onClick?.(), 120); } },
        a.icon ? icon(a.icon, 20) : null, h("span", { class: "menu-text" }, h("b", null, a.label), a.hint ? h("small", null, a.hint) : null),
        a.check ? icon("check", 18, "menu-check") : null))),
  });
  return s;
}

/** Tombol dengan keadaan sibuk (spinner) selama tindakan async. */
export function busy(btn, fn) {
  return async (...a) => {
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add("loading");
    try { return await fn(...a); } finally { btn.disabled = false; btn.classList.remove("loading"); }
  };
}

export const skeletonCard = () => h("div", { class: "card skel" },
  h("div", { class: "skel-row" }, h("i", { class: "skel-c" }), h("div", { class: "skel-l" }, h("i"), h("i", { class: "short" }))),
  h("i", { class: "skel-b" }), h("i", { class: "skel-b short" }));

export function emptyState(iconName, title, hint, action) {
  return h("div", { class: "empty" }, h("div", { class: "empty-ic" }, icon(iconName, 30)), h("h3", null, title), hint ? h("p", null, hint) : null, action || null);
}

/** Muat berkas saat elemen mendekati layar (daftar tak berujung). */
export function infinite(sentinel, load) {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) load(); }, { rootMargin: "600px 0px" });
  io.observe(sentinel);
  return () => io.disconnect();
}
