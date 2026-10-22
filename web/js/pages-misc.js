// Cari, Notifikasi, Tentang.
import { api } from "./api.js";
import { mark, word } from "./brand.js";
import { t } from "./i18n.js";
import { errText, postCard } from "./post.js";
import { go, state } from "./router.js";
import { KIND_ICON, userRow } from "./pages-profile.js";
import { avatar, emptyState, h, icon, infinite, timeAgo, toast } from "./ui.js";
import { refreshMe } from "./session.js";

export function searchPage() {
  const input = h("input", { class: "search-input", type: "search", placeholder: t("search.placeholder"), "aria-label": t("search.placeholder"), autocomplete: "off", autocapitalize: "none", enterkeyhint: "search", maxlength: "50" });
  const clearBtn = h("button", { class: "icon-btn tiny clear", type: "button", "aria-label": t("common.clear"), hidden: true, onclick: () => { input.value = ""; input.focus(); run(); } }, icon("x", 16));
  const bar = h("div", { class: "search-bar" }, icon("search", 20), input, clearBtn);
  const out = h("div", { class: "search-out" }, h("p", { class: "muted center" }, t("search.hint")));
  let timer = 0, seq = 0, cards = [];
  function run() {
    clearTimeout(timer); clearBtn.hidden = !input.value;
    const q = input.value.trim().replace(/^@/, "");
    if (q.length < 2) { cards.forEach((c) => c.destroy?.()); cards = []; out.replaceChildren(h("p", { class: "muted center" }, t("search.hint"))); return; }
    out.replaceChildren(h("div", { class: "search-loading" }, h("i"), h("i"), h("i")));
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (my !== seq) return;
        cards.forEach((c) => c.destroy?.()); cards = [];
        const parts = [];
        if (r.users.length) parts.push(h("h3", { class: "section-t" }, t("search.people")), h("div", { class: "user-list" }, r.users.map((u, i) => { const row = userRow(u); row.style.setProperty("--i", String(i)); row.classList.add("enter"); return row; })));
        if (r.posts.length) parts.push(h("h3", { class: "section-t" }, t("search.posts")), h("div", { class: "feed-list" }, r.posts.map((p, i) => { const c = postCard(p, { compact: true }); c.style.setProperty("--i", String(i)); c.classList.add("enter"); cards.push(c); return c; })));
        out.replaceChildren(...(parts.length ? parts : [emptyState("search", t("search.none"))]));
      } catch (e) { if (my === seq) out.replaceChildren(emptyState("info", errText(e))); }
    }, 320);
  }
  input.addEventListener("input", run);
  const root = h("section", { class: "page search" }, bar, out);
  root.cleanup = () => cards.forEach((c) => c.destroy?.());
  setTimeout(() => input.focus(), 380);
  return root;
}

export async function notificationsPage() {
  const list = h("div", { class: "notif-list" }), sentinel = h("div", { class: "sentinel" });
  let cursor = null, loading = false, done = false, any = false, marked = false;
  const text = (n) => {
    switch (n.type) {
      case "follow": return t("notif.follow");
      case "comment": return t("notif.comment");
      case "reply": return t("notif.reply");
      case "comment_like": return t("notif.comment_like");
      case "post_like": return t("notif.post_like");
      case "relation_request": return t("notif.relation_request", { kind: t(`kind.${n.kind}`) });
      case "relation_accepted": return t("notif.relation_accepted", { kind: t(`kind.${n.kind}`) });
      default: return "";
    }
  };
  function item(n, i) {
    const right = [];
    if (n.type === "relation_request" && n.actionable) {
      const row = h("div", { class: "ur-actions" });
      const act = async (accept, btn) => {
        try {
          await api(accept ? `/api/relations/${n.actor.username}/accept` : `/api/relations/${n.actor.username}`, { method: accept ? "POST" : "DELETE" });
          row.replaceChildren(h("span", { class: "muted" }, accept ? t("rel.accepted") : t("rel.declined"))); if (accept) el.classList.add("accepted"); refreshMe();
        } catch (e) { toast(errText(e), "error"); btn.disabled = false; }
      };
      const ok = h("button", { class: "btn small primary", type: "button", onclick: () => { ok.disabled = true; act(true, ok); } }, t("notif.accept"));
      const no = h("button", { class: "btn small ghost", type: "button", onclick: () => { no.disabled = true; act(false, no); } }, t("notif.reject"));
      row.append(ok, no); right.push(row);
    }
    const iconName = n.type.startsWith("relation") ? (KIND_ICON[n.kind] || "link") : n.type === "follow" ? "user" : (n.type === "comment_like" || n.type === "post_like") ? "heart" : "comment";
    const href = n.postId ? `#/p/${n.postId}` : `#/u/${n.actor.username}`;
    const el = h("div", { class: `notif ${n.read ? "" : "unread"} enter`, style: { "--i": Math.min(i, 10) } },
      h("a", { class: "notif-main", href }, h("span", { class: "notif-av" }, avatar(n.actor, 44), h("span", { class: "notif-ic" }, icon(iconName, 12))),
        h("span", { class: "notif-t" }, h("span", null, h("b", null, n.actor.displayName), " ", text(n)), n.commentPreview ? h("q", null, n.commentPreview) : null, h("small", null, timeAgo(n.createdAt)))),
      ...right);
    return el;
  }
  async function load() {
    if (loading || done) return; loading = true;
    try {
      const r = await api(`/api/notifications${cursor ? `?cursor=${cursor}` : ""}`);
      r.items.forEach((n, i) => { list.append(item(n, i)); any = true; });
      cursor = r.nextCursor; if (!cursor) { done = true; if (!any) list.append(emptyState("bell", t("notif.empty"), t("notif.emptyHint"))); }
      if (!marked && state.me?.unreadNotifications) { marked = true; setTimeout(() => api("/api/notifications/read", { method: "POST" }).then(refreshMe).catch(() => {}), 1200); }
    } catch (e) { done = true; list.append(emptyState("info", errText(e))); } finally { loading = false; }
  }
  const stop = infinite(sentinel, load); load();
  const root = h("section", { class: "page" }, h("h2", { class: "page-title" }, t("notif.title")), list, sentinel);
  root.cleanup = stop;
  return root;
}

export function aboutPage() {
  const rows = (title, items) => h("section", { class: "card info-table" }, h("div", { class: "table-title" }, title), items.map(([k, v]) => h("div", { class: "row" }, h("span", null, k), h("strong", null, v))));
  const logo = h("div", { class: "about-logo" }, mark("o-mark"));
  return h("section", { class: "page about" }, h("div", { class: "card about-identity" }, logo, h("h1", { class: "about-word", "aria-label": "Onym" }, word("o-word")), h("p", null, t("app.tagline"))),
    rows(t("about.info"), [[t("about.function"), t("about.functionValue")], [t("about.interaction"), t("about.interactionValue")], [t("about.privacy"), t("about.privacyValue")]]),
    rows(t("about.maker"), [[t("about.madeBy"), "misyi"], [t("about.year"), "2026"]]));
}
