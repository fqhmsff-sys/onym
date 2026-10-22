// Pelihat foto layar penuh: zoom (cubit 2 jari, roda tetikus, ketuk 2x, tombol +/−), geser saat diperbesar,
// geser ke samping untuk foto lain, geser ke bawah untuk menutup. Foto TIDAK diubah/dipotong sama sekali.
import { abs } from "./api.js";
import { t } from "./i18n.js";
import { h, icon } from "./ui.js";

const MAX_SCALE = 8;

/** items: [{ url }] — start: indeks awal. */
export function openViewer(items, start = 0) {
  const list = items.filter((x) => x && x.url);
  if (!list.length) return null;
  let i = Math.min(Math.max(0, start), list.length - 1);
  let scale = 1, x = 0, y = 0;
  const preloaded = new Set();

  const img = h("img", { alt: "", draggable: "false" });
  const stage = h("div", { class: "vw-stage" }, img);
  const count = h("span", { class: "lb-count" });
  const prev = h("button", { class: "lb-nav prev", type: "button", "aria-label": t("common.prev") }, icon("back", 24));
  const next = h("button", { class: "lb-nav next", type: "button", "aria-label": t("common.next") }, icon("chevron", 24));
  const close = h("button", { class: "icon-btn lb-close", type: "button", "aria-label": t("common.close") }, icon("x", 22));
  const zIn = h("button", { class: "vw-btn", type: "button", "aria-label": t("viewer.zoomIn") }, "+");
  const zOut = h("button", { class: "vw-btn", type: "button", "aria-label": t("viewer.zoomOut") }, "−");
  const zReset = h("button", { class: "vw-btn vw-reset", type: "button", "aria-label": t("viewer.reset") }, "1×");
  const tools = h("div", { class: "vw-tools" }, zOut, zReset, zIn);
  const hint = h("div", { class: "vw-hint" }, t("viewer.hint"));
  const root = h("div", { class: "layer lightbox viewer" }, h("div", { class: "scrim" }), stage, count, close, list.length > 1 ? [prev, next] : null, tools, hint);
  document.getElementById("layers").append(root);
  document.documentElement.classList.add("no-scroll");
  requestAnimationFrame(() => root.classList.add("in"));
  setTimeout(() => hint.classList.add("gone"), 2600);

  const box = () => stage.getBoundingClientRect();
  const apply = (animate = false) => {
    img.style.setProperty("transition", animate ? "transform .25s cubic-bezier(.22,.8,.3,1)" : "none");
    img.style.setProperty("transform", `translate(${x}px, ${y}px) scale(${scale})`);
    root.classList.toggle("zoomed", scale > 1.01);
    zReset.textContent = `${Math.round(scale * 10) / 10}×`;
  };
  const clamp = () => {
    const b = box(), w = img.offsetWidth * scale, hh = img.offsetHeight * scale;
    const mx = Math.max(0, (w - b.width) / 2), my = Math.max(0, (hh - b.height) / 2);
    x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
  };
  /** Zoom ke skala baru dengan titik (cx, cy) (koordinat layar) tetap di tempatnya. */
  const zoomAt = (ns, cx, cy, animate = false) => {
    ns = Math.min(MAX_SCALE, Math.max(1, ns));
    const b = box(), ox = cx - (b.left + b.width / 2), oy = cy - (b.top + b.height / 2);
    x = ox - (ox - x) * (ns / scale); y = oy - (oy - y) * (ns / scale);
    scale = ns; if (scale <= 1.001) { scale = 1; x = 0; y = 0; }
    clamp(); apply(animate);
  };
  const center = () => { const b = box(); return [b.left + b.width / 2, b.top + b.height / 2]; };

  const show = (dir = 0) => {
    scale = 1; x = 0; y = 0; apply();
    img.classList.remove("swap-l", "swap-r"); void img.offsetWidth;
    img.src = abs(list[i].url);
    if (dir) img.classList.add(dir > 0 ? "swap-l" : "swap-r");
    count.textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
    prev.hidden = i === 0; next.hidden = i === list.length - 1;
    // Pramuat foto di kiri/kanan → geser ke foto lain langsung tampil, tanpa jeda.
    for (const k of [i + 1, i - 1]) if (list[k] && !preloaded.has(k)) { preloaded.add(k); const im = new Image(); im.decoding = "async"; im.src = abs(list[k].url); }
  };
  const go = (d) => { const j = i + d; if (j < 0 || j >= list.length) return; i = j; show(d); };
  const end = () => { document.removeEventListener("keydown", key); root.classList.remove("in"); root.classList.add("out"); setTimeout(() => { root.remove(); document.documentElement.classList.remove("no-scroll"); }, 280); };
  const key = (e) => {
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight") scale > 1 ? ((x -= 60), clamp(), apply(true)) : go(1);
    else if (e.key === "ArrowLeft") scale > 1 ? ((x += 60), clamp(), apply(true)) : go(-1);
    else if (e.key === "+" || e.key === "=") zoomAt(scale * 1.5, ...center(), true);
    else if (e.key === "-") zoomAt(scale / 1.5, ...center(), true);
    else if (e.key === "0") zoomAt(1, ...center(), true);
  };
  document.addEventListener("keydown", key);
  prev.addEventListener("click", () => go(-1)); next.addEventListener("click", () => go(1)); close.addEventListener("click", end);
  root.querySelector(".scrim").addEventListener("click", end);
  zIn.addEventListener("click", () => zoomAt(scale * 1.6, ...center(), true));
  zOut.addEventListener("click", () => zoomAt(scale / 1.6, ...center(), true));
  zReset.addEventListener("click", () => zoomAt(1, ...center(), true));
  stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(scale * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); }, { passive: false });

  // ---- Sentuhan / penunjuk: 1 jari = geser, 2 jari = cubit, ketuk 2x = zoom
  const ptrs = new Map();
  let pinch = null, drag = null, lastTap = 0, tapX = 0, tapY = 0, moved = false, swipe = null;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: scale }; drag = null; swipe = null;
    } else if (ptrs.size === 1) { drag = { sx: e.clientX, sy: e.clientY, ox: x, oy: y }; swipe = { x: e.clientX, y: e.clientY }; }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt(pinch.s * (d / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2); moved = true; return;
    }
    if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (scale > 1.01) { x = drag.ox + dx; y = drag.oy + dy; clamp(); apply(); }
      else if (moved) { img.style.setProperty("transition", "none"); img.style.setProperty("transform", `translate(${dx}px, ${Math.max(0, dy)}px) scale(${1 - Math.min(0.25, Math.max(0, dy) / 900)})`); }
    }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; if (ptrs.size === 1) { const [p] = [...ptrs.values()]; drag = { sx: p.x, sy: p.y, ox: x, oy: y }; swipe = null; } return; }
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; drag = null;
    if (!moved) { // ketuk (berlaku juga saat diperbesar → ketuk 2x untuk kembali)
      const now = performance.now();
      if (now - lastTap < 320 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 30) { lastTap = 0; zoomAt(scale > 1.01 ? 1 : 2.6, e.clientX, e.clientY, true); }
      else { lastTap = now; tapX = e.clientX; tapY = e.clientY; }
      return;
    }
    if (scale > 1.01) return;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { apply(true); go(dx < 0 ? 1 : -1); return; }
    if (dy > 110) { end(); return; }
    apply(true);
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); pinch = null; drag = null; apply(true); });
  // Ketuk sekali di area kosong (di luar foto) saat tidak diperbesar → tutup
  stage.addEventListener("click", (e) => { if (e.target === stage && scale <= 1.01 && !moved) end(); });
  window.addEventListener("resize", () => { clamp(); apply(); });
  show();
  return { close: end };
}
