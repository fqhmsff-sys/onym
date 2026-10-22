// Profil, daftar pengikut/mengikuti, dan Hubungan (butuh izin dua pihak).
import { api } from "./api.js";
import { t } from "./i18n.js";
import { errText, postCard } from "./post.js";
import { updateMe } from "./session.js";
import { go, state } from "./router.js";
import { openViewer } from "./viewer.js";
import { actionSheet, append, avatar, clear, compact, confirmDialog, emptyState, h, icon, infinite, sheet, skeletonCard, toast } from "./ui.js";
import { openCompose } from "./compose.js";
import { refreshMe } from "./session.js";

export const KIND_ICON = { friend: "users", bestfriend: "star", partner: "heart", family: "home" };
export const KINDS = ["friend", "bestfriend", "partner", "family"];

export function userRow(u, right) {
  return h("div", { class: "user-row" }, h("a", { class: "user-link", href: `#/u/${u.username}` }, avatar(u, 46), h("span", { class: "ur-t" }, h("b", null, u.displayName), h("small", null, "@" + u.username))), right || null);
}

/** Daftar post berhalaman. `path` mis. "/api/users/x/posts?media=1". */
function postList(path, emptyNode) {
  const list = h("div", { class: "feed-list" }), sentinel = h("div", { class: "sentinel" });
  let cursor = null, loading = false, done = false, any = false; const cards = new Set();
  const sep = path.includes("?") ? "&" : "?";
  async function load() {
    if (loading || done) return; loading = true;
    const sk = cursor === null ? [skeletonCard()] : []; list.append(...sk);
    try {
      const r = await api(`${path}${cursor ? `${sep}cursor=${cursor}` : ""}`);
      sk.forEach((x) => x.remove());
      r.items.forEach((p, i) => { const c = postCard(p, { onRemove: () => cards.delete(c) }); c.style.setProperty("--i", String(Math.min(i, 8))); c.classList.add("enter"); cards.add(c); list.append(c); any = true; });
      cursor = r.nextCursor; if (!cursor) { done = true; if (!any) list.append(emptyNode); }
    } catch (e) { sk.forEach((x) => x.remove()); done = true; list.append(h("div", { class: "retry" }, h("p", null, errText(e)))); }
    finally { loading = false; }
  }
  const stop = infinite(sentinel, load); load();
  return { el: h("div", null, list, sentinel), destroy() { stop(); cards.forEach((c) => c.destroy?.()); } };
}

export async function profilePage({ username }) {
  const root = h("section", { class: "page profile" }, h("div", { class: "card skel" }, h("i", { class: "skel-b" })));
  let p;
  try { p = (await api(`/api/users/${encodeURIComponent(username)}`)).profile; }
  catch { root.replaceChildren(emptyState("user", t("profile.notFound"), null, h("a", { class: "btn ghost", href: "#/" }, t("nav.home")))); return root; }
  const self = p.self;
  let list = null;

  const relChip = () => (p.relation?.status === "accepted" ? h("span", { class: "rel-chip" }, icon(KIND_ICON[p.relation.kind], 14), t(`kind.${p.relation.kind}`)) : null);
  const followBtn = h("button", { class: "btn follow", type: "button" });
  const relBtn = h("button", { class: "btn ghost", type: "button" });
  const countBtn = (n, label, href) => h("a", { class: "count", href }, h("b", null, compact(n)), h("span", null, label));
  const stats = h("div", { class: "counts" });
  const actions = h("div", { class: "profile-actions" });
  const head = h("div", { class: "card profile-head" });

  function renderHead() {
    stats.replaceChildren(
      h("div", { class: "count" }, h("b", null, compact(p.postCount)), h("span", null, t("profile.posts"))),
      countBtn(p.followerCount, t("profile.followers"), `#/u/${p.username}/followers`),
      countBtn(p.followingCount, t("profile.following"), `#/u/${p.username}/following`),
      countBtn(p.relationCount, t("profile.relations"), self ? "#/relations" : `#/u/${p.username}/relations`));
    followBtn.classList.toggle("on", p.following);
    followBtn.replaceChildren(icon(p.following ? "check" : "plus", 18), p.following ? t("profile.followingBtn") : t("profile.follow"));
    const rs = p.relation;
    relBtn.replaceChildren(icon(rs?.status === "accepted" ? KIND_ICON[rs.kind] : "link", 18), rs?.status === "accepted" ? t(`kind.${rs.kind}`) : rs?.status === "pending" ? (rs.direction === "incoming" ? t("rel.respond") : t("rel.sent")) : t("rel.connect"));
    relBtn.classList.toggle("on", !!rs);
    actions.replaceChildren(...(self
      ? [h("a", { class: "btn ghost grow", href: "#/settings/account" }, icon("edit", 18), t("profile.edit")), h("a", { class: "btn ghost", href: "#/relations" }, icon("link", 18), t("profile.relations"), state.me.pendingRelationRequests ? h("span", { class: "badge" }, state.me.pendingRelationRequests) : null), h("a", { class: "icon-btn outline", href: "#/settings", "aria-label": t("nav.settings") }, icon("gear", 20))]
      : [followBtn, relBtn]));
  }
  append(clear(head), [
    h("div", { class: "ph-top" }, h(p.avatarUrl ? "button" : "div", { class: "ph-avatar", ...(p.avatarUrl ? { type: "button", "aria-label": t("avatar.view"), onclick: () => openViewer([{ url: p.avatarUrl }]) } : {}) }, avatar(p, 88)),
      h("div", { class: "ph-id" }, h("h1", null, p.displayName), h("div", { class: "ph-user" }, "@" + p.username, p.followsMe && !self ? h("span", { class: "follows-you" }, t("profile.followsYou")) : null), relChip())),
    p.bio ? h("p", { class: "bio" }, p.bio) : null, stats, actions]);
  renderHead();

  followBtn.addEventListener("click", async () => {
    if (!state.me) { go("/login"); return; }
    const want = !p.following; followBtn.classList.add("bump"); setTimeout(() => followBtn.classList.remove("bump"), 400);
    p.following = want; p.followerCount += want ? 1 : -1; renderHead();
    try { await api(`/api/users/${p.username}/follow`, { method: want ? "POST" : "DELETE" }); }
    catch (e) { p.following = !want; p.followerCount += want ? -1 : 1; renderHead(); toast(errText(e), "error"); }
  });
  relBtn.addEventListener("click", () => { if (!state.me) { go("/login"); return; } relationSheet(p, (rel) => { p.relation = rel; if (rel?.status === "accepted" || (!rel)) { api(`/api/users/${p.username}`).then((r) => { p.relationCount = r.profile.relationCount; renderHead(); }); } renderHead(); }); });

  // Tab
  const defs = [["posts", "profile.tabPosts"], ["media", "profile.tabMedia"], ...(p.anonAccess ? [["anon", "anon.tab"]] : []), ...(self ? [["saved", "profile.tabSaved"]] : [])];
  const tabsEl = h("div", { class: "tabs seg", role: "tablist" }, ...defs.map(([k, key], i) => h("button", { class: `tab ${i === 0 ? "on" : ""}`, type: "button", role: "tab", dataset: { k }, onclick: () => showTab(k) }, t(key))), h("i", { class: "tab-ind" }));
  const body = h("div", { class: "tab-body" });
  function placeInd() { const on = tabsEl.querySelector(".tab.on"); const ind = tabsEl.querySelector(".tab-ind"); if (on) { ind.style.setProperty("width", `${on.offsetWidth}px`); ind.style.setProperty("transform", `translateX(${on.offsetLeft}px)`); } }
  function showTab(k) {
    tabsEl.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.k === k)); placeInd();
    list?.destroy(); body.classList.remove("in"); void body.offsetWidth;
    const path = k === "saved" ? "/api/me/saved" : k === "anon" ? `/api/users/${p.username}/anon` : `/api/users/${p.username}/posts${k === "media" ? "?media=1" : ""}`;
    const emptyNode = emptyState(k === "saved" ? "bookmark" : "image", k === "saved" ? t("profile.noSaved") : t("profile.noPosts"), k === "saved" ? t("profile.noSavedHint") : self ? t("profile.noPostsSelf") : null, self && k !== "saved" ? h("button", { class: "btn primary", type: "button", onclick: () => openCompose({ onPosted: () => showTab(k) }) }, icon("plus", 18), t("compose.title")) : null);
    const anonEmpty = k === "anon" ? emptyState("lock", t("anon.none"), t("anon.noneHint")) : null;
    list = postList(path, anonEmpty || emptyNode);
    const bar = k === "anon" && self ? h("div", { class: "anon-bar" }, h("span", null, t("anon.who") + ": ", h("b", null, t(`anon.v.${p.anonVisibility || "me"}`))), h("button", { class: "btn ghost", type: "button", onclick: () => anonWhoSheet(p, () => showTab("anon")) }, t("anon.change"))) : null;
    body.replaceChildren(...(bar ? [bar] : []), list.el); body.classList.add("in");
  }
  root.replaceChildren(head, tabsEl, body);
  showTab("posts"); requestAnimationFrame(placeInd);
  root.cleanup = () => list?.destroy();
  return root;
}

/** Lembar Hubungan: pilih jenis → kirim permintaan; atau tanggapi/batalkan/putuskan. */
export function relationSheet(p, onChange) {
  const rs = p.relation;
  const finish = (rel) => { s.close(); onChange(rel); refreshMe(); };
  let content;
  if (!rs) {
    content = h("div", { class: "rel-pick" }, h("p", { class: "lead" }, t("rel.explain", { name: p.displayName })),
      h("div", { class: "vis-options" }, KINDS.map((k) => h("button", { class: "vis-card", type: "button", onclick: async () => {
        try { const r = await api("/api/relations", { method: "POST", body: { username: p.username, kind: k } }); toast(t("rel.requestSent"), "ok"); finish(r.relation); } catch (e) { toast(errText(e), "error"); }
      } }, h("span", { class: "vis-ic" }, icon(KIND_ICON[k], 22)), h("span", { class: "vis-t" }, h("b", null, t(`kind.${k}`)), h("small", null, t(`kind.${k}Hint`)))))));
  } else if (rs.status === "pending" && rs.direction === "outgoing") {
    content = h("div", { class: "rel-state" }, h("div", { class: "rel-ic" }, icon(KIND_ICON[rs.kind], 30)), h("h3", null, t("rel.waiting", { kind: t(`kind.${rs.kind}`) })), h("p", null, t("rel.waitingHint", { name: p.displayName })),
      h("button", { class: "btn ghost block", type: "button", onclick: async () => { try { await api(`/api/relations/${p.username}`, { method: "DELETE" }); finish(null); toast(t("rel.cancelled"), "ok"); } catch (e) { toast(errText(e), "error"); } } }, t("rel.cancel")));
  } else if (rs.status === "pending") {
    content = h("div", { class: "rel-state" }, h("div", { class: "rel-ic" }, icon(KIND_ICON[rs.kind], 30)), h("h3", null, t("rel.incoming", { name: p.displayName, kind: t(`kind.${rs.kind}`) })), h("p", null, t("rel.incomingHint")),
      h("div", { class: "row-btns" },
        h("button", { class: "btn ghost", type: "button", onclick: async () => { try { await api(`/api/relations/${p.username}`, { method: "DELETE" }); finish(null); } catch (e) { toast(errText(e), "error"); } } }, t("notif.reject")),
        h("button", { class: "btn primary", type: "button", onclick: async () => { try { const r = await api(`/api/relations/${p.username}/accept`, { method: "POST" }); toast(t("rel.accepted"), "ok"); finish(r.relation); } catch (e) { toast(errText(e), "error"); } } }, t("notif.accept"))));
  } else {
    content = h("div", { class: "rel-state" }, h("div", { class: "rel-ic ok" }, icon(KIND_ICON[rs.kind], 30)), h("h3", null, t(`kind.${rs.kind}`) + " · " + p.displayName), h("p", null, t("rel.acceptedHint")),
      h("button", { class: "btn danger block", type: "button", onclick: async () => {
        if (!(await confirmDialog({ title: t("rel.confirmEnd", { name: p.displayName }), message: t("rel.confirmEndHint"), confirmText: t("rel.end"), danger: true }))) return;
        try { await api(`/api/relations/${p.username}`, { method: "DELETE" }); finish(null); toast(t("rel.ended"), "ok"); } catch (e) { toast(errText(e), "error"); }
      } }, t("rel.end")));
  }
  const s = sheet({ title: t("rel.title"), content });
  return s;
}

export async function followListPage({ username, kind }) {
  const list = h("div", { class: "user-list" }), sentinel = h("div", { class: "sentinel" });
  let cursor = null, loading = false, done = false, any = false;
  async function load() {
    if (loading || done) return; loading = true;
    try {
      const r = await api(`/api/users/${username}/${kind}${cursor ? `?cursor=${cursor}` : ""}`);
      r.items.forEach((u, i) => { const row = userRow(u); row.style.setProperty("--i", String(Math.min(i, 10))); row.classList.add("enter"); list.append(row); any = true; });
      cursor = r.nextCursor; if (!cursor) { done = true; if (!any) list.append(emptyState("users", t(`follow.none.${kind}`))); }
    } catch (e) { done = true; list.append(emptyState("info", errText(e))); } finally { loading = false; }
  }
  const stop = infinite(sentinel, load); load();
  const root = h("section", { class: "page" }, h("h2", { class: "page-title" }, t(kind === "followers" ? "profile.followers" : "profile.following"), h("small", null, " @" + username)), list, sentinel);
  root.cleanup = stop;
  return root;
}

export async function relationsPage() {
  const root = h("section", { class: "page relations" }, h("h2", { class: "page-title" }, t("profile.relations")), h("div", { class: "card skel" }, h("i", { class: "skel-b" })));
  async function render() {
    let d;
    try { d = await api("/api/relations"); } catch (e) { root.replaceChildren(emptyState("info", errText(e))); return; }
    const parts = [h("h2", { class: "page-title" }, t("profile.relations"))];
    const reload = async () => { await refreshMe(); render(); };
    if (d.incoming.length) parts.push(h("h3", { class: "section-t" }, t("rel.incomingTitle"), h("span", { class: "badge" }, d.incoming.length)), h("div", { class: "user-list" }, d.incoming.map((x) =>
      userRow(x.user, h("div", { class: "ur-actions" }, h("span", { class: "rel-chip" }, icon(KIND_ICON[x.kind], 14), t(`kind.${x.kind}`)),
        h("button", { class: "btn small primary", type: "button", onclick: async () => { try { await api(`/api/relations/${x.user.username}/accept`, { method: "POST" }); toast(t("rel.accepted"), "ok"); reload(); } catch (e) { toast(errText(e), "error"); } } }, t("notif.accept")),
        h("button", { class: "btn small ghost", type: "button", onclick: async () => { try { await api(`/api/relations/${x.user.username}`, { method: "DELETE" }); reload(); } catch (e) { toast(errText(e), "error"); } } }, t("notif.reject")))))));
    if (d.outgoing.length) parts.push(h("h3", { class: "section-t" }, t("rel.outgoingTitle")), h("div", { class: "user-list" }, d.outgoing.map((x) =>
      userRow(x.user, h("div", { class: "ur-actions" }, h("span", { class: "rel-chip" }, icon(KIND_ICON[x.kind], 14), t(`kind.${x.kind}`)),
        h("button", { class: "btn small ghost", type: "button", onclick: async () => { try { await api(`/api/relations/${x.user.username}`, { method: "DELETE" }); reload(); } catch (e) { toast(errText(e), "error"); } } }, t("rel.cancel")))))));
    if (d.accepted.length) {
      for (const k of KINDS) {
        const items = d.accepted.filter((x) => x.kind === k); if (!items.length) continue;
        parts.push(h("h3", { class: "section-t" }, icon(KIND_ICON[k], 18), t(`kind.${k}`), h("span", { class: "muted" }, items.length)), h("div", { class: "user-list" }, items.map((x, i) => {
          const row = userRow(x.user, h("button", { class: "icon-btn", type: "button", "aria-label": t("common.more"), onclick: () => actionSheet(x.user.displayName, [{ icon: "user", label: t("rel.viewProfile"), onClick: () => go(`/u/${x.user.username}`) }, { icon: "x", label: t("rel.end"), danger: true, onClick: async () => {
            if (!(await confirmDialog({ title: t("rel.confirmEnd", { name: x.user.displayName }), message: t("rel.confirmEndHint"), confirmText: t("rel.end"), danger: true }))) return;
            try { await api(`/api/relations/${x.user.username}`, { method: "DELETE" }); toast(t("rel.ended"), "ok"); reload(); } catch (e) { toast(errText(e), "error"); } } }]) }, icon("more", 20)));
          row.style.setProperty("--i", String(i)); row.classList.add("enter"); return row;
        })));
      }
    }
    if (parts.length === 1) parts.push(emptyState("link", t("rel.none"), t("rel.noneHint")));
    root.replaceChildren(...parts);
  }
  await render();
  return root;
}

/** Hubungan milik pengguna lain (hanya yang sudah disetujui kedua pihak). */
export async function userRelationsPage({ username }) {
  const root = h("section", { class: "page relations" }, h("h2", { class: "page-title" }, t("profile.relations"), h("small", null, " @" + username)));
  let d;
  try { d = await api(`/api/users/${encodeURIComponent(username)}/relations`); } catch (e) { root.append(emptyState("info", errText(e))); return root; }
  if (!d.items.length) { root.append(emptyState("link", t("rel.none"))); return root; }
  for (const k of KINDS) {
    const items = d.items.filter((x) => x.kind === k); if (!items.length) continue;
    root.append(h("h3", { class: "section-t" }, icon(KIND_ICON[k], 18), t(`kind.${k}`), h("span", { class: "muted" }, items.length)),
      h("div", { class: "user-list" }, items.map((x, i) => { const row = userRow(x.user); row.style.setProperty("--i", String(Math.min(i, 10))); row.classList.add("enter"); return row; })));
  }
  return root;
}

/** Pilih siapa yang bisa melihat bagian Anonym di profil sendiri. */
function anonWhoSheet(p, onDone) {
  const opts = ["everyone", "followers", "following", "mutual", "relations", "friend", "bestfriend", "partner", "family", "me"];
  const cur = p.anonVisibility || "me";
  const s2 = sheet({ title: t("anon.who"), content: h("div", null, h("p", { class: "lead" }, t("anon.whoHint")),
    h("div", { class: "vis-options" }, opts.map((k) => h("button", { class: `vis-card ${cur === k ? "on" : ""}`, type: "button", "aria-pressed": String(cur === k), onclick: async () => {
      try { await updateMe({ anonVisibility: k }); p.anonVisibility = k; toast(t("common.saved"), "ok"); s2.close(); onDone?.(); } catch (e) { toast(errText(e), "error"); }
    } }, h("span", { class: "vis-t" }, h("b", null, t(`anon.v.${k}`))), h("span", { class: "vis-check" }, icon("check", 18)))))) });
}
