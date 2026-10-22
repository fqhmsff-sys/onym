// Pengaturan: Akun, Informasi pribadi, Privasi, Notifikasi, Bahasa, Tema, Keamanan, Akun lanjutan, Tentang.
import { api, upload } from "./api.js";
import { pickBirthDate, formatBirth } from "./datepicker.js";
import { t, setLang, lang } from "./i18n.js";
import { autoplayEnabledNow, backsoundEnabled, compressImage, setAutoplayEnabled, setBacksoundEnabled } from "./media.js";
import { aboutPage } from "./pages-misc.js";
import { errText, visibilityOptions } from "./post.js";
import { go, state } from "./router.js";
import { applyTheme, logout, setMe, updateMe } from "./session.js";
import { editAvatar } from "./avatar-editor.js";
import { openViewer } from "./viewer.js";
import { avatar, busy, confirmDialog, h, icon, sheet, timeAgo, toast } from "./ui.js";

const row = (ic, title, hint, onClick, badge) => h("button", { class: "set-row", type: "button", onclick: onClick }, h("span", { class: "set-ic" }, icon(ic, 20)), h("span", { class: "set-t" }, h("b", null, title), hint ? h("small", null, hint) : null), badge || null, icon("chevron", 18));
const toggle = (label, hint, checked, onChange) => {
  const input = h("input", { type: "checkbox", class: "switch" }); input.checked = checked;
  input.addEventListener("change", async () => { try { await onChange(input.checked); } catch (e) { input.checked = !input.checked; toast(errText(e), "error"); } });
  return h("label", { class: "switch-row" }, h("span", { class: "set-t" }, h("b", null, label), hint ? h("small", null, hint) : null), input);
};
const group = (title, ...c) => h("div", { class: "set-group" }, title ? h("h3", { class: "section-t" }, title) : null, h("div", { class: "card flush" }, c));
const field = (label, input, hint) => h("div", { class: "field" }, input, h("label", null, label), hint ? h("div", { class: "field-msg" }, hint) : null);

export function settingsPage({ section }) {
  const me = state.me;
  if (!me) { go("/login"); return h("div"); }
  if (!section) {
    return h("section", { class: "page settings" }, h("h2", { class: "page-title" }, t("nav.settings")),
      group(t("set.groupAccount"),
        row("user", t("set.account"), t("set.accountHint"), () => go("/settings/account")),
        row("calendar", t("set.personal"), formatBirth(me.birthDate), () => go("/settings/personal")),
        row("key", t("set.security"), null, () => go("/settings/security"))),
      group(t("set.groupPrivacy"),
        row("shield", t("set.privacy"), t(`vis.${me.defaultVisibility}`), () => go("/settings/privacy")),
        row("users", t("set.interactions"), t("set.interactionsHint"), () => go("/settings/interactions")),
        row("bell", t("set.notifications"), null, () => go("/settings/notifications"))),
      group(t("set.groupLook"),
        row(document.documentElement.dataset.theme === "dark" ? "moon" : "sun", t("set.appearance"), t("set.appearanceHint"), () => go("/settings/appearance")),
        row("shuffle", t("set.features"), t("set.featuresHint"), () => go("/settings/features")),
        row("globe", t("set.language"), lang() === "en" ? "English" : "Indonesia", () => go("/settings/language"))),
      group(t("set.groupOther"),
        row("logout", t("set.advanced"), null, () => go("/settings/advanced")),
        row("info", t("set.about"), null, () => go("/about"))),
      h("p", { class: "muted small set-foot" }, t("set.moreSoon")));
  }
  const page = (title, ...c) => h("section", { class: "page settings sub" }, h("header", { class: "set-head" }, h("h2", { class: "page-title" }, title)), ...c);

  switch (section) {
    case "account": {
      const name = h("input", { class: "input", value: me.displayName, maxlength: "40", placeholder: " " });
      const user = h("input", { class: "input", value: me.username, maxlength: "24", autocapitalize: "none", spellcheck: "false", placeholder: " " });
      const bio = h("textarea", { class: "input", rows: "3", maxlength: "160", placeholder: " " }, me.bio);
      const av = h("div", { class: "avatar-edit" });
      const file = h("input", { type: "file", accept: "image/*", hidden: true });
      const avBtn = () => { const b = h("button", { class: "avatar-tap", type: "button", "aria-label": t("avatar.view"), disabled: !state.me.avatarUrl }, avatar(state.me, 84)); b.addEventListener("click", () => state.me.avatarUrl && openViewer([{ url: state.me.avatarUrl }])); return b; }; // ketuk = lihat besar + zoom
      const saveAvatar = async (blob) => { await upload("/api/me/avatar", { method: "PUT", raw: blob }); const m = await api("/api/me"); setMe(m.me); paintAv(); toast(t("common.saved"), "ok"); };
      const paintAv = () => av.replaceChildren(avBtn(), h("div", { class: "av-actions" }, h("button", { class: "btn ghost small", type: "button", onclick: () => file.click() }, icon("camera", 16), t("profile.changePhoto")),
        state.me.avatarSourceUrl ? h("button", { class: "btn ghost small", type: "button", onclick: async () => { try { const blob = await editAvatar(state.me.avatarSourceUrl, { maxBytes: state.config.maxAvatarBytes }); if (blob) await saveAvatar(blob); } catch (e) { toast(errText(e), "error"); } } }, icon("edit", 16), t("avatar.reposition")) : null, state.me.avatarUrl ? h("button", { class: "btn ghost small danger", type: "button", onclick: async () => { try { await api("/api/me/avatar", { method: "DELETE" }); const m = await api("/api/me"); setMe(m.me); paintAv(); } catch (e) { toast(errText(e), "error"); } } }, t("common.delete")) : null));
      file.addEventListener("change", async () => {
        const f = file.files[0]; file.value = ""; if (!f) return;
        try {
          const blob = await editAvatar(f, { maxBytes: state.config.maxAvatarBytes }); // atur posisi + zoom dulu, warna tidak diubah
          if (!blob) return;
          await saveAvatar(blob);
          if (f.size <= (state.config.maxPhotoBytes || 6291456)) { try { await upload("/api/me/avatar/source", { method: "PUT", raw: f }); const m = await api("/api/me"); setMe(m.me); paintAv(); } catch { /* foto asli opsional (hanya untuk atur ulang posisi) */ } }
        } catch (e) { toast(errText(e), "error"); }
      });
      paintAv();
      const save = h("button", { class: "btn primary block", type: "button" }, t("common.save"));
      save.addEventListener("click", busy(save, async () => { try { await updateMe({ displayName: name.value, username: user.value, bio: bio.value }); toast(t("common.saved"), "ok"); } catch (e) { toast(errText(e), "error"); } }));
      // Ubah kata sandi
      const cur = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: " " }), nw = h("input", { class: "input", type: "password", autocomplete: "new-password", placeholder: " " });
      const pw = h("button", { class: "btn ghost block", type: "button" }, t("set.changePassword"));
      pw.addEventListener("click", busy(pw, async () => { try { await api("/api/me/password", { method: "POST", body: { currentPassword: cur.value, newPassword: nw.value } }); cur.value = nw.value = ""; toast(t("common.saved"), "ok"); } catch (e) { toast(errText(e), "error"); } }));
      return page(t("set.account"), h("div", { class: "set-hero" }, av, file),
        group(null, h("div", { class: "set-fields" }, field(t("auth.displayName"), name), field(t("auth.username"), user), field(t("profile.bio"), bio), save)),
        group(t("set.changePassword"), h("div", { class: "set-fields" }, field(t("set.currentPassword"), cur), field(t("set.newPassword"), nw), pw)));
    }
    case "personal": {
      const val = h("span", { class: "ib-value" }, formatBirth(me.birthDate));
      const btn = h("button", { class: "input-btn filled", type: "button", onclick: async () => { const v = await pickBirthDate({ value: state.me.birthDate, minAge: state.config.minAge }); if (v) { try { await updateMe({ birthDate: v }); val.textContent = formatBirth(v); toast(t("common.saved"), "ok"); } catch (e) { toast(errText(e), "error"); } } } }, icon("calendar", 20), h("span", { class: "ib-label" }, t("auth.birthDate")), val, icon("chevron", 18));
      return page(t("set.personal"), btn, group(null, toggle(t("set.birthPublic"), t("set.birthPublicHint"), me.birthDatePublic, (v) => updateMe({ birthDatePublic: v }))));
    }
    case "privacy": {
      return page(t("set.privacy"), h("p", { class: "lead" }, t("set.privacyLead")),
        group(t("set.defaultVis"), visibilityOptions(me.defaultVisibility, async (v) => { try { await updateMe({ defaultVisibility: v }); toast(t("common.saved"), "ok"); } catch (e) { toast(errText(e), "error"); } })),
        group(null, toggle(t("set.defaultRandom"), t("set.defaultRandomHint"), me.defaultInRandom, (v) => updateMe({ defaultInRandom: v }))), h("p", { class: "muted small set-note" }, t("set.visNote")));
    }
    case "notifications":
      return page(t("set.notifications"), group(null,
        toggle(t("set.nFollow"), null, me.notifFollow, (v) => updateMe({ notifFollow: v })),
        toggle(t("set.nRelation"), null, me.notifRelation, (v) => updateMe({ notifRelation: v })),
        toggle(t("set.nComment"), null, me.notifComment, (v) => updateMe({ notifComment: v })),
        toggle(t("set.nReply"), null, me.notifReply, (v) => updateMe({ notifReply: v }))));
    case "language": {
      const opt = (code, label) => h("button", { class: `menu-item ${lang() === code ? "sel" : ""}`, type: "button", onclick: async () => { try { await updateMe({ lang: code }); setLang(code); location.reload(); } catch (e) { toast(errText(e), "error"); } } }, h("span", { class: "menu-text" }, h("b", null, label)), lang() === code ? icon("check", 18) : null);
      return page(t("set.language"), h("div", { class: "card flush menu" }, opt("id", "Bahasa Indonesia"), opt("en", "English")));
    }
    case "theme": case "appearance": {
      const back = "/settings/" + section;
      const opt = (code, ic) => h("button", { class: `theme-card ${me.theme === code ? "on" : ""}`, type: "button", onclick: async () => { applyTheme(code); try { await updateMe({ theme: code }); } catch { /* tetap lokal */ } go(back); } }, h("span", { class: `theme-prev ${code}` }, h("i"), h("i"), h("i")), h("span", { class: "theme-l" }, icon(ic, 18), t(`set.${code}`)));
      const motionOn = (() => { try { return localStorage.getItem("hh_motion") !== "0"; } catch { return true; } })();
      return page(section === "theme" ? t("set.theme") : t("set.appearance"), h("div", { class: "theme-grid" }, opt("light", "sun"), opt("dark", "moon")),
        section === "appearance" ? group(null, toggle(t("set.motion"), t("set.motionHint"), motionOn, async (v) => {
          try { localStorage.setItem("hh_motion", v ? "1" : "0"); } catch { /* abaikan */ }
          if (v) delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = "off";
        })) : null);
    }
    case "interactions": {
      const rule = (label, hint, key, only) => {
        const val = h("small", null), paint = () => { val.textContent = t(`vis.${state.me[key] || "public"}`); }; paint();
        return h("button", { class: "set-row", type: "button", onclick: () => {
          const s2 = sheet({ title: label, content: h("div", null, h("p", { class: "lead" }, hint), visibilityOptions(state.me[key] || "public", async (v) => {
            try { await updateMe({ [key]: v }); paint(); toast(t("common.saved"), "ok"); setTimeout(() => s2.close(), 180); } catch (e) { toast(errText(e), "error"); }
          }, only)) });
        } }, h("span", { class: "set-t" }, h("b", null, label), val), icon("chevron", 18));
      };
      return page(t("set.interactions"),
        group(null,
          rule(t("set.commentWho"), t("set.commentWhoHint"), "commentWho"),
          rule(t("set.relationWho"), t("set.relationWhoHint"), "relationWho", ["public", "followers", "following", "mutual", "me"])),
        group(null,
          toggle(t("set.hideLikes"), t("set.hideLikesHint"), !!me.hideLikes, (v) => updateMe({ hideLikes: v })),
          toggle(t("set.hideViews"), t("set.hideViewsHint"), !!me.hideViews, (v) => updateMe({ hideViews: v }))));
    }
    case "features":
      return page(t("set.features"), group(null,
        toggle(t("set.autoplay"), t("set.autoplayHint"), autoplayEnabledNow(), (v) => setAutoplayEnabled(v)),
        toggle(t("set.backsoundOn"), t("set.backsoundOnHint"), backsoundEnabled(), (v) => setBacksoundEnabled(v)),
        toggle(t("set.defaultAnon"), t("set.defaultAnonHint"), !!me.defaultAnon, (v) => updateMe({ defaultAnon: v })),
        toggle(t("set.defaultRandom"), t("set.defaultRandomHint"), me.defaultInRandom, (v) => updateMe({ defaultInRandom: v }))));
    case "security": return securityPage(page);
    case "advanced": {
      const out = h("button", { class: "btn ghost block", type: "button" }, icon("logout", 18), t("set.logout"));
      out.addEventListener("click", async () => { await logout(); go("/login"); });
      const del = h("button", { class: "btn danger block", type: "button" }, icon("trash", 18), t("set.deleteAccount"));
      del.addEventListener("click", () => {
        const pwd = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: " " });
        const ok = h("button", { class: "btn danger block", type: "button" }, t("set.deleteConfirm"));
        const s = sheet({ title: t("set.deleteAccount"), content: h("div", { class: "rel-state" }, h("p", null, t("set.deleteHint")), field(t("auth.password"), pwd), ok) });
        ok.addEventListener("click", busy(ok, async () => { try { await api("/api/me", { method: "DELETE", body: { password: pwd.value } }); s.close(); setMe(null, null); go("/login"); toast(t("set.deleted"), "ok"); } catch (e) { toast(errText(e), "error"); } }));
      });
      return page(t("set.advanced"), group(null, h("div", { class: "set-fields" }, out)), h("div", { class: "danger-zone" }, h("p", { class: "muted" }, t("set.deleteHint")), del));
    }
    default: return aboutPage();
  }
}

function securityPage(page) {
  const list = h("div", { class: "set-list" });
  async function load() {
    try {
      const r = await api("/api/sessions");
      list.replaceChildren(...r.items.map((s) => h("div", { class: "session-row" }, h("span", { class: "set-ic" }, icon("globe", 20)), h("span", { class: "set-t" }, h("b", null, s.device, s.current ? h("span", { class: "rel-chip" }, t("set.thisDevice")) : null), h("small", null, timeAgo(s.lastSeenAt))),
        s.current ? null : h("button", { class: "btn small ghost", type: "button", onclick: async () => { await api(`/api/sessions/${s.id}`, { method: "DELETE" }); load(); } }, t("set.revoke")))));
    } catch (e) { list.replaceChildren(h("p", { class: "muted pad" }, errText(e))); }
  }
  load();
  const others = h("button", { class: "btn ghost block", type: "button", onclick: async () => { await api("/api/sessions/revoke-others", { method: "POST" }); toast(t("common.saved"), "ok"); load(); } }, t("set.revokeOthers"));
  const regen = h("button", { class: "btn ghost block", type: "button" }, icon("key", 18), t("set.regen"));
  regen.addEventListener("click", () => {
    const pwd = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: " " });
    const ok = h("button", { class: "btn primary block", type: "button" }, t("set.regen"));
    const body = h("div", { class: "rel-state" }, h("p", null, t("set.regenHint")), field(t("auth.password"), pwd), ok);
    const s = sheet({ title: t("set.regen"), content: body });
    ok.addEventListener("click", busy(ok, async () => {
      try {
        const r = await api("/api/me/recovery-codes", { method: "POST", body: { password: pwd.value } });
        body.replaceChildren(h("p", null, t("recovery.explain")), h("div", { class: "codes" }, r.recoveryCodes.map((c) => h("code", null, c))),
          h("button", { class: "btn ghost block", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(r.recoveryCodes.join("\n")); toast(t("common.copied"), "ok"); } catch { /* abaikan */ } } }, icon("copy", 18), t("common.copy")),
          h("button", { class: "btn primary block", type: "button", onclick: () => s.close() }, t("common.done")));
      } catch (e) { toast(errText(e), "error"); }
    }));
  });
  return page(t("set.security"), group(t("set.sessions"), list), others, group(t("set.recovery"), h("div", { class: "set-fields" }, regen)));
}
