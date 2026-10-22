// Editor foto profil: geser untuk mengatur posisi, cubit/roda/penggeser untuk zoom, pratinjau langsung (besar & kecil).
// Warna foto TIDAK diubah: tanpa filter, tanpa latar putih; hasil PNG (transparansi tetap) bila muat, bila tidak WebP/JPEG kualitas tinggi.
import { t } from "./i18n.js";
import { h, icon, sheet } from "./ui.js";

const OUT = 640;           // sisi hasil (px)
const MAX_ZOOM = 6;        // × dari ukuran "isi penuh"

/**
 * src: Blob/File atau URL gambar. maxBytes: batas ukuran hasil.
 * Mengembalikan Promise<Blob|null> (null = dibatalkan).
 */
export function editAvatar(src, { maxBytes = 1_500_000 } = {}) {
  return new Promise((resolve) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const revoke = () => { if (typeof src !== "string") URL.revokeObjectURL(url); };
    const img = new Image();
    img.decoding = "async";
    let done = false;
    const finish = (v) => { if (done) return; done = true; revoke(); resolve(v); };
    img.onerror = () => finish(null);
    img.onload = () => open(img);
    img.src = url;

    function open(im) {
      const iw = im.naturalWidth, ih = im.naturalHeight;
      let V = 280;                                 // sisi panggung (px), diukur ulang setelah tampil
      let s = 1, cx = 0, cy = 0, fit = 1, cover = 1; // s = px layar per px asli; (cx,cy) = geseran dari tengah
      const stage = h("div", { class: "ae-stage" });
      const pic = h("img", { class: "ae-img", alt: "", draggable: "false" });
      pic.src = im.src;
      const mask = h("div", { class: "ae-mask" });
      stage.append(pic, mask);
      const range = h("input", { class: "ae-range", type: "range", min: "0", max: "1000", value: "0", "aria-label": t("avatar.zoom") });
      const big = h("canvas", { class: "ae-prev big", width: "88", height: "88" });
      const small = h("canvas", { class: "ae-prev small", width: "40", height: "40" });
      const save = h("button", { class: "btn primary grow", type: "button" }, t("common.save"));
      const cancel = h("button", { class: "btn ghost", type: "button" }, t("common.cancel"));
      const reset = h("button", { class: "link-btn", type: "button" }, t("avatar.reset"));
      const body = h("div", { class: "ae" },
        h("p", { class: "ae-hint" }, t("avatar.hint")),
        stage,
        h("div", { class: "ae-zoom" }, icon("image", 16), range, icon("image", 24)),
        h("div", { class: "ae-previews" }, big, small, h("span", { class: "muted" }, t("avatar.preview"))),
        h("div", { class: "row-btns" }, cancel, save),
        reset);
      let saved = false;
      const sh = sheet({ title: t("avatar.title"), content: body, onClose: () => { if (!saved) finish(null); } });

      const clamp = () => {
        const w = iw * s, hh = ih * s;
        const mx = Math.max(0, (w - V) / 2), my = Math.max(0, (hh - V) / 2);
        cx = Math.min(mx, Math.max(-mx, cx)); cy = Math.min(my, Math.max(-my, cy));
      };
      const sliderToScale = (v) => fit + (cover * MAX_ZOOM - fit) * (v / 1000);
      const scaleToSlider = (sc) => Math.round(((sc - fit) / Math.max(1e-6, cover * MAX_ZOOM - fit)) * 1000);
      const drawPrev = (cv) => {
        const c = cv.getContext("2d"), n = cv.width, k = n / V;
        c.clearRect(0, 0, n, n); c.save(); c.beginPath(); c.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); c.clip();
        c.imageSmoothingQuality = "high";
        c.drawImage(im, n / 2 + cx * k - (iw * s * k) / 2, n / 2 + cy * k - (ih * s * k) / 2, iw * s * k, ih * s * k); c.restore();
      };
      const apply = () => {
        clamp();
        pic.style.setProperty("width", `${iw}px`); pic.style.setProperty("height", `${ih}px`);
        pic.style.setProperty("transform", `translate(-50%, -50%) translate(${cx}px, ${cy}px) scale(${s})`);
        range.value = String(Math.min(1000, Math.max(0, scaleToSlider(s))));
        drawPrev(big); drawPrev(small);
      };
      const measure = () => {
        V = stage.clientWidth || 280;
        fit = Math.min(V / iw, V / ih);         // seluruh foto terlihat
        cover = Math.max(V / iw, V / ih);       // memenuhi lingkaran
      };
      const init = () => { measure(); s = cover; cx = 0; cy = 0; apply(); };
      requestAnimationFrame(() => requestAnimationFrame(init));
      reset.addEventListener("click", init);
      range.addEventListener("input", () => { s = sliderToScale(Number(range.value)); apply(); });

      // geser + cubit + roda
      const ptrs = new Map(); let pinch = null, drag = null;
      stage.addEventListener("pointerdown", (e) => {
        stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s }; drag = null; }
        else drag = { sx: e.clientX, sy: e.clientY, ox: cx, oy: cy };
      });
      stage.addEventListener("pointermove", (e) => {
        if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; s = Math.min(cover * MAX_ZOOM, Math.max(fit, pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d))); apply(); return; }
        if (drag) { cx = drag.ox + (e.clientX - drag.sx); cy = drag.oy + (e.clientY - drag.sy); apply(); }
      });
      const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (ptrs.size === 1) { const [p] = [...ptrs.values()]; drag = { sx: p.x, sy: p.y, ox: cx, oy: cy }; } else if (!ptrs.size) drag = null; };
      stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
      stage.addEventListener("wheel", (e) => { e.preventDefault(); s = Math.min(cover * MAX_ZOOM, Math.max(fit, s * Math.exp(-e.deltaY * 0.002))); apply(); }, { passive: false });

      cancel.addEventListener("click", () => sh.close());
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          const k = OUT / V, c = document.createElement("canvas"); c.width = OUT; c.height = OUT;
          const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high";
          ctx.drawImage(im, OUT / 2 + cx * k - (iw * s * k) / 2, OUT / 2 + cy * k - (ih * s * k) / 2, iw * s * k, ih * s * k); // tanpa latar putih, tanpa filter
          const enc = (type, q) => new Promise((r) => c.toBlob(r, type, q));
          let blob = await enc("image/png");
          if (!blob || blob.size > maxBytes) blob = await enc("image/webp", 0.95);
          if (!blob || blob.size > maxBytes) blob = await enc("image/jpeg", 0.92);
          saved = true; sh.close(); finish(blob || null);
        } catch { save.disabled = false; }
      });
    }
  });
}
