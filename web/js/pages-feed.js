// Beranda (feed), Acak, dan detail post.
import { api } from "./api.js";
import { openCompose } from "./compose.js";
import { t } from "./i18n.js";
import { audioPlayer, mediaCarousel, pauseAll } from "./media.js";
import { errText, postCard } from "./post.js";
import { openViewer } from "./viewer.js";
import { go, state } from "./router.js";
import { avatar, emptyState, h, icon, infinite, skeletonCard, toast } from "./ui.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function feedPage() {
  let scope = state.me && sessionStorage.getItem("hh_feed_scope") === "following" ? "following" : "all";
  const list = h("div", { class: "feed-list" });
  const sentinel = h("div", { class: "sentinel" });
  let cursor = null, loading = false, done = false, gen = 0, stopInf = () => {};
  const cards = new Set();

  const composer = state.me
    ? h("div", { class: "card composer", role: "button", tabindex: "0", onclick: () => openCompose({ onPosted: prepend }), onkeydown: (e) => { if (e.key === "Enter") openCompose({ onPosted: prepend }); } },
        avatar(state.me, 40), h("span", { class: "composer-ph" }, t("compose.prompt")),
        h("span", { class: "composer-ic" }, icon("image", 20), icon("video", 20), icon("mic", 20)))
    : h("div", { class: "card cta" }, h("div", null, h("b", null, t("cta.title")), h("p", null, t("cta.text"))), h("a", { class: "btn primary", href: "#/login" }, t("auth.login")));

  const tabs = state.me ? h("div", { class: "tabs seg", role: "tablist" },
    ...[["all", "feed.all"], ["following", "feed.following"]].map(([k, key]) => h("button", { class: `tab ${scope === k ? "on" : ""}`, type: "button", role: "tab", "aria-selected": String(scope === k), dataset: { k }, onclick: () => setScope(k) }, t(key))),
    h("i", { class: "tab-ind" })) : null;
  const placeInd = () => { if (!tabs) return; const on = tabs.querySelector(".tab.on"); const ind = tabs.querySelector(".tab-ind"); if (on) { ind.style.setProperty("width", `${on.offsetWidth}px`); ind.style.setProperty("transform", `translateX(${on.offsetLeft}px)`); } };
  function setScope(k) {
    if (k === scope) return; scope = k; sessionStorage.setItem("hh_feed_scope", k);
    tabs.querySelectorAll(".tab").forEach((b) => { const on = b.dataset.k === k; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    placeInd(); reset(true);
  }

  function clearCards() { cards.forEach((c) => c.destroy?.()); cards.clear(); list.replaceChildren(); }
  function prepend(post) {
    list.querySelector(".empty")?.remove();
    const c = postCard(post, { onRemove: (p) => cards.delete(c) }); c.classList.add("fresh"); cards.add(c); list.prepend(c);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function load() {
    if (loading || done) return; loading = true; const my = gen;
    const skels = cursor === null ? [skeletonCard(), skeletonCard()] : [];
    list.append(...skels);
    try {
      const r = await api(`/api/feed?scope=${scope}${cursor ? `&cursor=${cursor}` : ""}`);
      if (my !== gen) return;
      skels.forEach((x) => x.remove());
      r.items.forEach((p, i) => { const c = postCard(p, { onRemove: () => cards.delete(c) }); c.style.setProperty("--i", String(Math.min(i, 8))); c.classList.add("enter"); cards.add(c); list.append(c); });
      cursor = r.nextCursor; if (!cursor) done = true;
      if (!list.children.length) list.append(emptyState("home", scope === "following" ? t("feed.emptyFollowing") : t("feed.empty"), scope === "following" ? t("feed.emptyFollowingHint") : t("feed.emptyHint")));
    } catch (e) {
      skels.forEach((x) => x.remove());
      if (my === gen) { list.append(h("div", { class: "retry" }, h("p", null, errText(e)), h("button", { class: "btn ghost", type: "button", onclick: (ev) => { ev.currentTarget.parentElement.remove(); done = false; load(); } }, icon("refresh", 18), t("common.retry")))); done = true; }
    } finally { if (my === gen) loading = false; }
  }
  function reset(animate) { gen++; loading = false; done = false; cursor = null; pauseAll(); if (animate) list.classList.add("swap"); clearCards(); setTimeout(() => list.classList.remove("swap"), 300); load(); }

  const root = h("section", { class: "page feed" }, composer, tabs, list, sentinel);
  stopInf = infinite(sentinel, load);
  load();
  requestAnimationFrame(placeInd);
  root.refresh = () => { window.scrollTo({ top: 0, behavior: "smooth" }); reset(true); };
  root.cleanup = () => { stopInf(); clearCards(); };
  root.keep = true;
  return root;
}

/** Kartu Acak: HANYA satu media (tanpa teks/media lain dari post-nya). Foto diketuk → pelihat layar penuh (popup). */
function randomCard(post, item) {
  const root = h("article", { class: "card post rand-card" });
  const players = [];
  let node;
  if (item.kind === "audio") { node = audioPlayer(item, { autoplay: true }); players.push(node); }
  else { node = mediaCarousel([item], { autoplay: true }); players.push(...node.players); }
  if (post.anon) { // anonim: tanpa profil/nama/tabel post — hanya media
    root.classList.add("rand-anon");
    root.append(h("div", { class: "post-media" }, node));
    root.destroy = () => players.forEach((p) => p.destroy?.());
    return root;
  }
  const head = h("header", { class: "post-head" },
    h("a", { href: `#/u/${post.author.username}`, "aria-label": post.author.displayName }, avatar(post.author, 36)),
    h("div", { class: "post-who" }, h("a", { href: `#/u/${post.author.username}`, class: "post-name" }, post.author.displayName), h("div", { class: "post-meta" }, h("span", null, "@" + post.author.username))),
    h("a", { class: "icon-btn", href: `#/p/${post.id}`, "aria-label": t("post.title") }, icon("chevron", 20)));
  root.append(head, h("div", { class: "post-media" }, node));
  root.destroy = () => players.forEach((p) => p.destroy?.());
  return root;
}

export function randomPage() {
  const stage = h("div", { class: "rand-stage" });
  const btn = h("button", { class: "rand-btn", type: "button", "aria-label": t("random.button") },
    h("span", { class: "rand-ring r1" }), h("span", { class: "rand-ring r2" }), h("span", { class: "rand-core" }, icon("shuffle", 38)));
  const label = h("p", { class: "rand-label" }, t("random.hint"));
  const hero = h("div", { class: "rand-hero" }, btn, label, h("small", { class: "muted" }, t("random.note")));
  let card = null, busy = false, lastId = null;

  async function draw() {
    if (busy) return; busy = true; pauseAll();
    root.classList.add("drawing");
    if (card) { card.classList.add("flip-out"); }
    try {
      const [r] = await Promise.all([api("/api/random", { method: "POST", body: { exclude: lastId } }), delay(card ? 520 : 800)]);
      lastId = r.item?.id ?? null; // SATU media saja (foto/video/suara), dipilih acak sungguhan dari semua media yang diizinkan pemiliknya
      card?.destroy?.(); card?.remove();
      card = r.item ? randomCard(r.post, r.item) : postCard(r.post); card.classList.add("flip-in");
      stage.replaceChildren(card);
      root.classList.add("has-result"); label.textContent = t("random.again");
      if (r.post.anon && r.item?.kind === "photo") openViewer([{ url: r.item.url }]); // media anonim langsung popup
    } catch (e) {
      card?.classList.remove("flip-out");
      if (e.code === "no_media") { root.classList.remove("has-result"); stage.replaceChildren(emptyState("shuffle", t("random.empty"), t("random.emptyHint"))); }
      else toast(errText(e), "error");
    } finally { busy = false; root.classList.remove("drawing"); }
  }
  btn.addEventListener("click", draw);
  const root = h("section", { class: "page random" }, hero, stage);
  root.cleanup = () => card?.destroy?.();
  return root;
}

export async function postPage({ id }) {
  const root = h("section", { class: "page detail" }, skeletonCard());
  try {
    const r = await api(`/api/posts/${id}`);
    const card = postCard(r.post, { detail: true, onRemove: () => go("/") });
    root.replaceChildren(card); root.cleanup = () => card.destroy?.();
    card.classList.add("enter");
  } catch (e) {
    root.replaceChildren(emptyState("lock", t("post.notFound"), t("post.notFoundHint"), h("a", { class: "btn ghost", href: "#/" }, t("nav.home"))));
  }
  return root;
}
