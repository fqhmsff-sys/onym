// Lampiran media untuk komentar (buat & edit): foto, video (≤10 dtk), suara — aturan sama seperti post.
// Satu "kit" dipakai di kolom komentar dan di lembar Edit komentar. Semua media (termasuk yang lama) bisa dihapus/ditambah.
import { abs } from "./api.js";
import { openCamera } from "./capture.js";
import { t } from "./i18n.js";
import { audioPlayer, canRecord, compressImage, openPreview, pauseAll, probeDuration, recordAudio } from "./media.js";
import { canTrim, openTrimmer, canTrimAudio, openAudioTrimmer } from "./trim.js";
import { fmtDur, h, icon, sheet, toast } from "./ui.js";

/** existing: media komentar lama (DTO) untuk mode edit. errText: penerjemah galat. onChange: dipanggil tiap lampiran berubah. */
export function attachKit({ cfg = {}, existing = [], onChange, errText = () => "?" } = {}) {
  const att = { items: [], audios: [] }; // items: foto+video berurutan; audios: suara
  const maxVisual = cfg.maxPhotos || 10, maxAudios = cfg.maxAudios || 10;
  const maxVideoMs = cfg.maxVideoMs || 10000, maxVideoS = Math.round(maxVideoMs / 1000);
  const maxAudioMs = cfg.maxAudioMs || 300000, maxAudioM = Math.round(maxAudioMs / 60000);
  let recCtrl = null, menuSheet = null;
  const players = [];
  for (const m of existing) {
    const e = { existingId: m.id, kind: m.kind, file: null, url: m.url, durationMs: m.durationMs || 0 };
    (m.kind === "audio" ? att.audios : att.items).push(e);
  }
  const revoke = (x) => { if (x && !x.existingId && x.url) URL.revokeObjectURL(x.url); };
  const tray = h("div", { class: "tray" });
  const recPanel = h("div", { class: "rec-panel", hidden: true });
  const hid = (accept, extra = {}) => h("input", { type: "file", accept, class: "file-hidden", tabindex: "-1", "aria-hidden": "true", ...extra });
  const inPhoto = hid("image/*"), inVideo = hid("video/*"), inAudio = hid("audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm");
  const inCapPhoto = hid("image/*", { capture: "environment" }), inCapVideo = hid("video/*", { capture: "environment" });
  const inputs = [inPhoto, inVideo, inAudio, inCapPhoto, inCapVideo];

  const hasAny = () => att.items.length + att.audios.length > 0;
  const hasNew = () => [...att.items, ...att.audios].some((x) => !x.existingId);
  function refresh() {
    players.splice(0).forEach((p) => p.destroy?.());
    tray.replaceChildren(...att.items.map(thumb), ...att.audios.map(audioThumb));
    tray.classList.toggle("has", hasAny());
    onChange?.();
  }
  function thumb(it, i) {
    const video = it.kind === "video", src = abs(it.url);
    const m = video ? h("video", { src: src + "#t=0.1", muted: "", playsinline: "", preload: "metadata" }) : h("img", { src, alt: "" });
    const open = h("button", { class: "thumb-open", type: "button", "aria-label": t("compose.preview"), onclick: () => openPreview(att.items.map((x) => ({ kind: x.kind, url: x.url })), i) },
      video ? h("span", { class: "thumb-play" }, icon("play", 18)) : null);
    return h("div", { class: "thumb pop-in" }, m, open, video ? h("span", { class: "thumb-badge" }, icon("video", 12), fmtDur(it.durationMs)) : null,
      h("button", { class: "thumb-x", type: "button", "aria-label": t("common.delete"), onclick: () => { revoke(it); att.items.splice(i, 1); refresh(); } }, icon("x", 14)));
  }
  function audioThumb(a) {
    const pl = audioPlayer({ id: "k" + (a.existingId || a.url.slice(-8)), url: a.url, durationMs: a.durationMs }); players.push(pl);
    return h("div", { class: "thumb audio pop-in" }, pl,
      h("button", { class: "thumb-x", type: "button", "aria-label": t("comments.removeAudio"), onclick: () => { pl.destroy?.(); revoke(a); att.audios.splice(att.audios.indexOf(a), 1); refresh(); } }, icon("x", 14)));
  }

  // Salin isi berkas ke memori segera (File dari galeri Android/WebView bisa tak terbaca lagi), lalu jalankan pengolah.
  function onFiles(input, fn) {
    let working = false;
    const run = async () => {
      const picked = [...(input.files || [])]; if (!picked.length || working) return;
      working = true;
      try {
        const files = [];
        for (const f of picked) {
          try { files.push(new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified })); }
          catch { input.value = ""; return toast(t("err.media_corrupt"), "error"); }
        }
        input.value = ""; await fn(files);
      } catch (e) { toast(errText(e), "error"); } finally { working = false; }
    };
    input.addEventListener("change", run); input.addEventListener("input", run);
  }
  const full = () => att.items.length >= maxVisual && (toast(t("compose.maxPhotos", { n: maxVisual }), "error"), true);
  const push = (x) => { att.items.push(x); refresh(); };
  async function addPhotos(files) {
    for (const f of files) {
      if (full()) break;
      try { const c = await compressImage(f); push({ kind: "photo", file: c, url: URL.createObjectURL(c), durationMs: 0 }); }
      catch {
        if ((f.type || "").startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(f.name)) push({ kind: "photo", file: f, url: URL.createObjectURL(f), durationMs: 0 });
        else toast(t("err.media_unsupported"), "error");
      }
    }
  }
  async function addVideo(files) {
    const f = files[0]; if (!f || full()) return;
    if (cfg.maxVideoBytes && f.size > cfg.maxVideoBytes) return toast(t("err.video_too_large"), "error");
    if (!(f.type || "").startsWith("video/") && !/\.(mp4|m4v|mov|webm|3gp|mkv|avi|ogv)$/i.test(f.name)) return toast(t("err.media_unsupported"), "error");
    let d = 0;
    try { d = await probeDuration(f, "video"); } catch { return toast(t("compose.videoUnreadable"), "error"); }
    if (d > maxVideoMs + 300) {
      if (!canTrim()) return toast(t("trim.unsupported", { s: maxVideoS }), "error");
      const r = await openTrimmer({ file: f, durationMs: d, maxMs: maxVideoMs }); if (!r) return;
      return push({ kind: "video", file: r.file, url: URL.createObjectURL(r.file), durationMs: r.durationMs });
    }
    push({ kind: "video", file: f, url: URL.createObjectURL(f), durationMs: d });
  }
  function setAudio(file, durationMs) {
    if (att.audios.length >= maxAudios) return toast(t("compose.maxAudios", { n: maxAudios }), "info");
    att.audios.push({ kind: "audio", file, url: URL.createObjectURL(file), durationMs }); refresh();
  }
  async function addAudio(files) {
    const f = files[0]; if (!f) return;
    if (f.size > (cfg.maxAudioBytes || 40 * 1024 * 1024)) return toast(t("err.audio_too_large"), "error");
    let d = 0; try { d = await probeDuration(f, "audio"); } catch { /* durasi 0:00; diperiksa lagi saat dikirim */ }
    if (d > maxAudioMs + 1500) {
      if (!canTrimAudio()) return toast(t("trim.audioUnsupported", { s: Math.round(maxAudioMs / 1000) }), "error");
      const r = await openAudioTrimmer({ file: f, durationMs: d, maxMs: maxAudioMs, maxBytes: cfg.maxAudioBytes || 40 * 1024 * 1024 });
      if (!r) return; setAudio(r.file, r.durationMs); return;
    }
    setAudio(f, d);
  }
  onFiles(inPhoto, addPhotos); onFiles(inCapPhoto, addPhotos); onFiles(inVideo, addVideo); onFiles(inCapVideo, addVideo); onFiles(inAudio, addAudio);

  async function capture(mode) {
    if (!navigator.mediaDevices?.getUserMedia || (mode === "video" && !canRecord())) { (mode === "video" ? inCapVideo : inCapPhoto).click(); return; }
    pauseAll();
    const r = await openCamera({ mode, maxVideoMs }); if (!r || full()) return;
    push({ kind: r.kind, file: r.file, url: URL.createObjectURL(r.file), durationMs: r.durationMs || 0 });
  }
  async function startRecording() {
    if (recCtrl) return;
    if (att.audios.length >= maxAudios) return toast(t("compose.maxAudios", { n: maxAudios }), "info");
    if (!canRecord()) return inAudio.click();
    pauseAll();
    const level = h("div", { class: "rec-levels" }, Array.from({ length: 24 }, () => h("i")));
    const timeEl = h("span", { class: "rec-time" }, "0:00");
    const stopBtn = h("button", { class: "rec-stop", type: "button", "aria-label": t("compose.stopRec") }, icon("stop", 22));
    const cancelBtn = h("button", { class: "link-btn", type: "button" }, t("common.cancel"));
    recPanel.replaceChildren(h("span", { class: "rec-dot" }), timeEl, level, stopBtn, cancelBtn);
    recPanel.hidden = false; recPanel.classList.add("in");
    const hide = () => { recPanel.classList.remove("in"); recPanel.hidden = true; recCtrl = null; };
    let ctrl;
    try {
      ctrl = await recordAudio({
        maxMs: maxAudioMs,
        onTick: (ms) => { timeEl.textContent = `${fmtDur(ms)} / ${fmtDur(maxAudioMs)}`; },
        onLevel: (v) => { const bars = level.children; for (let i = 0; i < bars.length; i++) { const k = (Math.sin(performance.now() / 140 + i) + 1) / 2; bars[i].style.setProperty("--l", String(0.12 + v * (0.35 + 0.65 * k))); } },
      });
    } catch (e) { hide(); return toast(e?.name === "NotAllowedError" ? t("cam.micDenied") : t("cam.unavailable"), "error"); }
    recCtrl = ctrl;
    stopBtn.addEventListener("click", () => ctrl.stop()); cancelBtn.addEventListener("click", () => ctrl.cancel());
    try {
      const r = await ctrl.result; hide();
      if (r.durationMs < 400) return toast(t("cam.tooShort"), "error");
      const ext = r.mime.includes("mp4") ? "m4a" : r.mime.includes("ogg") ? "ogg" : "webm";
      setAudio(new File([r.blob], `suara.${ext}`, { type: r.mime }), r.durationMs);
    } catch (e) { hide(); if (e?.name !== "AbortError") toast(t("cam.unavailable"), "error"); }
  }

  /** Menu "+" : foto, kamera, video (rekam/berkas), suara (rekam/berkas). input.click() dipanggil langsung dari ketukan. */
  function openMenu() {
    if (recCtrl) return;
    const row = (ic, label, hint, fn) => h("button", { class: "menu-item", type: "button", onclick: fn }, icon(ic, 20), h("span", { class: "menu-text" }, h("b", null, label), hint ? h("small", null, hint) : null));
    const vh = t("compose.videoLimit", { s: maxVideoS }), ah = t("comments.audioLimit", { m: maxAudioM });
    menuSheet = sheet({ title: t("comments.attach"), onClose: () => { menuSheet = null; }, content: h("div", { class: "menu" }, [
      row("image", t("comments.addPhoto"), null, () => { inPhoto.click(); menuSheet?.close(); }),
      row("camera", t("compose.camera"), null, () => { menuSheet?.close(); setTimeout(() => capture("photo"), 150); }),
      row("video", t("compose.pickVideo"), vh, () => { inVideo.click(); menuSheet?.close(); }),
      row("video", t("compose.recVideo"), vh, () => { menuSheet?.close(); setTimeout(() => capture("video"), 150); }),
      canRecord() ? row("mic", t("comments.recAudio"), ah, () => { menuSheet?.close(); setTimeout(startRecording, 150); }) : null,
      row("volume", t("comments.pickAudio"), ah, () => { inAudio.click(); menuSheet?.close(); }),
    ]) });
  }

  /** Tulis lampiran ke FormData. Mode edit juga mengirim `keep` (id media lama) dan `layout` (urutan akhir). */
  function appendTo(form, { editing = false } = {}) {
    const durations = [], keep = [], layout = []; let n = 0;
    const add = (x) => {
      if (x.existingId) { keep.push(x.existingId); layout.push("k:" + x.existingId); return; }
      form.append("media", x.file, x.file.name || "media"); durations.push(Math.round(x.durationMs || 0)); layout.push("n:" + n++);
    };
    att.items.forEach(add); att.audios.forEach(add);
    form.set("durations", durations.join(","));
    if (editing) { form.set("keep", keep.join(",")); form.set("layout", layout.join(",")); }
  }
  /** Kosongkan setelah terkirim (blob baru dicabut). */
  function reset() { [...att.items, ...att.audios].forEach(revoke); att.items = []; att.audios = []; refresh(); }
  function destroy() { recCtrl?.cancel(); players.splice(0).forEach((p) => p.destroy?.()); [...att.items, ...att.audios].forEach(revoke); att.items = []; att.audios = []; }
  refresh();
  return { tray, recPanel, inputs, openMenu, appendTo, reset, destroy, hasAny, hasNew, isRecording: () => !!recCtrl };
}
