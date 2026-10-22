// Pemotong video: video lebih panjang dari batas dipotong ke jendela maks. detik pilihan pengguna (tanpa menolak).
// Cara: putar video di elemen tersembunyi, tangkap gambarnya (captureStream) dan suaranya (WebAudio, tidak terdengar), rekam dengan MediaRecorder.
import { t } from "./i18n.js";
import { pickMime } from "./media.js";
import { fmtDur, h, sheet, toast } from "./ui.js";

export const canTrim = () => typeof MediaRecorder !== "undefined" && !!HTMLMediaElement.prototype.captureStream && !!(window.AudioContext || window.webkitAudioContext);

/** @returns {Promise<{file: File, durationMs: number} | null>} null bila dibatalkan atau gagal. */
export function openTrimmer({ file, durationMs, maxMs }) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const total = durationMs / 1000, win = maxMs / 1000, maxStart = Math.max(0, total - win);
    let start = 0, working = false, settled = false, cancelRun = null;
    const preview = h("video", { class: "trim-video", src: url, playsinline: "", controls: "", preload: "auto", muted: "" }); preview.muted = true;
    const label = h("div", { class: "trim-label" });
    const range = h("input", { class: "trim-range", type: "range", min: "0", max: String(maxStart), step: "0.1", value: "0", "aria-label": t("trim.title") });
    const bar = h("i"), prog = h("div", { class: "trim-prog", hidden: true }, bar);
    const go = h("button", { class: "btn primary", type: "button" }, t("trim.use"));
    const cancel = h("button", { class: "btn ghost", type: "button" }, t("common.cancel"));
    const paint = () => { label.textContent = `${t("trim.start", { t: fmtDur(start * 1000) })} → ${fmtDur(Math.min(total, start + win) * 1000)}`; };
    paint();
    const finish = (val) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(val); };
    const s = sheet({
      title: t("trim.title"),
      onClose: () => { cancelRun?.(); preview.pause(); finish(null); },
      content: h("div", { class: "trim-body" }, h("p", { class: "muted" }, t("trim.hint", { d: Math.round(total), s: Math.round(win) })), preview, range, label, prog, h("div", { class: "row-btns" }, cancel, go)),
    });
    range.addEventListener("input", () => { start = Number(range.value); paint(); try { preview.currentTime = start; } catch { /* belum siap */ } });
    cancel.addEventListener("click", () => s.close());
    go.addEventListener("click", async () => {
      if (working) return; working = true; go.disabled = true; range.disabled = true; preview.pause(); prog.hidden = false;
      try {
        const out = await record(file, url, start, maxMs, (ms) => { bar.style.setProperty("transform", `scaleX(${Math.min(1, ms / maxMs)})`); go.textContent = t("trim.working", { n: Math.floor(ms / 1000), s: Math.round(win) }); }, (c) => { cancelRun = c; });
        if (settled) return;
        finish(out); s.close();
      } catch (e) {
        if (settled) return;
        console.error(e); toast(t("trim.failed"), "error"); working = false; go.disabled = false; range.disabled = false; go.textContent = t("trim.use"); prog.hidden = true;
      }
    });
  });
}

async function record(file, url, startS, maxMs, onTick, setCancel) {
  const v = document.createElement("video");
  v.src = url; v.playsInline = true; v.preload = "auto"; v.className = "file-hidden"; v.setAttribute("aria-hidden", "true");
  document.getElementById("layers").append(v);
  const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
  let rec = null, stopped = false, timer = 0;
  const cleanup = () => { clearInterval(timer); try { if (rec && rec.state !== "inactive") { rec.ondataavailable = null; rec.onstop = null; rec.stop(); } } catch { /* abaikan */ } v.pause(); v.remove(); ac.close?.().catch?.(() => {}); };
  setCancel(() => { stopped = true; cleanup(); });
  try {
    await new Promise((res, rej) => { if (v.readyState >= 1) return res(); v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error("load")); });
    await new Promise((res) => { v.onseeked = () => res(); v.currentTime = startS; setTimeout(res, 1500); });
    if (ac.state === "suspended") await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    ac.createMediaElementSource(v).connect(dest); // suara hanya ke perekam, tidak ke speaker
    const cap = (v.captureStream || v.mozCaptureStream).call(v);
    const stream = new MediaStream([...cap.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime("video"), chunks = [];
    rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 });
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = () => res(); });
    rec.start(250);
    const t0 = Date.now();
    await v.play();
    await new Promise((res) => {
      timer = setInterval(() => {
        const el = Date.now() - t0; onTick(Math.min(el, maxMs));
        if (el >= maxMs || v.ended || (v.currentTime - startS) * 1000 >= maxMs - 40) res();
      }, 60);
    });
    clearInterval(timer);
    const dur = Math.min(maxMs, Math.max(400, Date.now() - t0));
    if (rec.state !== "inactive") rec.stop();
    await done;
    if (stopped) throw new Error("cancelled");
    const type = rec.mimeType || mime || "video/webm";
    const blob = new Blob(chunks, { type });
    if (blob.size < 1000) throw new Error("empty");
    return { file: new File([blob], `video.${type.includes("mp4") ? "mp4" : "webm"}`, { type }), durationMs: dur };
  } finally { cleanup(); }
}

// ------------------------------------------------------------------ Pemotong audio (mis. backsound > 3 menit)
// Audio didekode (WebAudio), bagian pilihan diambil, lalu disimpan sebagai WAV 16-bit. Tidak butuh MediaRecorder.
export const canTrimAudio = () => !!(window.AudioContext || window.webkitAudioContext);

/** @returns {Promise<{file: File, durationMs: number} | null>} null bila dibatalkan atau gagal. */
export function openAudioTrimmer({ file, durationMs, maxMs, maxBytes = 40 * 1024 * 1024 }) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const total = durationMs / 1000, win = maxMs / 1000, maxStart = Math.max(0, total - win);
    let start = 0, working = false, settled = false;
    const preview = h("audio", { class: "trim-audio", src: url, controls: "", preload: "metadata" });
    preview.style.setProperty("width", "100%");
    const label = h("div", { class: "trim-label" });
    const range = h("input", { class: "trim-range", type: "range", min: "0", max: String(maxStart), step: "0.1", value: "0", "aria-label": t("trim.audioTitle") });
    const go = h("button", { class: "btn primary", type: "button" }, t("trim.use"));
    const cancel = h("button", { class: "btn ghost", type: "button" }, t("common.cancel"));
    const paint = () => { label.textContent = `${t("trim.start", { t: fmtDur(start * 1000) })} → ${fmtDur(Math.min(total, start + win) * 1000)}`; };
    paint();
    const finish = (val) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(val); };
    const s = sheet({
      title: t("trim.audioTitle"),
      onClose: () => { preview.pause(); finish(null); },
      content: h("div", { class: "trim-body" }, h("p", { class: "muted" }, t("trim.audioHint", { d: Math.round(total), s: Math.round(win) })), preview, range, label, h("div", { class: "row-btns" }, cancel, go)),
    });
    range.addEventListener("input", () => { start = Number(range.value); paint(); try { preview.currentTime = start; } catch { /* belum siap */ } });
    cancel.addEventListener("click", () => s.close());
    go.addEventListener("click", async () => {
      if (working) return; working = true; go.disabled = true; range.disabled = true; preview.pause(); go.textContent = t("trim.working", { n: 0, s: Math.round(win) });
      try {
        const out = await cutAudio(file, start, maxMs, maxBytes);
        if (settled) return;
        finish(out); s.close();
      } catch (e) {
        if (settled) return;
        console.error(e); toast(t("trim.audioFailed"), "error"); working = false; go.disabled = false; range.disabled = false; go.textContent = t("trim.use");
      }
    });
  });
}

async function cutAudio(file, startS, maxMs, maxBytes) {
  const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
  try {
    const buf = await ac.decodeAudioData(await file.arrayBuffer());
    const rate = buf.sampleRate, from = Math.floor(startS * rate), len = Math.min(buf.length - from, Math.floor((maxMs / 1000) * rate));
    if (len <= 0) throw new Error("empty");
    let ch = Math.min(2, buf.numberOfChannels);
    if (44 + len * ch * 2 > maxBytes) ch = 1; // terlalu besar → jadikan mono
    const data = new Int16Array(len * ch), src = [];
    for (let c = 0; c < buf.numberOfChannels; c++) src.push(buf.getChannelData(c));
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const v = ch === 1 && src.length > 1 ? (src[0][from + i] + src[1][from + i]) / 2 : src[c][from + i];
        data[i * ch + c] = Math.max(-1, Math.min(1, v)) * 0x7fff;
      }
    }
    const head = new DataView(new ArrayBuffer(44)), w = (o, str) => { for (let i = 0; i < str.length; i++) head.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); head.setUint32(4, 36 + data.byteLength, true); w(8, "WAVE"); w(12, "fmt "); head.setUint32(16, 16, true); head.setUint16(20, 1, true);
    head.setUint16(22, ch, true); head.setUint32(24, rate, true); head.setUint32(28, rate * ch * 2, true); head.setUint16(32, ch * 2, true); head.setUint16(34, 16, true);
    w(36, "data"); head.setUint32(40, data.byteLength, true);
    const out = new File([head.buffer, data.buffer], "audio.wav", { type: "audio/wav" });
    return { file: out, durationMs: Math.round((len / rate) * 1000) };
  } finally { ac.close?.().catch?.(() => {}); }
}
