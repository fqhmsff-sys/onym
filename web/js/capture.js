// Kamera di dalam aplikasi/web: ambil foto atau rekam video (maks. durasi dari server, 10 dtk) langsung.
import { t } from "./i18n.js";
import { h, icon, toast, fmtDur } from "./ui.js";
import { pickMime } from "./media.js";

/** @returns {Promise<{file: File, kind: 'photo'|'video', durationMs: number} | null>} null bila dibatalkan. */
export function openCamera({ mode = "photo", maxVideoMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let facing = "environment", stream = null, rec = null, tickTimer = 0, startAt = 0, result = null, closed = false;
    const preview = h("video", { class: "cam-video", autoplay: "", playsinline: "", muted: "" });
    preview.muted = true;
    const shot = h("img", { class: "cam-shot", alt: "" });
    const rpreview = h("video", { class: "cam-shot", playsinline: "", loop: "", controls: "" });
    const ring = h("span", { class: "cam-ring" });
    ring.innerHTML = '<svg viewBox="0 0 100 100"><circle class="cam-ring-bg" cx="50" cy="50" r="46"/><circle class="cam-ring-fg" cx="50" cy="50" r="46" pathLength="100"/></svg>'; // statis
    const fg = ring.querySelector(".cam-ring-fg");
    const shutter = h("button", { class: "cam-shutter", type: "button", "aria-label": t("cam.shutter") }, ring, h("i", { class: "cam-core" }));
    const timer = h("div", { class: "cam-timer", hidden: true }, "0:00");
    const bPhoto = h("button", { class: "cam-mode", type: "button" }, t("cam.photo"));
    const bVideo = h("button", { class: "cam-mode", type: "button" }, t("cam.video"));
    const flip = h("button", { class: "icon-btn cam-flip", type: "button", "aria-label": t("cam.flip") }, icon("flip", 22));
    const close = h("button", { class: "icon-btn cam-close", type: "button", "aria-label": t("common.close") }, icon("x", 22));
    const retake = h("button", { class: "btn ghost light", type: "button" }, t("cam.retake"));
    const use = h("button", { class: "btn primary", type: "button" }, t("cam.use"));
    const hint = h("div", { class: "cam-hint" });
    const live = h("div", { class: "cam-live" }, preview, hint);
    const controls = h("div", { class: "cam-controls" }, h("div", { class: "cam-modes" }, bPhoto, bVideo), shutter);
    const review = h("div", { class: "cam-review", hidden: true }, h("div", { class: "cam-review-media" }, shot, rpreview), h("div", { class: "row-btns" }, retake, use));
    const root = h("div", { class: "layer camera" }, live, timer, flip, close, controls, review);
    document.getElementById("layers").append(root);
    document.documentElement.classList.add("no-scroll");
    requestAnimationFrame(() => root.classList.add("in"));

    const stopStream = () => { stream?.getTracks().forEach((x) => x.stop()); stream = null; };
    const finish = (val) => {
      if (closed) return; closed = true;
      clearInterval(tickTimer); try { if (rec && rec.state !== "inactive") { rec.ondataavailable = null; rec.onstop = null; rec.stop(); } } catch { /* abaikan */ }
      stopStream();
      if (result?.url) URL.revokeObjectURL(result.url);
      root.classList.remove("in"); root.classList.add("out");
      setTimeout(() => { root.remove(); document.documentElement.classList.remove("no-scroll"); }, 280);
      resolve(val);
    };

    async function start() {
      stopStream();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: mode === "video",
        });
      } catch (e) {
        toast(e?.name === "NotAllowedError" ? t("cam.denied") : t("cam.unavailable"), "error");
        finish(null); return;
      }
      preview.srcObject = stream;
      preview.classList.toggle("mirror", facing === "user");
      await preview.play().catch(() => {});
    }
    function setMode(m) {
      if (rec) return;
      const changed = m !== mode; mode = m;
      bPhoto.classList.toggle("on", m === "photo"); bVideo.classList.toggle("on", m === "video");
      root.dataset.mode = m;
      hint.textContent = m === "video" ? t("cam.hintVideo", { s: Math.round(maxVideoMs / 1000) }) : t("cam.hintPhoto");
      if (changed || !stream) start();
    }
    bPhoto.addEventListener("click", () => setMode("photo"));
    bVideo.addEventListener("click", () => setMode("video"));
    flip.addEventListener("click", () => { if (rec) return; facing = facing === "user" ? "environment" : "user"; start(); });
    close.addEventListener("click", () => finish(null));
    document.addEventListener("keydown", function esc(e) { if (closed) return document.removeEventListener("keydown", esc); if (e.key === "Escape") finish(null); });

    function showReview(kind, blobOrFile, durationMs) {
      stopStream();
      const url = URL.createObjectURL(blobOrFile);
      result = { kind, file: blobOrFile, durationMs, url };
      root.classList.add("reviewing");
      review.hidden = false; live.hidden = true; controls.hidden = true; flip.hidden = true;
      shot.hidden = kind !== "photo"; rpreview.hidden = kind !== "video";
      if (kind === "photo") shot.src = url; else { rpreview.src = url; rpreview.play().catch(() => {}); }
    }
    retake.addEventListener("click", () => {
      if (result?.url) URL.revokeObjectURL(result.url);
      result = null; review.hidden = true; live.hidden = false; controls.hidden = false; flip.hidden = false; root.classList.remove("reviewing");
      rpreview.removeAttribute("src"); fg.style.setProperty("stroke-dashoffset", "100");
      start();
    });
    use.addEventListener("click", () => { const r = result; result = null; finish({ file: r.file, kind: r.kind, durationMs: r.durationMs }); });

    function takePhoto() {
      const vw = preview.videoWidth, vh = preview.videoHeight;
      if (!vw) return;
      const k = Math.min(1, 1600 / Math.max(vw, vh));
      const c = document.createElement("canvas"); c.width = Math.round(vw * k); c.height = Math.round(vh * k);
      const ctx = c.getContext("2d");
      if (facing === "user") { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(preview, 0, 0, c.width, c.height);
      root.classList.add("flash"); setTimeout(() => root.classList.remove("flash"), 220);
      c.toBlob((b) => b && showReview("photo", new File([b], "foto.jpg", { type: "image/jpeg" }), 0), "image/jpeg", 0.88);
    }

    function toggleRecord() {
      if (rec) { rec.stop(); return; }
      if (!stream) return;
      const mime = pickMime("video");
      const chunks = [];
      try { rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_200_000, audioBitsPerSecond: 96_000 }); }
      catch { toast(t("cam.unavailable"), "error"); return; }
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = () => {
        clearInterval(tickTimer);
        const type = rec.mimeType || mime || "video/webm";
        const dur = Math.min(maxVideoMs, Date.now() - startAt);
        rec = null; root.classList.remove("recording"); hint.hidden = false; timer.hidden = true; shutter.setAttribute("aria-label", t("cam.shutter"));
        const blob = new Blob(chunks, { type });
        if (blob.size < 1000 || dur < 400) { toast(t("cam.tooShort"), "error"); fg.style.setProperty("stroke-dashoffset", "100"); return; }
        const ext = type.includes("mp4") ? "mp4" : "webm";
        showReview("video", new File([blob], `video.${ext}`, { type }), dur);
      };
      rec.start(250); startAt = Date.now();
      root.classList.add("recording"); hint.hidden = true; timer.hidden = false; shutter.setAttribute("aria-label", t("cam.stop"));
      const limit = maxVideoMs - 150; // sisakan jeda henti agar hasil tak melewati batas server
      tickTimer = setInterval(() => {
        const el = Date.now() - startAt;
        fg.style.setProperty("stroke-dashoffset", String(100 - Math.min(100, (el / maxVideoMs) * 100)));
        timer.textContent = `${fmtDur(el)} / ${fmtDur(maxVideoMs)}`;
        if (el >= limit && rec) rec.stop();
      }, 50);
    }
    shutter.addEventListener("click", () => (mode === "photo" ? takePhoto() : toggleRecord()));
    fg.style.setProperty("stroke-dashoffset", "100");
    setMode(mode);
  });
}
