// Kartu post (teks + audio + foto + video), suka (love), komentar, menu, privasi.
import { abs, api, ApiError, upload } from "./api.js";
import { t } from "./i18n.js";
import { openCompose } from "./compose.js";
import { attachKit } from "./attach.js";
import { audioPlayer, backsoundPlayer, mediaCarousel, openLightbox, pauseAll, videoPlayer } from "./media.js";
import { go, state, webUrl } from "./router.js";
import { actionSheet, append, avatar, busy, compact, confirmDialog, emptyState, fmtDur, h, icon, infinite, sheet, timeAgo, toast } from "./ui.js";

export const VIS = {
  public: { icon: "globe", key: "vis.public", hint: "vis.publicHint" },
  relationship: { icon: "link", key: "vis.relationship", hint: "vis.relationshipHint" },
  followers: { icon: "users", key: "vis.followers", hint: "vis.followersHint" },
  following: { icon: "users", key: "vis.following", hint: "vis.followingHint" },
  mutual: { icon: "users", key: "vis.mutual", hint: "vis.mutualHint" },
  friend: { icon: "users", key: "vis.friend", hint: "vis.friendHint" },
  bestfriend: { icon: "star", key: "vis.bestfriend", hint: "vis.bestfriendHint" },
  partner: { icon: "heart", key: "vis.partner", hint: "vis.partnerHint" },
  family: { icon: "home", key: "vis.family", hint: "vis.familyHint" },
  me: { icon: "lock", key: "vis.me", hint: "vis.meHint" },
};
export const errText = (e) => {
  const msg = t(`err.${e instanceof ApiError ? e.code : "unknown"}`, { n: state.config?.minAge ?? 13 });
  return e?.code === "unknown" || !(e instanceof ApiError) ? `${msg} (${e?.status ?? e?.name ?? "?"})` : msg;
};
export function needLogin() {
  if (state.me) return false;
  toast(t("err.unauthorized"), "info"); go("/login"); return true;
}

// ------------------------------------------------------------------ Suka (love) — seperti suka di komentar
function likeButton(post) {
  const n = h("span", { class: "n" }), btn = h("button", { class: "act like", type: "button", "aria-label": t("like.give") }, icon("heart", 21), n);
  const paint = () => { btn.classList.toggle("on", !!post.liked); btn.setAttribute("aria-pressed", String(!!post.liked)); btn.setAttribute("aria-label", post.liked ? t("like.remove") : t("like.give")); n.textContent = post.hideLikes ? "" : compact(post.likeCount || 0); };
  function burst() {
    for (let i = 0; i < 7; i++) {
      const p = h("i", { class: "spark" }), ang = (i / 7) * Math.PI * 2 + Math.random() * 0.5, d = 18 + Math.random() * 14;
      p.style.setProperty("--dx", `${Math.cos(ang) * d}px`); p.style.setProperty("--dy", `${Math.sin(ang) * d}px`); p.style.background = "#E0556B";
      btn.append(p); setTimeout(() => p.remove(), 650);
    }
  }
  btn.addEventListener("click", async () => {
    if (needLogin()) return;
    const was = !!post.liked;
    post.liked = !was; post.likeCount = Math.max(0, (post.likeCount || 0) + (was ? -1 : 1)); paint();
    if (!was) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); burst(); }
    try { const r = await api(`/api/posts/${post.id}/like`, { method: was ? "DELETE" : "PUT" }); post.liked = r.liked; post.likeCount = r.likeCount; }
    catch (e) { post.liked = was; post.likeCount = Math.max(0, (post.likeCount || 0) + (was ? 1 : -1)); toast(errText(e), "error"); }
    paint();
  });
  paint();
  return btn;
}

// ------------------------------------------------------------------ Komentar (gaya Threads: balasan bersarang, suka, foto)
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* jatuh ke cara lama */ }
  try {
    const ta = h("textarea", { class: "file-hidden", readonly: "" }); ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}
export function openComments(post, { onCount } = {}) {
  let cursor = null, loading = false, replyTo = null, all = [], players = [];
  const open = new Set(); // komentar yang balasannya dibuka semua
  const cfg = state.config || {};
  const list = h("div", { class: "comments threads" });
  const sentinel = h("div", { class: "sentinel" });
  const input = h("textarea", { class: "c-input", rows: "1", placeholder: t("comments.placeholder"), "aria-label": t("comments.placeholder") });
  const replying = h("div", { class: "replying", hidden: true });
  const send = h("button", { class: "icon-btn send", type: "button", "aria-label": t("comments.send") }, icon("send", 20));
  const plus = h("button", { class: "icon-btn c-plus", type: "button", "aria-label": t("comments.attach") }, icon("plus", 22));
  const kit = attachKit({ cfg, errText }); // foto, video, suara: sama seperti post
  const bar = h("div", { class: "comment-bar" }, replying, kit.tray, kit.recPanel, h("div", { class: "comment-row" }, plus, input, send), ...kit.inputs);
  const s = sheet({ title: t("comments.title"), full: true, content: [list, sentinel], onClose: () => { kit.destroy(); players.splice(0).forEach((p) => p.destroy?.()); pauseAll(); } });
  s.el.append(state.me ? bar : h("div", { class: "comment-bar" }, h("button", { class: "btn primary block", type: "button", onclick: () => { s.close(); go("/login"); } }, t("comments.loginToComment"))));
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });

  plus.addEventListener("click", kit.openMenu);

  // ---- Balas
  function clearReply() { replyTo = null; replying.hidden = true; replying.replaceChildren(); input.placeholder = t("comments.placeholder"); }
  function startReply(c) {
    replyTo = c; replying.hidden = false;
    replying.replaceChildren(h("span", null, t("comments.replyingToUser", { name: c.author.username })),
      h("button", { class: "icon-btn tiny", type: "button", "aria-label": t("common.cancel"), onclick: clearReply }, icon("x", 16)));
    input.placeholder = t("comments.replyTo", { name: c.author.displayName }); input.focus();
  }

  // ---- Suka
  const paintLike = (c, btn) => { btn.classList.toggle("on", !!c.liked); btn.setAttribute("aria-pressed", String(!!c.liked)); btn.querySelector(".n").textContent = c.likeCount ? compact(c.likeCount) : ""; };
  async function toggleLike(c, btn) {
    if (!state.me) { s.close(); needLogin(); return; }
    const was = !!c.liked;
    c.liked = !was; c.likeCount = Math.max(0, (c.likeCount || 0) + (was ? -1 : 1)); paintLike(c, btn);
    if (!was) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
    try { const r = await api(`/api/comments/${c.id}/like`, { method: was ? "DELETE" : "PUT" }); c.liked = r.liked; c.likeCount = r.likeCount; }
    catch (e) { c.liked = was; c.likeCount = Math.max(0, (c.likeCount || 0) + (was ? 1 : -1)); toast(errText(e), "error"); }
    paintLike(c, btn);
  }

  // ---- Menu, bagikan, hapus
  async function shareComment() {
    const url = webUrl(`/p/${post.id}`);
    if (navigator.share) { try { await navigator.share({ url, title: "Onym" }); return; } catch (e) { if (e?.name === "AbortError") return; } }
    toast((await copyToClipboard(url)) ? t("post.linkCopied") : t("err.unknown"), "ok");
  }
  async function del(c) {
    if (!(await confirmDialog({ title: t("comments.confirmDelete"), confirmText: t("common.delete"), danger: true }))) return;
    try {
      await api(`/api/comments/${c.id}`, { method: "DELETE" });
      const gone = new Set([c.id]);
      for (let grew = true; grew;) { grew = false; for (const x of all) if (x.parentId && gone.has(x.parentId) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }
      all = all.filter((x) => !gone.has(x.id));
      if (replyTo && gone.has(replyTo.id)) clearReply();
      post.commentCount = Math.max(0, (post.commentCount || 0) - gone.size); onCount?.(post.commentCount); render();
    } catch (e) { toast(errText(e), "error"); }
  }
  function editComment(c) {
    const ek = attachKit({ cfg, existing: c.media || [], errText });
    const ta = h("textarea", { class: "compose-text", rows: "4", "aria-label": t("comments.edit") }); ta.value = c.body || "";
    const add = h("button", { class: "icon-btn", type: "button", "aria-label": t("comments.attach") }, icon("plus", 22));
    const save = h("button", { class: "btn primary block", type: "button" }, t("common.save"));
    const s2 = sheet({ title: t("comments.edit"), full: true, onClose: () => { ek.destroy(); }, content: h("div", { class: "edit-comment" }, ta, ek.tray, ek.recPanel, h("div", { class: "edit-tools" }, add), save, ...ek.inputs) });
    add.addEventListener("click", ek.openMenu);
    setTimeout(() => ta.focus(), 250);
    save.addEventListener("click", async () => {
      if (save.disabled) return;
      if (!ta.value.trim() && !ek.hasAny()) return toast(t("err.comment_empty"), "error");
      save.disabled = true;
      const form = new FormData(); form.set("body", ta.value); ek.appendTo(form, { editing: true });
      try { const r = await upload(`/api/comments/${c.id}`, { method: "PATCH", form }); c.body = r.comment.body; c.editedAt = r.comment.editedAt; c.media = r.comment.media; s2.close(); render(); toast(t("common.saved"), "ok"); }
      catch (e) { save.disabled = false; toast(errText(e), "error"); }
    });
  }
  function menu(c) {
    actionSheet(t("comments.more"), [
      c.mine ? { icon: "edit", label: t("comments.edit"), onClick: () => editComment(c) } : null,
      c.body ? { icon: "copy", label: t("comments.copyText"), onClick: async () => toast((await copyToClipboard(c.body)) ? t("common.copied") : t("err.unknown"), "ok") } : null,
      state.me && !c.mine ? { icon: "flag", label: t("comments.report"), onClick: async () => { try { await api("/api/reports", { method: "POST", body: { targetType: "comment", targetId: c.id, reason: t("comments.reportReason") } }); toast(t("comments.reported"), "ok"); } catch (e) { toast(errText(e), "error"); } } } : null,
      c.mine || post.mine ? { icon: "trash", label: t("common.delete"), danger: true, onClick: () => del(c) } : null,
    ]);
  }

  // ---- Tampilan (pohon balasan bersarang)
  let byId = new Map(), kidsOf = new Map();
  function row(c, depth, line) {
    const like = h("button", { type: "button", class: `c-act c-like ${c.liked ? "on" : ""}`, "aria-pressed": String(!!c.liked), "aria-label": t("comments.like") }, icon("heart", 18), h("span", { class: "n" }, c.likeCount ? compact(c.likeCount) : ""));
    like.addEventListener("click", () => toggleLike(c, like));
    const vis = (c.media || []).filter((m) => m.kind !== "audio" && m.url), auds = (c.media || []).filter((m) => m.kind === "audio" && m.url);
    const car = vis.length ? mediaCarousel(vis) : null;
    if (car) { players.push(...car.players); }
    const auEls = auds.map((a) => { const p = audioPlayer({ id: c.id + a.id, url: a.url, durationMs: a.durationMs }); players.push(p); return h("div", { class: "c-audio" }, p); });
    const parent = c.parentId ? byId.get(c.parentId) : null;
    const showTo = c.replyTo && (depth >= 3 || !parent || parent.author.username !== c.replyTo.username);
    return h("div", { class: `comment ${depth ? "reply" : ""}`, dataset: { id: c.id } },
      h("div", { class: "c-rail" }, h("a", { href: `#/u/${c.author.username}`, onclick: () => s.close() }, avatar(c.author, depth ? 28 : 36)), line ? h("i", { class: "c-line" }) : null),
      h("div", { class: "c-main" },
        h("div", { class: "c-head" },
          h("a", { href: `#/u/${c.author.username}`, class: "c-name", onclick: () => s.close() }, c.author.displayName),
          c.byOwner ? h("span", { class: "c-badge" }, t("comments.author")) : null,
          h("span", { class: "muted" }, timeAgo(c.createdAt) + (c.editedAt ? ` · ${t("comments.edited")}` : ""))),
        showTo ? h("div", { class: "c-to" }, t("comments.replyingToUser", { name: c.replyTo.username })) : null,
        c.body ? h("p", { class: "c-body" }, c.body) : null,
        car ? h("div", { class: "c-media" }, car) : null, ...auEls,
        h("div", { class: "c-actions" },
          like,
          state.me ? h("button", { type: "button", class: "c-act", "aria-label": t("comments.reply"), onclick: () => startReply(c) }, icon("comment", 18), h("span", null, t("comments.reply"))) : null,
          h("button", { type: "button", class: "c-act", "aria-label": t("comments.share"), onclick: shareComment }, icon("repeat", 18)),
          h("button", { type: "button", class: "c-act", "aria-label": t("comments.more"), onclick: () => menu(c) }, icon("more", 18)))));
  }
  function node(c, depth) {
    const kids = kidsOf.get(c.id) || [];
    const isOpen = open.has(c.id);
    // Tingkat 0: tampilkan 1 balasan pertama sebagai pratinjau; tingkat lebih dalam: tertutup sampai dibuka.
    const shown = isOpen ? kids : depth === 0 ? kids.slice(0, 1) : [];
    const box = h("div", { class: `t-node d${Math.min(depth, 3)}` }, row(c, depth, shown.length > 0));
    if (shown.length) { const wrap = h("div", { class: "t-kids" }); shown.forEach((k) => wrap.append(node(k, depth + 1))); box.append(wrap); }
    if (kids.length > shown.length) box.append(h("button", { class: "link-btn t-more", type: "button", onclick: () => { open.add(c.id); render(); } }, t("comments.viewReplies", { n: kids.length - shown.length })));
    else if (isOpen && (depth > 0 || kids.length > 1)) box.append(h("button", { class: "link-btn t-more", type: "button", onclick: () => { open.delete(c.id); render(); } }, t("comments.hideReplies")));
    return box;
  }
  function render() {
    pauseAll(); players.splice(0).forEach((p) => p.destroy?.());
    const keep = list.parentElement?.scrollTop ?? 0;
    byId = new Map(all.map((c) => [c.id, c])); kidsOf = new Map();
    for (const c of all) if (c.parentId && byId.has(c.parentId)) { if (!kidsOf.has(c.parentId)) kidsOf.set(c.parentId, []); kidsOf.get(c.parentId).push(c); }
    for (const arr of kidsOf.values()) arr.sort((a, b) => a.createdAt - b.createdAt);
    list.replaceChildren();
    const tops = all.filter((c) => !c.parentId || !byId.has(c.parentId));
    if (!tops.length) { list.append(emptyState("comment", t("comments.empty"))); return; }
    for (const c of tops) list.append(h("div", { class: "thread" }, node(c, 0)));
    if (list.parentElement) list.parentElement.scrollTop = keep;
  }
  async function load() {
    if (loading) return; loading = true;
    try {
      const r = await api(`/api/posts/${post.id}/comments${cursor ? `?cursor=${cursor}` : ""}`);
      const have = new Set(all.map((x) => x.id));
      all.push(...r.items.filter((x) => !have.has(x.id))); cursor = r.nextCursor; render();
      if (!cursor) stop();
    } catch (e) { toast(errText(e), "error"); } finally { loading = false; }
  }
  const stop = infinite(sentinel, () => { if (cursor !== null || !all.length) load(); });
  load();

  send.addEventListener("click", busy(send, async () => {
    const body = input.value.trim(); if (!body && !kit.hasAny()) return;
    if (kit.isRecording()) return;
    const form = new FormData();
    form.set("body", body); if (replyTo) form.set("parentId", replyTo.id);
    kit.appendTo(form);
    try {
      const r = await upload(`/api/posts/${post.id}/comments`, { form });
      const c = r.comment;
      all.push(c);
      for (let p = c.parentId; p; p = byId.get(p)?.parentId) open.add(p); // buka seluruh rantai induk agar balasan baru terlihat
      input.value = ""; input.style.height = "auto"; kit.reset(); clearReply();
      post.commentCount = (post.commentCount || 0) + 1; onCount?.(post.commentCount); render();
      const el = list.querySelector(`[data-id="${c.id}"]`); el?.classList.add("fresh"); el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (e) { toast(errText(e), "error"); }
  }));
}

// ------------------------------------------------------------------ Pemilih privasi (dipakai penulis, menu post, pengaturan)
export function visibilityOptions(current, onPick, only = null) {
  return h("div", { class: "vis-options" }, Object.entries(VIS).filter(([k]) => !only || only.includes(k)).map(([key, v]) =>
    h("button", { class: `vis-card ${current === key ? "on" : ""}`, type: "button", "aria-pressed": String(current === key), onclick: (e) => {
      const card = e.currentTarget; card.parentElement.querySelectorAll(".vis-card").forEach((c) => c.classList.remove("on")); card.classList.add("on"); onPick(key);
    } }, h("span", { class: "vis-ic" }, icon(v.icon, 22)), h("span", { class: "vis-t" }, h("b", null, t(v.key)), h("small", null, t(v.hint))), h("span", { class: "vis-check" }, icon("check", 18)))));
}

// ------------------------------------------------------------------ Laporan
export function reportSheet(targetType, targetId) {
  const reasons = ["spam", "abuse", "inappropriate", "other"];
  const s = sheet({ title: t("report.title"), content: h("div", { class: "menu" }, reasons.map((r) =>
    h("button", { class: "menu-item", type: "button", onclick: async () => {
      try { await api("/api/reports", { method: "POST", body: { targetType, targetId, reason: t(`report.${r}`) } }); s.close(); toast(t("report.sent"), "ok"); } catch (e) { toast(errText(e), "error"); }
    } }, h("span", { class: "menu-text" }, h("b", null, t(`report.${r}`)))))) });
}

export async function sharePost(post) {
  const url = webUrl(`/p/${post.id}`);
  try {
    if (navigator.share) { await navigator.share({ title: "Onym", text: post.body?.slice(0, 80) || "", url }); return; }
    await navigator.clipboard.writeText(url); toast(t("post.linkCopied"), "ok");
  } catch (e) { if (e?.name !== "AbortError") { try { await navigator.clipboard.writeText(url); toast(t("post.linkCopied"), "ok"); } catch { toast(url); } } }
}

// ------------------------------------------------------------------ Kartu post
const reported = new Set(); // kunci "akun:post" — satu akun satu hitungan per post (ganti akun di perangkat yang sama tetap terhitung)
const viewObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    if (e.isIntersecting) el._vt = setTimeout(() => {
      const id = el.dataset.postId, rk = `${state.me?.id ?? "tamu"}:${id}`;
      if (!id || reported.has(rk)) return; reported.add(rk);
      api(`/api/posts/${id}/view`, { method: "POST" }).then((r) => {
        if (r?.viewCount == null) return;
        for (const v of document.querySelectorAll(`[data-post-id="${id}"] .views`)) if (v.lastChild) v.lastChild.textContent = compact(r.viewCount);
      }).catch(() => reported.delete(rk));
      viewObserver.unobserve(el);
    }, 1200);
    else clearTimeout(el._vt);
  }
}, { threshold: 0.6 });

export function postCard(post, { onRemove, detail = false, compact: isCompact = false } = {}) {
  const root = h("article", { class: "card post", dataset: { postId: post.id } });
  const players = [];
  const media = post.media || [];
  const visuals = media.filter((m) => m.kind !== "audio"), audios = media.filter((m) => m.kind === "audio"); // foto + video berurutan (geser seperti IG)

  const visBadge = h("span", { class: "vis-badge", title: t(VIS[post.visibility].key) }, icon(VIS[post.visibility].icon, 14));
  const more = h("button", { class: "icon-btn", type: "button", "aria-label": t("common.more") }, icon("more", 20));
  const head = post.anon
    ? h("header", { class: "post-head" },
      h("span", { class: "avatar anon-ava", style: "--s:42px" }, icon("user", 21)),
      h("div", { class: "post-who" },
        h("span", { class: "post-name" }, t("anon.name")),
        h("div", { class: "post-meta" }, post.mine ? h("span", { class: "anon-badge", title: t("anon.mine") }, icon("lock", 12), t("anon.mineShort")) : null, post.mine ? h("span", { class: "dot" }, "·") : null, h("a", { href: `#/p/${post.id}`, class: "muted" }, timeAgo(post.createdAt)), visBadge)),
      more)
    : h("header", { class: "post-head" },
    h("a", { href: `#/u/${post.author.username}`, "aria-label": post.author.displayName }, avatar(post.author, 42)),
    h("div", { class: "post-who" },
      h("a", { href: `#/u/${post.author.username}`, class: "post-name" }, post.author.displayName),
      h("div", { class: "post-meta" }, h("span", null, "@" + post.author.username), h("span", { class: "dot" }, "·"), h("a", { href: `#/p/${post.id}`, class: "muted" }, timeAgo(post.createdAt)), visBadge)),
    more);

  const body = post.body ? h("p", { class: "post-body" }, post.body) : null;
  if (body && !detail && [...post.body].length > 260) {
    body.classList.add("clamped");
    root.dataset.long = "1";
  }
  const moreText = body && body.classList.contains("clamped") ? h("button", { class: "link-btn more-text", type: "button", onclick: (e) => { body.classList.remove("clamped"); e.currentTarget.remove(); } }, t("post.readMore")) : null;

  const auto = !isCompact; // feed/detail/Acak: audio & video diputar otomatis saat terlihat
  const carousel = visuals.length ? mediaCarousel(visuals, { autoplay: auto }) : null;
  if (carousel) players.push(...carousel.players);
  // Suara yang dijadikan backsound (hanya di feed/detail): diputar di latar; selebihnya pemutar suara biasa seperti semula.
  const bsList = auto ? audios.filter((m) => m.backsound && m.url).slice(0, 1) : []; // satu backsound per post
  const bs = bsList.length ? backsoundPlayer(bsList) : null;
  if (bs) players.push(bs);
  const mediaBox = media.length ? h("div", { class: "post-media" },
    carousel,
    audios.filter((m) => !bsList.includes(m)).map((m) => { const p = audioPlayer(m, { autoplay: auto }); players.push(p); return p; }),
    bs) : null;

  // Aksi
  const like = likeButton(post);
  const cCount = h("span", null, compact(post.commentCount || 0));
  const cBtn = h("button", { class: "act", type: "button", "aria-label": t("comments.title"), onclick: () => openComments(post, { onCount: (n) => { cCount.textContent = compact(n || 0); } }) }, icon("comment", 21), cCount);
  const saveBtn = h("button", { class: `act save ${post.saved ? "on" : ""}`, type: "button", "aria-label": t("post.save"), "aria-pressed": String(post.saved) }, icon("bookmark", 21));
  const shareBtn = h("button", { class: "act", type: "button", "aria-label": t("post.share"), onclick: () => sharePost(post) }, icon("repeat", 21));
  const views = h("span", { class: "views", title: t("post.views") }, icon("eye", 15), compact(post.viewCount || 0));
  const actions = h("footer", { class: "post-actions" }, h("div", { class: "act-row start" }, like, cBtn, shareBtn), h("div", { class: "act-row" }, post.hideViews ? null : views, saveBtn));

  async function toggleSave() {
    if (needLogin()) return;
    const want = !post.saved; post.saved = want; saveBtn.classList.toggle("on", want); saveBtn.setAttribute("aria-pressed", String(want));
    saveBtn.classList.remove("pop"); void saveBtn.offsetWidth; saveBtn.classList.add("pop");
    try { await api(`/api/posts/${post.id}/save`, { method: want ? "PUT" : "DELETE" }); toast(want ? t("post.saved") : t("post.unsaved"), "ok"); }
    catch (e) { post.saved = !want; saveBtn.classList.toggle("on", !want); toast(errText(e), "error"); }
  }
  saveBtn.addEventListener("click", toggleSave);

  more.addEventListener("click", () => {
    const own = post.mine;
    actionSheet(null, [
      { icon: "bookmark", label: post.saved ? t("post.unsave") : t("post.save"), onClick: toggleSave },
      { icon: "share", label: t("post.share"), onClick: () => sharePost(post) },
      own ? { icon: "edit", label: t("post.edit"), onClick: () => openCompose({ post, onPosted: (np) => {
        players.forEach((p) => p.destroy?.());
        const nc = postCard(np, { onRemove, detail, compact: isCompact }); root.destroy?.(); root.replaceWith(nc);
      } }) } : null,
      own ? { icon: VIS[post.visibility].icon, label: t("post.changeVis"), hint: t(VIS[post.visibility].key), onClick: () => {
        const s2 = sheet({ title: t("post.changeVis"), content: visibilityOptions(post.visibility, async (v) => {
          try { const r = await api(`/api/posts/${post.id}`, { method: "PATCH", body: { visibility: v } }); post.visibility = r.post.visibility; visBadge.replaceChildren(icon(VIS[v].icon, 14)); visBadge.title = t(VIS[v].key); toast(t("common.saved"), "ok"); s2.close(); } catch (e) { toast(errText(e), "error"); }
        }) });
      } } : null,
      own && media.length ? { icon: "shuffle", label: post.inRandom ? t("post.leaveRandom") : t("post.joinRandom"), onClick: async () => {
        try { const r = await api(`/api/posts/${post.id}`, { method: "PATCH", body: { inRandom: !post.inRandom } }); post.inRandom = r.post.inRandom; toast(post.inRandom ? t("post.joinedRandom") : t("post.leftRandom"), "ok"); } catch (e) { toast(errText(e), "error"); }
      } } : null,
      own ? { icon: "trash", label: t("post.delete"), danger: true, onClick: async () => {
        if (!(await confirmDialog({ title: t("post.confirmDelete"), message: t("post.confirmDeleteHint"), confirmText: t("common.delete"), danger: true }))) return;
        try { await api(`/api/posts/${post.id}`, { method: "DELETE" }); players.forEach((p) => p.destroy?.()); root.classList.add("removing"); setTimeout(() => { root.remove(); onRemove?.(post); }, 360); toast(t("post.deleted"), "ok"); } catch (e) { toast(errText(e), "error"); }
      } } : { icon: "flag", label: t("report.title"), danger: true, onClick: () => reportSheet("post", post.id) },
    ]);
  });

  append(root, [head, body, moreText, mediaBox, actions]);
  if (!isCompact) viewObserver.observe(root);
  bs?.watch(root);
  root.destroy = () => { players.forEach((p) => p.destroy?.()); viewObserver.unobserve(root); };
  return root;
}
