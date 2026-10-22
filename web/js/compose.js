// Penulis post: teks + foto + video (≤10 dtk) + suara, dari berkas atau langsung dari kamera/mikrofon.
import { api, upload, abs } from "./api.js";
import { openCamera } from "./capture.js";
import { t } from "./i18n.js";
import { openTrimmer, canTrim, openAudioTrimmer, canTrimAudio } from "./trim.js";
import { canRecord, compressImage, openPreview, probeDuration, recordAudio, audioPlayer, pauseAll } from "./media.js";
import { errText, needLogin, VIS, visibilityOptions } from "./post.js";
import { state } from "./router.js";
import { avatar, fmtDur, h, icon, sheet, toast } from "./ui.js";

/** onPosted(post) dipanggil setelah berhasil. */
export function openCompose({ onPosted, post = null } = {}) {
  if (needLogin()) return;
  const cfg = state.config;
  const me = state.me;
  const att = { items: [], audios: [] }; // items: foto+video BERURUTAN [{kind,file,url,durationMs,inRandom,existingId?}] (digeser seperti IG di feed); audio: {file,url,durationMs,inRandom}
  const maxAudios = cfg.maxAudios || 10, maxVisual = cfg.maxPhotos || 10, defRand = !!me.defaultInRandom;
  const revoke = (x) => { if (x && !x.existingId && x.url) URL.revokeObjectURL(x.url); }; // media lama (mode edit) memakai blob: URL milik penyimpanan → jangan dicabut
  const editing = !!post; // mode edit: semua bagian post (teks, media, visibilitas, Acak) bisa diubah
  let anon = editing ? !!post.anon : !!me.defaultAnon, visibility = editing ? post.visibility : me.defaultVisibility, recCtrl = null, sending = false;
  if (editing) for (const m of post.media || []) {
    const e = { existingId: m.id, kind: m.kind, file: null, url: m.url, durationMs: m.durationMs || 0, inRandom: m.inRandom === null || m.inRandom === undefined ? !!post.inRandom : !!m.inRandom, backsound: !!m.backsound };
    if (m.kind === "audio") att.audios.push(e); else att.items.push(e);
  }

  const ta = h("textarea", { class: "compose-text", rows: "4", placeholder: t("compose.placeholder"), "aria-label": t("compose.placeholder") });
  const counter = h("span", { class: "counter", hidden: true }); // tanpa batas panjang teks
  const tray = h("div", { class: "tray" });
  const recPanel = h("div", { class: "rec-panel", hidden: true });
  const visBtn = h("button", { class: "chip vis-chip", type: "button" });
  const randomRow = h("p", { class: "random-hint", hidden: true }, icon("shuffle", 16), h("span", null, t("compose.randomHint")));
  const bsRow = h("p", { class: "random-hint", hidden: true }, icon("music", 16), h("span", null, t("compose.backsoundHint")));
  if (editing) { ta.value = post.body || ""; }
  const submit = h("button", { class: "btn primary post-btn", type: "button" }, h("span", { class: "label" }, editing ? t("common.save") : t("compose.post")), h("span", { class: "pb-ring" }));
  const fileImg = h("input", { type: "file", accept: "image/*", class: "pick-input" }); // satu foto per ketukan (sama seperti komentar yang terbukti jalan; pilih-banyak sering gagal di WebView) // foto: label + input asli → satu ketukan langsung membuka pemilih
  // Input video/audio SELALU ada di DOM (tersembunyi) dan dipicu dari tombol di lembar pilihan. Dulu input-nya ada di dalam lembar yang
  // ikut hilang saat ditutup, sehingga di sebagian WebView/Android hasil pilihan tak pernah sampai.
  const fileVid = h("input", { type: "file", accept: "video/*", class: "file-hidden", tabindex: "-1", "aria-hidden": "true" });
  const fileAud = h("input", { type: "file", accept: "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm", class: "file-hidden", tabindex: "-1", "aria-hidden": "true" });
  const maxVideoS = Math.round((cfg.maxVideoMs || 10000) / 1000), maxAudioMs = cfg.maxAudioMs || 300000, maxAudioM = Math.round(maxAudioMs / 60000);

  const tools = h("div", { class: "tools" },
    pickTool("image", t("compose.photo"), fileImg),
    toolBtn("camera", t("compose.camera"), () => capture("photo")),
    toolBtn("video", t("compose.video"), () => addSheet(t("compose.addVideo"),
      canCam() ? { icon: "video", label: t("compose.recVideo"), hint: t("compose.videoLimit", { s: maxVideoS }), fn: () => capture("video") } : null,
      { icon: "image", label: t("compose.pickVideo"), hint: t("compose.videoLimit", { s: maxVideoS }), input: fileVid })),
    toolBtn("mic", t("compose.voice"), () => addSheet(t("compose.addAudio"),
      canRecord() ? { icon: "mic", label: t("compose.recAudio"), hint: t("compose.audioLimit", { m: maxAudioM }), fn: startRecording } : null,
      { icon: "volume", label: t("compose.pickAudio"), hint: t("compose.audioLimit", { m: maxAudioM }), input: fileAud })));
  function toolBtn(ic, label, fn) { return h("button", { class: "tool", type: "button", "aria-label": label, onclick: fn }, icon(ic, 22), h("span", null, label)); }
  function pickTool(ic, label, input) { return h("label", { class: "tool", "aria-label": label }, icon(ic, 22), h("span", null, label), input); }
  const canCam = () => canRecord() && !!navigator.mediaDevices?.getUserMedia;
  // Lembar pilihan: rekam langsung ATAU pilih berkas. input.click() dipanggil langsung dari ketukan pengguna (syarat pemilih berkas).
  let pickSheet = null;
  function addSheet(title, rec, up) {
    pauseAll();
    const row = (o, fn) => h("button", { class: "menu-item", type: "button", onclick: fn }, icon(o.icon, 20), h("span", { class: "menu-text" }, h("b", null, o.label), o.hint ? h("small", null, o.hint) : null));
    const rows = [];
    if (rec) rows.push(row(rec, () => { pickSheet?.close(); setTimeout(rec.fn, 150); }));
    rows.push(row(up, () => { up.input.click(); pickSheet?.close(); }));
    pickSheet = sheet({ title, content: h("div", { class: "menu" }, rows), onClose: () => { pickSheet = null; } });
  }
  // Menjalankan pengolah berkas pada change ATAU input (sebagian WebView hanya memicu salah satunya).
  function onFiles(input, fn) {
    let working = false;
    const run = async () => {
      const picked = [...(input.files || [])]; if (!picked.length || working) return;
      working = true;
      try {
        // Salin isi berkas ke memori SEGERA: di Android/WebView, File dari galeri/kamera bisa jadi tak terbaca lagi (blob: URL-nya gagal diputar,
        // penyimpanan gagal) bila dibaca belakangan atau setelah input dikosongkan.
        const files = [];
        for (const f of picked) {
          try { files.push(new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified })); }
          catch { working = false; input.value = ""; return toast(t("err.media_corrupt"), "error"); }
        }
        input.value = "";
        await fn(files);
      } catch (e) { toast(errText(e), "error"); } finally { working = false; }
    };
    input.addEventListener("change", run); input.addEventListener("input", run);
  }

  function refreshVis() { visBtn.replaceChildren(icon(VIS[visibility].icon, 16), h("span", null, t(VIS[visibility].key)), icon("down", 14)); }
  visBtn.addEventListener("click", () => {
    const s2 = sheet({ title: t("compose.whoCanSee"), content: visibilityOptions(visibility, (v) => { visibility = v; refreshVis(); setTimeout(() => s2.close(), 180); }) });
  });
  refreshVis();

  function refresh() {
    const has = att.items.length || att.audios.length;
    tray.replaceChildren(
      ...att.items.map((it, i) => thumb(it, { video: it.kind === "video", label: fmtDur(it.durationMs), remove: () => { revoke(it); att.items.splice(i, 1); refresh(); }, move: (d) => { const j = i + d; if (j < 0 || j >= att.items.length) return; [att.items[i], att.items[j]] = [att.items[j], att.items[i]]; refresh(); }, i })),
      ...att.audios.map(audioThumb));
    tray.classList.toggle("has", !!has);
    randomRow.hidden = !has; bsRow.hidden = !att.audios.length;
    submit.disabled = sending || !(ta.value.trim() || has);
  }
  /** Tombol Acak per media: menyala = media ini ikut halaman Acak. */
  function randToggle(it) {
    const b = h("button", { class: `thumb-rand ${it.inRandom ? "on" : ""}`, type: "button", "aria-pressed": String(!!it.inRandom), "aria-label": t("compose.inRandom"), title: t("compose.inRandom") }, icon("shuffle", 14));
    b.addEventListener("click", (e) => { e.stopPropagation(); it.inRandom = !it.inRandom; b.classList.toggle("on", it.inRandom); b.setAttribute("aria-pressed", String(it.inRandom)); });
    return b;
  }
  function thumb(it, { video, label, remove, move, i }) {
    const m = video ? h("video", { src: it.url + "#t=0.1", muted: "", playsinline: "", preload: "metadata" }) : h("img", { src: it.url, alt: "" });
    const open = h("button", { class: "thumb-open", type: "button", "aria-label": t("compose.preview"), onclick: () => openPreview(att.items.map((x) => ({ kind: x.kind, url: x.url })), i) },
      video ? h("span", { class: "thumb-play" }, icon("play", 18)) : null); // ketuk → pratinjau (video diputar sebelum diposting)
    return h("div", { class: "thumb pop-in" }, m, open, video ? h("span", { class: "thumb-badge" }, icon("video", 12), label) : null,
      h("span", { class: "thumb-n" }, String(i + 1)),
      randToggle(it),
      att.items.length > 1 ? h("div", { class: "thumb-move" },
        h("button", { type: "button", "aria-label": t("common.prev"), disabled: i === 0, onclick: () => move(-1) }, icon("back", 12)),
        h("button", { type: "button", "aria-label": t("common.next"), disabled: i === att.items.length - 1, onclick: () => move(1) }, icon("chevron", 12))) : null,
      h("button", { class: "thumb-x", type: "button", "aria-label": t("common.delete"), onclick: remove }, icon("x", 14)));
  }
  function audioThumb(a) {
    const player = audioPlayer({ id: "local" + a.url.slice(-8), url: a.url, durationMs: a.durationMs });
    const bsb = h("button", { class: `thumb-bs ${a.backsound ? "on" : ""}`, type: "button", "aria-pressed": String(!!a.backsound), "aria-label": t("compose.backsound"), title: t("compose.backsound") }, icon("music", 14));
    bsb.addEventListener("click", (e) => { e.stopPropagation(); const on = !a.backsound; for (const o of att.audios) o.backsound = false; a.backsound = on; refresh(); }); // hanya satu backsound
    return h("div", { class: "thumb audio pop-in" }, player, bsb, randToggle(a), h("button", { class: "thumb-x", type: "button", "aria-label": t("common.delete"), onclick: () => { player.destroy?.(); revoke(a); att.audios.splice(att.audios.indexOf(a), 1); refresh(); } }, icon("x", 14)));
  }

  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(260, ta.scrollHeight) + "px"; refresh(); });

  // ---- Foto dari berkas
  onFiles(fileImg, async (files) => {
    for (const f of files) {
      if (att.items.length >= maxVisual) { toast(t("compose.maxPhotos", { n: maxVisual }), "error"); break; }
      try { const c = await compressImage(f); att.items.push({ kind: "photo", file: c, url: URL.createObjectURL(c), durationMs: 0, inRandom: defRand }); }
      catch {
        // Tak bisa dikecilkan (format aneh): pakai berkas asli bila memang gambar.
        if ((f.type || "").startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(f.name)) att.items.push({ kind: "photo", file: f, url: URL.createObjectURL(f), durationMs: 0, inRandom: defRand });
        else toast(t("err.media_unsupported"), "error");
      }
      refresh();
    }
  });
  // ---- Video dari berkas: wajib ≤ 10 dtk
  onFiles(fileVid, async (files) => {
    const f = files[0];
    if (att.items.length >= maxVisual) return toast(t("compose.maxPhotos", { n: maxVisual }), "error");
    if (f.size > cfg.maxVideoBytes) return toast(t("err.video_too_large"), "error");
    if (!(f.type || "").startsWith("video/") && !/\.(mp4|m4v|mov|webm|3gp|mkv|avi|ogv)$/i.test(f.name)) return toast(t("err.media_unsupported"), "error");
    let d = 0;
    try { d = await probeDuration(f, "video"); } catch { return toast(t("compose.videoUnreadable"), "error"); } // peramban tak bisa membaca video ini (codec) → server pun tak bisa
    if (d > cfg.maxVideoMs + 300) {
      // Terlalu panjang: tawarkan pemotong (pengguna memilih bagian 10 detik) alih-alih langsung menolak.
      if (!canTrim()) return toast(t("trim.unsupported", { s: Math.round(cfg.maxVideoMs / 1000) }), "error");
      const r = await openTrimmer({ file: f, durationMs: d, maxMs: cfg.maxVideoMs });
      if (!r) return;
      att.items.push({ kind: "video", file: r.file, url: URL.createObjectURL(r.file), durationMs: r.durationMs, inRandom: defRand }); refresh(); return;
    }
    att.items.push({ kind: "video", file: f, url: URL.createObjectURL(f), durationMs: d, inRandom: defRand }); refresh();
  });
  onFiles(fileAud, async (files) => {
    const f = files[0];
    // Audio: maks. 5 menit (cfg.maxAudioMs).
    if (f.size > (cfg.maxAudioBytes || 40 * 1024 * 1024)) return toast(t("err.audio_too_large"), "error");
    let d = 0;
    try { d = await probeDuration(f, "audio"); } catch { /* tetap diterima; durasi tampil 0:00, server memeriksa lagi */ }
    if (d > maxAudioMs + 1500) { // terlalu panjang: tawarkan pemotong (pilih bagian yang dipakai) alih-alih menolak
      if (!canTrimAudio()) return toast(t("trim.audioUnsupported", { s: Math.round(maxAudioMs / 1000) }), "error");
      const r = await openAudioTrimmer({ file: f, durationMs: d, maxMs: maxAudioMs, maxBytes: cfg.maxAudioBytes || 40 * 1024 * 1024 });
      if (!r) return; setAudio(r.file, r.durationMs); return;
    }
    setAudio(f, d);
  });
  function setAudio(file, durationMs) { if (att.audios.length >= maxAudios) return toast(t("compose.maxAudios", { n: maxAudios }), "info"); att.audios.push({ kind: "audio", file, url: URL.createObjectURL(file), durationMs, inRandom: defRand }); refresh(); }

  // ---- Kamera langsung
  async function capture(mode) {
    // Kamera sendiri (getUserMedia) butuh https/localhost. Bila tak tersedia, jatuh ke kamera sistem lewat input `capture`.
    if (!navigator.mediaDevices?.getUserMedia || (mode === "video" && !canRecord())) {
      // Input harus menempel di DOM sampai hasilnya datang (input lepas bisa dibuang peramban sebelum event terkirim).
      const i = h("input", { type: "file", accept: mode === "video" ? "video/*" : "image/*", capture: "environment", class: "file-hidden", tabindex: "-1", "aria-hidden": "true" });
      const done = () => { setTimeout(() => i.remove(), 0); };
      i.addEventListener("change", () => { const f = i.files?.[0]; done(); if (!f) return; const dt = new DataTransfer(); dt.items.add(f); const target = mode === "video" ? fileVid : fileImg; target.files = dt.files; target.dispatchEvent(new Event("change")); });
      i.addEventListener("cancel", done);
      s.el.append(i); i.click(); return;
    }
    pauseAll();
    const r = await openCamera({ mode, maxVideoMs: cfg.maxVideoMs });
    if (!r) return;
    if (att.items.length >= maxVisual) return toast(t("compose.maxPhotos", { n: maxVisual }), "error");
    if (r.kind === "photo") att.items.push({ kind: "photo", file: r.file, url: URL.createObjectURL(r.file), durationMs: 0, inRandom: defRand });
    else att.items.push({ kind: "video", file: r.file, url: URL.createObjectURL(r.file), durationMs: r.durationMs, inRandom: defRand });
    refresh();
  }

  // ---- Rekam suara langsung
  async function startRecording() {
    if (att.audios.length >= maxAudios) return toast(t("compose.maxAudios", { n: maxAudios }), "info");
    if (!canRecord()) { fileAud.click(); return; }
    pauseAll();
    let ctrl;
    const level = h("div", { class: "rec-levels" }, Array.from({ length: 24 }, () => h("i")));
    const timeEl = h("span", { class: "rec-time" }, "0:00");
    const stopBtn = h("button", { class: "rec-stop", type: "button", "aria-label": t("compose.stopRec") }, icon("stop", 22));
    const cancelBtn = h("button", { class: "link-btn", type: "button" }, t("common.cancel"));
    recPanel.replaceChildren(h("span", { class: "rec-dot" }), timeEl, level, stopBtn, cancelBtn);
    recPanel.hidden = false; recPanel.classList.add("in");
    const hide = () => { recPanel.classList.remove("in"); setTimeout(() => { recPanel.hidden = true; }, 240); recCtrl = null; };
    try {
      ctrl = await recordAudio({
        maxMs: maxAudioMs,
        onTick: (ms) => { timeEl.textContent = `${fmtDur(ms)} / ${fmtDur(maxAudioMs)}`; },
        onLevel: (v) => { const bars = level.children; for (let i = 0; i < bars.length; i++) { const k = (Math.sin(performance.now() / 140 + i) + 1) / 2; bars[i].style.setProperty("--l", String(0.12 + v * (0.35 + 0.65 * k))); } },
      });
    } catch (e) { hide(); toast(e?.name === "NotAllowedError" ? t("cam.micDenied") : t("cam.unavailable"), "error"); return; }
    recCtrl = ctrl;
    stopBtn.addEventListener("click", () => ctrl.stop());
    cancelBtn.addEventListener("click", () => ctrl.cancel());
    try {
      const r = await ctrl.result; hide();
      if (r.durationMs < 400) return toast(t("cam.tooShort"), "error");
      const ext = r.mime.includes("mp4") ? "m4a" : r.mime.includes("ogg") ? "ogg" : "webm";
      setAudio(new File([r.blob], `suara.${ext}`, { type: r.mime }), r.durationMs);
    } catch (e) { hide(); if (e?.name !== "AbortError") toast(t("cam.unavailable"), "error"); }
  }

  // ---- Kirim (dengan kemajuan + animasi)
  submit.addEventListener("click", async () => {
    if (sending) return;
    const hasMedia = att.items.length || att.audios.length;
    if (!ta.value.trim() && !hasMedia) return;
    sending = true; submit.disabled = true; submit.classList.add("sending"); s.el.classList.add("busy");
    const form = new FormData();
    form.set("body", ta.value); form.set("visibility", visibility); form.set("anon", anon ? "1" : "0");
    const durations = [], randoms = [], keep = [], keepRandom = [], layout = [], backsounds = [], keepBacksound = [];
    // Media lama (mode edit) cukup dirujuk lewat id; hanya berkas baru yang diunggah. Urutan akhir dikirim lewat "layout".
    let n = 0;
    const add = (x) => {
      if (x.existingId) { keep.push(x.existingId); keepRandom.push(x.inRandom ? "1" : "0"); keepBacksound.push(x.backsound ? "1" : "0"); layout.push("k:" + x.existingId); return; }
      form.append("media", x.file, x.file.name); durations.push(Math.round(x.durationMs || 0)); randoms.push(x.inRandom ? "1" : "0"); backsounds.push(x.backsound ? "1" : "0"); layout.push("n:" + n++);
    };
    att.items.forEach(add);
    att.audios.forEach(add);
    form.set("durations", durations.join(",")); form.set("randoms", randoms.join(",")); form.set("backsounds", backsounds.join(","));
    if (editing) { form.set("keep", keep.join(",")); form.set("keepRandom", keepRandom.join(",")); form.set("keepBacksound", keepBacksound.join(",")); form.set("layout", layout.join(",")); }
    try {
      const r = await upload(editing ? `/api/posts/${post.id}` : "/api/posts", { method: editing ? "PATCH" : "POST", form, onProgress: (p) => submit.style.setProperty("--p", String(p)) });
      submit.classList.remove("sending"); submit.classList.add("done");
      setTimeout(() => { s.close(); onPosted?.(r.post); toast(editing ? t("common.saved") : t("compose.posted"), "ok"); }, 520);
    } catch (e) {
      sending = false; submit.classList.remove("sending"); s.el.classList.remove("busy"); submit.style.setProperty("--p", "0");
      toast(e?.code === "video_too_long" ? t("compose.videoTooLong", { s: Math.round(cfg.maxVideoMs / 1000) }) : errText(e), "error"); refresh();
    }
  });

  // Anonim: tanpa nama & foto profil di post; tetap muncul di bagian "Anonym" profil.
  const anonSw = h("input", { type: "checkbox", class: "switch", "aria-label": t("anon.label") }); anonSw.checked = anon;
  const anonRow = h("label", { class: "anon-switch" }, h("span", null, h("b", null, t("anon.label")), h("small", null, t("anon.hint"))), anonSw);
  const topEl = h("div", { class: "compose-top" });
  function refreshTop() {
    topEl.replaceChildren(anon ? h("span", { class: "avatar anon-ava", style: "--s:44px" }, icon("user", 22)) : avatar(me, 44),
      h("div", { class: "compose-meta" }, h("b", null, anon ? t("anon.name") : me.displayName), visBtn));
  }
  anonSw.addEventListener("change", () => { anon = anonSw.checked; refreshTop(); });
  refreshTop();
  const s = sheet({
    title: editing ? t("post.edit") : t("compose.title"), full: true, className: "compose",
    onClose: () => { recCtrl?.cancel(); pauseAll(); [...att.items, ...att.audios].forEach(revoke); },
    content: h("div", { class: "compose-body" },
      topEl, editing ? null : anonRow, // anonim hanya bisa dipilih saat membuat; tidak bisa diubah lewat edit
      ta, tray, recPanel, randomRow, bsRow),
  });
  s.el.append(fileVid, fileAud, h("div", { class: "compose-foot" }, tools, h("div", { class: "compose-send" }, counter, submit)));
  if (editing) { ta.style.height = "auto"; ta.style.height = Math.min(260, ta.scrollHeight) + "px"; randomRow.hidden = !(att.items.length || att.audios.length); bsRow.hidden = !att.audios.length; }
  refresh();
  setTimeout(() => ta.focus(), 360);
}
