// Pemutar audio/video, galeri foto, lightbox, dan pembantu rekam/kompres.
import { abs } from "./api.js";
import { t } from "./i18n.js";
import { h, icon, fmtDur, toast } from "./ui.js";
import { openViewer } from "./viewer.js";

export const openLightbox = (photos, start = 0) => openViewer(photos, start);
/** Putar otomatis media di feed (bisa dimatikan dengan localStorage hh_autoplay = "0"). */
const autoplayOn = () => { try { return localStorage.getItem("hh_autoplay") !== "0"; } catch { return true; } };
/** Memutar otomatis saat ≥60% terlihat, menjeda saat hampir hilang. `root.autoplay()` dan `root.pause()` harus ada. */
export function watchAutoplay(root) {
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (e.intersectionRatio >= 0.6) { if (autoplayOn() && !document.hidden) root.autoplay?.(); }
      else if (e.intersectionRatio < 0.3) root.pause?.();
    }
  }, { threshold: [0, 0.3, 0.6, 0.85] });
  io.observe(root);
  return () => io.disconnect();
}

// ------------------------------------------------------------------ Hanya satu media yang boleh berbunyi pada satu waktu
let current = null;
function claim(p) { if (current && current !== p) current.pause(); current = p; }
function release(p) { if (current === p) current = null; }
export function pauseAll() { current?.pause(); }
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseAll(); });

const seeded = (str, n) => {
  let x = 2166136261; for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) { x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0; out.push(0.28 + ((x >>> 8) % 1000) / 1000 * 0.72); }
  return out;
};
const finite = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

// ------------------------------------------------------------------ Audio
export function audioPlayer(media, { onFirstPlay, autoplay: autoplayEnabled = false } = {}) {
  const BARS = 40;
  const heights = seeded(media.id, BARS);
  const bars = heights.map((v, i) => { const b = h("i", { class: "wb" }); b.style.setProperty("--h", `${Math.round(v * 100)}%`); b.style.setProperty("--d", `${(i % 7) * 70}ms`); return b; });
  const wave = h("div", { class: "wave", role: "slider", tabindex: "0", "aria-label": t("player.seek"), "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, bars);
  const time = h("span", { class: "ap-time" }, fmtDur(media.durationMs));
  const btn = h("button", { class: "ap-btn", type: "button", "aria-label": t("player.play") }, icon("play", 22));
  const root = h("div", { class: "audio-player" }, btn, wave, time);

  let audio = null, counted = false, state = "idle", dragging = false, destroyed = false;
  const total = () => finite(audio?.duration) * 1000 || media.durationMs;
  const setProgress = (p) => {
    p = Math.min(1, Math.max(0, p));
    const on = Math.round(p * BARS);
    for (let i = 0; i < BARS; i++) bars[i].classList.toggle("on", i < on);
    wave.setAttribute("aria-valuenow", String(Math.round(p * 100)));
  };
  const setState = (s) => {
    state = s;
    root.dataset.state = s;
    btn.replaceChildren(icon(s === "playing" ? "pause" : s === "error" ? "refresh" : "play", 22));
    btn.setAttribute("aria-label", s === "playing" ? t("player.pause") : t("player.play"));
  };
  const ctrl = {
    pause() { audio?.pause(); },
    destroy() { destroyed = true; if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio = null; } release(ctrl); },
  };
  function ensure() {
    if (audio) return audio;
    const a = (audio = new Audio());
    a.preload = "metadata";
    a.setAttribute("playsinline", "");
    a.src = abs(media.url);
    a.addEventListener("playing", () => { setState("playing"); if (!counted) { counted = true; onFirstPlay?.(); } });
    a.addEventListener("pause", () => { if (state !== "error" && !a.ended) setState("paused"); release(ctrl); });
    a.addEventListener("waiting", () => root.classList.add("buffering"));
    a.addEventListener("canplay", () => root.classList.remove("buffering"));
    a.addEventListener("timeupdate", () => {
      if (dragging) return;
      const d = total();
      setProgress(a.currentTime * 1000 / d);
      time.textContent = fmtDur(Math.min(d, a.currentTime * 1000)) + " / " + fmtDur(d);
    });
    a.addEventListener("ended", () => { a.currentTime = 0; setProgress(0); time.textContent = fmtDur(media.durationMs); setState("idle"); release(ctrl); });
    a.addEventListener("error", () => { if (destroyed) return; root.classList.remove("buffering"); setState("error"); a.removeAttribute("src"); if (audio === a) audio = null; toast(t("player.error"), "error"); });
    return a;
  }
  async function toggle() {
    if (state === "error") { setState("idle"); }
    const a = ensure();
    if (!a.paused) { a.pause(); return; }
    claim(ctrl);
    try { await a.play(); } catch (e) {
      if (e?.name === "AbortError") return; // dijeda sebelum sempat mulai — bukan galat
      setState("error"); audio = null; toast(e?.name === "NotAllowedError" ? t("player.blocked") : t("player.error"), "error");
    }
  }
  btn.addEventListener("click", toggle);
  /** Putar otomatis: bila peramban menolak (belum ada interaksi), diam saja — tombol putar tetap tersedia. */
  async function autoplay() {
    if (destroyed || state === "error" || state === "playing") return;
    const a = ensure(); if (!a.paused) return;
    claim(ctrl);
    try { await a.play(); } catch { if (audio === a && a.paused) setState("idle"); release(ctrl); }
  }
  // Geser/ketuk bentuk gelombang untuk melompat.
  const seekTo = (e) => {
    const r = wave.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setProgress(p);
    time.textContent = fmtDur(p * total()) + " / " + fmtDur(total());
    return p;
  };
  wave.addEventListener("pointerdown", (e) => { dragging = true; wave.setPointerCapture(e.pointerId); seekTo(e); });
  wave.addEventListener("pointermove", (e) => { if (dragging) seekTo(e); });
  const endSeek = (e) => {
    if (!dragging) return; dragging = false;
    const p = seekTo(e);
    const a = ensure();
    const go = () => { try { a.currentTime = (p * total()) / 1000; } catch { /* belum siap */ } };
    if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
    if (a.paused) toggle();
  };
  wave.addEventListener("pointerup", endSeek); wave.addEventListener("pointercancel", () => { dragging = false; });
  wave.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && audio) audio.currentTime = Math.max(0, audio.currentTime + (e.key === "ArrowRight" ? 2 : -2));
  });
  setProgress(0);
  root.pause = ctrl.pause; root.autoplay = autoplay;
  let stopWatch = () => {}; if (autoplayEnabled) stopWatch = watchAutoplay(root);
  root.destroy = () => { stopWatch(); ctrl.destroy(); };
  return root;
}

// ------------------------------------------------------------------ Backsound
/** Satu backsound global: berputar terus (berulang) selama post pemiliknya terlihat; TIDAK dipengaruhi video/audio (di post itu maupun post lain). Pindah ke post lain → mati.
 *  Hanya menyala selama post pemiliknya terlihat; keluar dari layar → otomatis mati. Tombol "Backsound" di post = nyala/mati (berlaku untuk semuanya,
 *  diingat). Berhenti bila post pemiliknya dilepas dari layar aplikasi atau tab disembunyikan. */
const bsChips = new Set();
let bsAudio = null, bsOwner = null, bsMuted = false, bsRetry = false;
try { bsMuted = localStorage.getItem("hh_bs_muted") === "1"; } catch { /* abaikan */ }
function bsPaint() { for (const c of bsChips) c.paint(); }
async function bsPlay() {
  if (!bsAudio || !bsOwner) return;
  if (bsMuted || document.hidden) { bsAudio.pause(); bsPaint(); return; }
  try { await bsAudio.play(); }
  catch (e) { if (e?.name === "NotAllowedError" && !bsRetry) { bsRetry = true; document.addEventListener("pointerdown", () => { bsRetry = false; bsPlay(); }, { once: true, capture: true }); } }
  bsPaint();
}
function bsClaim(owner, url) {
  if (bsOwner === owner && bsAudio) { bsPlay(); return; }
  bsOwner = owner;
  if (!bsAudio) { bsAudio = new Audio(); bsAudio.loop = true; bsAudio.preload = "auto"; bsAudio.volume = 0.6; bsAudio.setAttribute("playsinline", ""); bsAudio.addEventListener("error", () => { bsPaint(); }); }
  bsAudio.src = abs(url); bsPlay();
}
const bsVisible = new Map(); // owner → url, post ber-backsound yang masih terlihat
function bsRelease(owner) { if (bsOwner !== owner) return; bsOwner = null; if (bsAudio) { bsAudio.pause(); bsAudio.removeAttribute("src"); bsAudio.load(); } bsPaint(); const nx = bsVisible.entries().next().value; if (nx) bsClaim(nx[0], nx[1]); }
function bsSetMuted(v) { bsMuted = v; try { localStorage.setItem("hh_bs_muted", v ? "1" : "0"); } catch { /* abaikan */ } bsPlay(); bsPaint(); }
document.addEventListener("visibilitychange", () => { if (document.hidden) bsAudio?.pause(); else bsPlay(); });
export const backsoundEnabled = () => !bsMuted;
export function setBacksoundEnabled(v) { bsSetMuted(!v); }
export const autoplayEnabledNow = autoplayOn;
export function setAutoplayEnabled(v) { try { localStorage.setItem("hh_autoplay", v ? "1" : "0"); } catch { /* abaikan */ } }

/** `items`: hanya item pertama dipakai (satu backsound per post). `el.watch(hostEl)`: pantau keterlihatan post. */
export function backsoundPlayer(items) {
  const url = items[0].url, owner = {};
  const eq = h("i", { class: "bs-eq" }, h("b"), h("b"), h("b"));
  const btn = h("button", { class: "bs-btn", type: "button", "aria-pressed": "true", "aria-label": t("backsound.toggle") }, icon("music", 16), h("span", null, t("backsound.label")), eq);
  const root = h("div", { class: "backsound" }, btn);
  let io = null;
  const chip = { paint() {
    const mine = bsOwner === owner, on = mine && !bsMuted;
    root.classList.toggle("playing", on && !!bsAudio && !bsAudio.paused); root.classList.toggle("off", !on); btn.setAttribute("aria-pressed", String(on));
  } };
  bsChips.add(chip);
  btn.addEventListener("click", () => {
    if (bsOwner === owner && !bsMuted && bsAudio && !bsAudio.paused) { bsSetMuted(true); return; } // sedang berbunyi → matikan
    bsMuted = false; try { localStorage.setItem("hh_bs_muted", "0"); } catch { /* abaikan */ }
    if (bsOwner === owner && bsAudio) bsPlay(); else bsClaim(owner, url);
    bsPaint();
  });
  root.watch = (host) => {
    // Menyala terus selama post ini ada di layar (tidak dijeda suara/video lain); begitu post keluar dari layar, otomatis mati.
    // Post lain yang tidak punya backsound tidak berpengaruh apa-apa selain membuat backsound ini berhenti saat ia terlewat.
    io = new IntersectionObserver((es) => {
      for (const e of es) {
        const shown = e.intersectionRatio >= 0.5 || e.intersectionRect.height >= innerHeight * 0.5;
        const gone = !e.isIntersecting || (e.intersectionRatio < 0.2 && e.intersectionRect.height < innerHeight * 0.2);
        if (shown) { bsVisible.set(owner, url); if (bsOwner !== owner) bsClaim(owner, url); }
        else if (gone) { bsVisible.delete(owner); bsRelease(owner); }
      }
    }, { threshold: [0, 0.2, 0.5, 0.75] });
    io.observe(host);
  };
  root.pause = () => {};
  root.destroy = () => { io?.disconnect(); bsChips.delete(chip); bsVisible.delete(owner); bsRelease(owner); };
  chip.paint();
  return root;
}

// ------------------------------------------------------------------ Muat malas (lazy) video
// Hanya video yang dekat layar yang dipasang sumbernya (src); yang jauh dilepas agar RAM, jaringan, dan dekoder HP tidak penuh.
// Tanpa ini, 20 video di Beranda memuat serentak saat dibuka → patah-patah dan lama.
const nearCbs = new WeakMap(), farCbs = new WeakMap();
const nearIO = new IntersectionObserver((es) => { for (const e of es) nearCbs.get(e.target)?.(e.isIntersecting); }, { rootMargin: "150% 0px" });
const farIO = new IntersectionObserver((es) => { for (const e of es) if (!e.isIntersecting) farCbs.get(e.target)?.(); }, { rootMargin: "400% 0px" });
/** fn(true/false) dipanggil saat elemen masuk/keluar jangkauan dekat (±1,5 layar). Mengembalikan fungsi berhenti. */
export function watchNear(el, fn) { nearCbs.set(el, fn); nearIO.observe(el); return () => { nearIO.unobserve(el); nearCbs.delete(el); }; }
/** fn() dipanggil saat elemen sudah jauh (>4 layar) dari layar. */
export function watchFar(el, fn) { farCbs.set(el, fn); farIO.observe(el); return () => { farIO.unobserve(el); farCbs.delete(el); }; }

// ------------------------------------------------------------------ Video (maks. 10 dtk)
/** Rasio tinggi/lebar asli, dibatasi 0.5–1.78 hanya agar kartu tidak ekstrem (isi tetap utuh karena contain). */
export const videoRatio = (m) => (m.width && m.height ? m.height / m.width : 0.5625); // rasio ASLI persis (tidak dibatasi, tidak dipotong)
export function videoPlayer(media, { onFirstPlay, autoFocusPlay = false, fill = false, autoplay: autoplayEnabled = false, onDims } = {}) {
  // Rasio ASLI video dipertahankan (landscape/portrait); hanya dibatasi agar tidak setinggi/serendah ekstrem. Isi video TIDAK dipotong (contain).
  const ratio = videoRatio(media);
  const srcUrl = abs(media.url) + "#t=0.05";
  const v = h("video", { playsinline: "", "webkit-playsinline": "", preload: "metadata", disablepictureinpicture: "", "aria-label": t("player.video") });
  v.muted = false; v.setAttribute("playsinline", "");
  if (autoplayEnabled) v.loop = true; // di feed: berulang seperti Instagram
  const prog = h("i", { class: "vp-prog-fill" });
  const knob = h("i", { class: "vp-knob" });
  const dur = h("span", { class: "vp-dur" }, fmtDur(media.durationMs));
  const mute = h("button", { class: "vp-mute", type: "button", "aria-label": t("player.mute") }, icon("volume", 18));
  const big = h("div", { class: "vp-big" }, icon("play", 34));
  const err = h("button", { class: "vp-err", type: "button" }, icon("refresh", 22), h("span", null, t("player.error")));
  // Bilah geser: seret/ketuk untuk melompat ke bagian mana pun video.
  const seek = h("div", { class: "vp-seek", role: "slider", tabindex: "0", "aria-label": t("player.seek"), "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, h("div", { class: "vp-prog" }, prog, knob));
  const root = h("div", { class: `video-player ${fill ? "fill" : ""}`.trim() }, v, big, h("div", { class: "vp-top" }, dur), mute, seek, err);
  root.style.setProperty("--ratio", String(ratio));
  if (!fill) { root.style.setProperty("width", `min(100%, calc(72vh / ${ratio}))`); root.style.setProperty("margin-inline", "auto"); } // video tinggi dikecilkan agar muat layar, bukan dipotong
  v.addEventListener("loadedmetadata", () => { if (v.videoWidth && v.videoHeight) onDims?.(v.videoWidth, v.videoHeight); });
  let counted = false, failed = false, dead = false, attached = false, near = false, pinned = false, resumeAt = 0, scrub = false, raf = 0, lastSeek = 0;
  const ctrl = { pause() { v.pause(); } };
  const total = () => finite(v.duration) * 1000 || media.durationMs || 1;

  // ---- Pasang/lepas sumber (lazy)
  function attach() {
    if (dead || attached) return; attached = true;
    v.src = srcUrl;
    if (resumeAt > 0) { const at = resumeAt; resumeAt = 0; v.addEventListener("loadedmetadata", () => { try { v.currentTime = at; } catch { /* belum siap */ } }, { once: true }); }
  }
  function detach() {
    if (dead || !attached || !v.paused || scrub) return; // yang sedang diputar/digeser tidak dilepas
    resumeAt = v.currentTime; attached = false; v.removeAttribute("src"); v.load(); root.classList.remove("buffering");
  }
  const stopNear = watchNear(root, (isNear) => { near = isNear; if (isNear) attach(); });
  const stopFar = watchFar(root, () => { if (!pinned) detach(); });
  root.warm = () => { pinned = true; attach(); };          // dipanggil galeri untuk slide di sebelah slide aktif → geser tanpa jeda
  root.cool = () => { pinned = false; if (!near) detach(); };

  // ---- Putar/jeda
  async function toggle() {
    if (failed) return;
    if (!v.paused) { v.pause(); return; }
    attach(); claim(ctrl);
    try { await v.play(); } catch (e) { if (e?.name !== "AbortError") { toast(e?.name === "NotAllowedError" ? t("player.blocked") : t("player.error"), "error"); } }
  }
  root.addEventListener("click", (e) => { if (e.target.closest(".vp-mute") || e.target.closest(".vp-err") || e.target.closest(".vp-seek")) return; toggle(); });
  v.addEventListener("playing", () => { root.classList.add("playing"); root.classList.remove("buffering"); if (!counted) { counted = true; onFirstPlay?.(); } loop(); });
  v.addEventListener("pause", () => { root.classList.remove("playing"); release(ctrl); });
  v.addEventListener("waiting", () => root.classList.add("buffering"));
  v.addEventListener("canplay", () => root.classList.remove("buffering"));
  v.addEventListener("seeked", () => { if (!scrub) paint(v.currentTime * 1000 / total()); });
  v.addEventListener("ended", () => { if (v.loop) return; v.currentTime = 0; paint(0); root.classList.remove("playing"); release(ctrl); });
  v.addEventListener("error", () => { if (dead || !attached) return; failed = true; root.classList.add("failed"); root.classList.remove("buffering"); });
  err.addEventListener("click", () => { failed = false; root.classList.remove("failed"); attached = false; v.removeAttribute("src"); attach(); });
  mute.addEventListener("click", () => { v.muted = !v.muted; mute.replaceChildren(icon(v.muted ? "mute" : "volume", 18)); });

  // ---- Kemajuan mulus (rAF saat diputar) + bilah geser
  const paint = (p) => {
    p = Math.min(1, Math.max(0, p || 0));
    prog.style.setProperty("transform", `scaleX(${p})`); knob.style.setProperty("left", `${p * 100}%`);
    seek.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    dur.textContent = fmtDur(Math.max(0, (1 - p) * total()));
  };
  function loop() { cancelAnimationFrame(raf); if (dead || v.paused) return; if (!scrub) paint(v.currentTime * 1000 / total()); raf = requestAnimationFrame(loop); }
  const fracOf = (e) => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))); };
  /** Lompat ke pecahan p (0–1). Bila metadata belum ada, dilakukan begitu siap. */
  function seekTo(p) {
    attach();
    const go = () => { try { v.currentTime = p * (finite(v.duration) || media.durationMs / 1000); } catch { /* belum siap */ } };
    if (v.readyState >= 1) go(); else { resumeAt = 0; v.addEventListener("loadedmetadata", go, { once: true }); }
  }
  seek.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); // jangan memicu geser galeri / ketuk-putar
    scrub = true; try { seek.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    root.classList.add("scrubbing"); const p = fracOf(e); paint(p); seekTo(p); lastSeek = performance.now();
  });
  seek.addEventListener("pointermove", (e) => {
    if (!scrub) return; const p = fracOf(e); paint(p);
    const now = performance.now(); if (now - lastSeek > 70) { lastSeek = now; seekTo(p); } // pratinjau bingkai saat menggeser, dibatasi agar ringan
  });
  const endScrub = (e, commit) => {
    if (!scrub) return; scrub = false; root.classList.remove("scrubbing");
    if (commit) { const p = fracOf(e); paint(p); seekTo(p); }
    loop();
  };
  seek.addEventListener("pointerup", (e) => endScrub(e, true));
  seek.addEventListener("pointercancel", (e) => endScrub(e, false));
  seek.addEventListener("click", (e) => e.stopPropagation());
  seek.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 2 : e.key === "ArrowLeft" ? -2 : 0;
    if (step) { e.preventDefault(); attach(); seekTo(Math.min(1, Math.max(0, (v.currentTime + step) * 1000 / total()))); }
    else if (e.key === "Home") { e.preventDefault(); seekTo(0); } else if (e.key === "End") { e.preventDefault(); seekTo(0.999); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); }
  });

  // Jeda otomatis saat keluar dari layar.
  const io = new IntersectionObserver((es) => { for (const e of es) if (!e.isIntersecting && !v.paused) v.pause(); }, { threshold: 0.25 });
  io.observe(root);
  // Putar otomatis di feed: dengan suara; bila peramban menolak, jatuh ke tanpa suara (ketuk ikon suara untuk menyalakan).
  async function autoplay() {
    if (dead || failed || !v.paused) return;
    attach(); claim(ctrl);
    try { await v.play(); }
    catch (e) {
      if (e?.name === "AbortError") return;
      try { v.muted = true; mute.replaceChildren(icon("mute", 18)); await v.play(); } catch { release(ctrl); }
    }
  }
  root.pause = ctrl.pause; root.autoplay = autoplay;
  let stopWatch = () => {}; if (autoplayEnabled) stopWatch = watchAutoplay(root);
  root.destroy = () => { dead = true; cancelAnimationFrame(raf); stopWatch(); stopNear(); stopFar(); io.disconnect(); v.pause(); v.removeAttribute("src"); v.load(); release(ctrl); };
  if (autoFocusPlay) queueMicrotask(toggle);
  return root;
}

// ------------------------------------------------------------------ Pratinjau layar penuh (foto & video) sebelum diposting / dikirim
/** items: [{kind:"photo"|"video", url}] (blob: atau /api/...). Video diputar dengan kontrol bawaan (putar/jeda/geser waktu). */
export function openPreview(items, start = 0) {
  const list = items.filter((x) => x && x.url && (x.kind === "photo" || x.kind === "video"));
  if (!list.length) return null;
  pauseAll();
  let i = Math.min(Math.max(0, start), list.length - 1), closed = false;
  const stage = h("div", { class: "pv-stage" });
  const count = h("span", { class: "lb-count" });
  const close = h("button", { class: "icon-btn lb-close", type: "button", "aria-label": t("common.close") }, icon("x", 22));
  const prev = h("button", { class: "lb-nav prev", type: "button", "aria-label": t("common.prev") }, icon("back", 24));
  const next = h("button", { class: "lb-nav next", type: "button", "aria-label": t("common.next") }, icon("chevron", 24));
  const root = h("div", { class: "layer lightbox pv" }, h("div", { class: "scrim" }), stage, count, close, list.length > 1 ? [prev, next] : null);
  document.getElementById("layers").append(root);
  document.documentElement.classList.add("no-scroll");
  requestAnimationFrame(() => root.classList.add("in"));
  function stopMedia() { const v = stage.querySelector("video"); if (v) { v.pause(); v.removeAttribute("src"); v.load(); } }
  function show() {
    stopMedia(); stage.replaceChildren();
    const m = list[i];
    if (m.kind === "video") {
      const v = h("video", { class: "pv-media", src: abs(m.url), controls: "", playsinline: "", "webkit-playsinline": "", loop: "", preload: "auto" });
      v.setAttribute("playsinline", "");
      stage.append(v);
      v.play().catch(() => { /* peramban menolak putar otomatis: pengguna menekan tombol putar bawaan */ });
    } else stage.append(h("img", { class: "pv-media", src: abs(m.url), alt: "", draggable: "false" }));
    count.textContent = list.length > 1 ? `${i + 1}/${list.length}` : "";
    prev.hidden = i === 0; next.hidden = i === list.length - 1;
  }
  const to = (n) => { i = Math.min(list.length - 1, Math.max(0, n)); show(); };
  function end() {
    if (closed) return; closed = true; stopMedia(); document.removeEventListener("keydown", onKey, true);
    root.classList.add("out"); setTimeout(() => { root.remove(); if (!document.querySelector(".layer.viewer, .layer.pv")) document.documentElement.classList.remove("no-scroll"); }, 300);
  }
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); end(); } else if (e.key === "ArrowRight") to(i + 1); else if (e.key === "ArrowLeft") to(i - 1); };
  document.addEventListener("keydown", onKey, true);
  close.addEventListener("click", end); prev.addEventListener("click", () => to(i - 1)); next.addEventListener("click", () => to(i + 1));
  root.querySelector(".scrim").addEventListener("click", end);
  show();
  return { close: end };
}

// ------------------------------------------------------------------ Foto
export function photoGrid(photos) {
  const n = Math.min(4, photos.length);
  const grid = h("div", { class: `photo-grid n${n}` });
  photos.slice(0, 4).forEach((p, i) => {
    const img = h("img", { src: abs(p.url), alt: t("post.photoAlt"), loading: "lazy", decoding: "async", draggable: "false" });
    const cell = h("button", { class: "photo-cell", type: "button", "aria-label": t("post.openPhoto") }, img);
    if (n === 1 && p.width && p.height) { cell.style.setProperty("aspect-ratio", `${p.width} / ${p.height}`); cell.style.setProperty("width", `min(100%, calc(72vh * ${p.width} / ${p.height}))`); cell.style.setProperty("margin-inline", "auto"); }
    img.addEventListener("load", () => cell.classList.add("loaded"));
    img.addEventListener("error", () => { cell.classList.add("loaded", "broken"); });
    cell.addEventListener("click", () => openLightbox(photos, i));
    grid.append(cell);
  });
  return grid;
}

// ------------------------------------------------------------------ Kompres foto sebelum unggah
export async function compressImage(file, maxDim = 2560, quality = 0.92, maxBytes = 5.5 * 1024 * 1024) {
  // Foto yang sudah cukup kecil dipakai APA ADANYA: tidak digambar ulang → warna, ketajaman, dan transparansi 100% asli.
  if (/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) && file.size <= maxBytes) return file;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    bmp = await new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u; });
  }
  const w = bmp.width, hgt = bmp.height;
  const k = Math.min(1, maxDim / Math.max(w, hgt));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hgt * k));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height); // TANPA latar putih: foto transparan (mis. PNG hitam) tidak lagi berubah putih
  bmp.close?.();
  const enc = (type, q) => new Promise((res) => c.toBlob(res, type, q));
  const isJpeg = file.type === "image/jpeg";
  let blob, name;
  if (isJpeg) { blob = await enc("image/jpeg", quality); name = "foto.jpg"; }
  else { blob = await enc("image/png"); name = "foto.png"; if (blob && blob.size > maxBytes) { blob = await enc("image/webp", 0.95); name = "foto.webp"; } }
  if (!blob) throw new Error("encode");
  return new File([blob], name, { type: blob.type });
}

// ------------------------------------------------------------------ Durasi berkas (video/audio) dari metadata
export function probeDuration(blob, kind = "video") {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    const url = URL.createObjectURL(blob);
    const done = (fn, v) => { URL.revokeObjectURL(url); el.removeAttribute("src"); el.load(); fn(v); };
    el.preload = "metadata"; el.muted = true;
    el.onerror = () => done(reject, new Error("unreadable"));
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) return done(resolve, Math.round(el.duration * 1000));
      // WebM hasil rekam langsung belum punya durasi di header → paksa pemain menghitungnya.
      el.currentTime = 1e101;
      el.ontimeupdate = () => { el.ontimeupdate = null; done(resolve, Math.round((Number.isFinite(el.duration) ? el.duration : el.currentTime) * 1000)); };
    };
    el.src = url;
    setTimeout(() => done(reject, new Error("timeout")), 8000);
  });
}

// ------------------------------------------------------------------ Format rekaman terbaik yang didukung perangkat
export function pickMime(kind) {
  const list = kind === "video"
    ? ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}
export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");

/** Rekam suara langsung. Mengembalikan pengendali: stop() menyelesaikan, cancel() membuang. */
export async function recordAudio({ maxMs, onTick, onLevel }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = pickMime("audio");
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  let started = 0, timer = 0, raf = 0, cancelled = false, ac = null;
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  // Tingkat suara untuk animasi.
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 256; src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); onLevel?.(Math.min(1, m / 90)); raf = requestAnimationFrame(loop); };
    loop();
  } catch { /* tanpa animasi level */ }
  const cleanup = () => { clearInterval(timer); cancelAnimationFrame(raf); stream.getTracks().forEach((x) => x.stop()); ac?.close?.(); };
  const result = new Promise((resolve, reject) => {
    rec.onstop = () => {
      cleanup();
      if (cancelled) return reject(new DOMException("cancelled", "AbortError"));
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks, { type });
      resolve({ blob, durationMs: Math.min(maxMs, Date.now() - started), mime: type });
    };
    rec.onerror = () => { cleanup(); reject(new Error("record")); };
  });
  rec.start(250);
  started = Date.now();
  timer = setInterval(() => { const el = Date.now() - started; onTick?.(el); if (el >= maxMs) ctrl.stop(); }, 100);
  const ctrl = { result, stop() { if (rec.state !== "inactive") rec.stop(); }, cancel() { cancelled = true; if (rec.state !== "inactive") rec.stop(); else cleanup(); } };
  return ctrl;
}

// ------------------------------------------------------------------ Galeri geser (foto + video) seperti Instagram
/** items: media foto/video berurutan. Geser kiri/kanan; foto diketuk → pelihat zoom; video putar otomatis saat terlihat. Mengembalikan elemen + `players`. */
export function mediaCarousel(items, { autoplay = false } = {}) {
  const players = [], photos = items.filter((m) => m.kind === "photo");
  const vids = new Map(); // indeks slide → pemutar video (untuk memuat lebih dulu slide tetangga)
  let at = 0;
  const first = items[0];
  const root = h("div", { class: `carousel ${items.length > 1 ? "multi" : "single"}` });
  // Kotak mengikuti ukuran ASLI media pertama (tanpa dipotong); terlalu tinggi → seluruh kotak mengecil (lihat .carousel di CSS).
  const setDims = (w, hh) => { if (w > 0 && hh > 0) { root.style.setProperty("--w", String(w)); root.style.setProperty("--h", String(hh)); } };
  setDims(first.width, first.height);
  const track = h("div", { class: "car-track" });
  items.forEach((m, idx) => {
    let node;
    if (m.kind === "video") { node = videoPlayer(m, { fill: true, autoplay, onDims: idx === 0 ? setDims : undefined }); players.push(node); vids.set(idx, node); }
    else {
      const img = h("img", { src: abs(m.url), alt: t("post.photoAlt"), loading: idx < 3 ? "eager" : "lazy", decoding: "async", draggable: "false" });
      node = h("button", { class: "car-photo", type: "button", "aria-label": t("post.openPhoto") }, img);
      img.addEventListener("load", () => { node.classList.add("loaded"); if (idx === 0 && !(first.width && first.height)) setDims(img.naturalWidth, img.naturalHeight); }); img.addEventListener("error", () => node.classList.add("loaded", "broken"));
      node.addEventListener("click", () => openViewer(photos, photos.indexOf(m)));
    }
    track.append(h("div", { class: `car-slide ${m.kind}` }, node));
  });
  root.append(track);
  if (items.length > 1) {
    const count = h("span", { class: "car-count" }, `1/${items.length}`);
    const dots = items.map(() => h("i", { class: "car-dot" })); dots[0].classList.add("on");
    const prev = h("button", { class: "car-nav prev", type: "button", "aria-label": t("common.prev"), hidden: true }, icon("back", 20));
    const next = h("button", { class: "car-nav next", type: "button", "aria-label": t("common.next") }, icon("chevron", 20));
    root.append(count, prev, next, h("div", { class: "car-dots" }, dots));
    let raf = 0;
    const set = (n) => { if (n === at) return; at = n; focusVideos(); count.textContent = `${n + 1}/${items.length}`; dots.forEach((d, k) => d.classList.toggle("on", k === n)); prev.hidden = n === 0; next.hidden = n === items.length - 1; };
    track.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => set(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)))); }, { passive: true });
    const to = (n) => track.scrollTo({ left: n * track.clientWidth, behavior: "smooth" });
    prev.addEventListener("click", () => to(Math.max(0, at - 1))); next.addEventListener("click", () => to(Math.min(items.length - 1, at + 1)));
  }
  // Video di slide aktif dan tetangganya dipasang lebih dulu → geser ke video berikutnya langsung tampil; yang jauh dilepas.
  function focusVideos() { vids.forEach((p, k) => (Math.abs(k - at) <= 1 ? p.warm() : p.cool())); }
  if (vids.size) {
    const stopNear = watchNear(root, (isNear) => { if (isNear) focusVideos(); });
    const stopFar = watchFar(root, () => vids.forEach((p) => p.cool()));
    players.push({ destroy: () => { stopNear(); stopFar(); } }); // ikut dibersihkan bersama pemutar lain saat kartu dibuang
  }
  root.players = players;
  return root;
}
