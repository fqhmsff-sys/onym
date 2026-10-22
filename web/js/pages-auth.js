// Masuk, daftar (pemilih tanggal lahir buatan sendiri), kode pemulihan, pulihkan akun.
import { api } from "./api.js";
import { pickBirthDate, formatBirth } from "./datepicker.js";
import { t } from "./i18n.js";
import { errText } from "./post.js";
import { go, state } from "./router.js";
import { setMe } from "./session.js";
import { mark } from "./brand.js";
import { busy, h, icon, toast } from "./ui.js";

const logoMark = () => h("div", { class: "auth-logo" }, mark("o-mark")); // logo final (iris mengintip pelan)

function field({ label, type = "text", name, autocomplete, hint, maxlength, inputmode }) {
  const input = h("input", { class: "input", type, name, autocomplete, maxlength, inputmode, autocapitalize: "none", spellcheck: "false", placeholder: " ", id: `f-${name}` });
  const msg = h("div", { class: "field-msg" }, hint || "");
  const wrap = h("div", { class: "field" }, input, h("label", { for: `f-${name}` }, label), msg);
  if (type === "password") {
    const eye = h("button", { class: "icon-btn eye", type: "button", "aria-label": t("auth.showPassword") }, icon("eye", 20));
    eye.addEventListener("click", () => { const show = input.type === "password"; input.type = show ? "text" : "password"; eye.replaceChildren(icon(show ? "eyeoff" : "eye", 20)); eye.setAttribute("aria-label", show ? t("auth.hidePassword") : t("auth.showPassword")); });
    wrap.append(eye);
  }
  return { wrap, input, msg, setMsg(text, kind = "") { msg.textContent = text; msg.className = `field-msg ${kind}`; } };
}

export function loginPage() {
  const u = field({ label: t("auth.username"), name: "username", autocomplete: "username" });
  const p = field({ label: t("auth.password"), type: "password", name: "password", autocomplete: "current-password" });
  const err = h("div", { class: "form-error", role: "alert" });
  const btn = h("button", { class: "btn primary block", type: "submit" }, h("span", { class: "label" }, t("auth.login")));
  const form = h("form", { class: "auth-form", novalidate: "", onsubmit: busy(btn, async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!u.input.value.trim() || !p.input.value) { err.textContent = t("err.bad_credentials"); return shake(form); }
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { username: u.input.value, password: p.input.value } });
      setMe(r.me, r.token); go("/");
    } catch (ex) { err.textContent = errText(ex); shake(form); }
  }) }, u.wrap, p.wrap, err, btn);
  return h("section", { class: "page auth" }, logoMark(), h("h1", null, t("auth.loginTitle")), h("p", { class: "lead" }, t("app.tagline")), form,
    h("div", { class: "auth-links" }, h("a", { href: "#/recover" }, t("auth.forgot")), h("span", null, t("auth.noAccount"), " ", h("a", { href: "#/register" }, t("auth.register")))),
    h("a", { class: "link-btn center", href: "#/" }, t("auth.browse")));
}
function shake(el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }

export function registerPage() {
  const name = field({ label: t("auth.displayName"), name: "displayName", autocomplete: "name", maxlength: 40 });
  const u = field({ label: t("auth.username"), name: "username", autocomplete: "username", hint: t("auth.usernameRules"), maxlength: 24 });
  const p = field({ label: t("auth.password"), type: "password", name: "password", autocomplete: "new-password", hint: t("auth.passwordHint", { n: 8 }) });
  let birth = null;
  const birthBtn = h("button", { class: "input-btn", type: "button" }, icon("calendar", 20), h("span", { class: "ib-label" }, t("auth.birthDate")), h("span", { class: "ib-value" }, t("auth.birthPick")), icon("chevron", 18));
  const birthMsg = h("div", { class: "field-msg" }, t("auth.birthHint", { n: state.config?.minAge ?? 13 }));
  birthBtn.addEventListener("click", async () => {
    const v = await pickBirthDate({ value: birth, minAge: state.config?.minAge ?? 13 });
    if (v) { birth = v; birthBtn.querySelector(".ib-value").textContent = formatBirth(v); birthBtn.classList.add("filled"); }
  });
  let timer = 0;
  u.input.addEventListener("input", () => {
    clearTimeout(timer); const v = u.input.value.trim().replace(/^@/, "").toLowerCase();
    if (v.length < 3) return u.setMsg(t("auth.usernameRules"));
    timer = setTimeout(async () => {
      try { const r = await api(`/api/username-available?u=${encodeURIComponent(v)}`); r.available ? u.setMsg(t("auth.usernameOk"), "ok") : u.setMsg(t(`err.${r.code || "username_taken"}`), "bad"); } catch { /* abaikan */ }
    }, 350);
  });
  const err = h("div", { class: "form-error", role: "alert" });
  const btn = h("button", { class: "btn primary block", type: "submit" }, h("span", { class: "label" }, t("auth.register")));
  const form = h("form", { class: "auth-form", novalidate: "", onsubmit: busy(btn, async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!birth) { err.textContent = t("err.birth_date_invalid"); return shake(form); }
    const [by, bm, bd] = birth.split("-").map(Number), n = new Date(), min = state.config?.minAge ?? 13;
    let age = n.getFullYear() - by; if (n.getMonth() + 1 < bm || (n.getMonth() + 1 === bm && n.getDate() < bd)) age--;
    if (age < min) { err.textContent = t("err.underage", { n: min }); return shake(form); }
    try {
      const r = await api("/api/auth/register", { method: "POST", body: { displayName: name.input.value, username: u.input.value, password: p.input.value, birthDate: birth } });
      showRecovery(r, root);
    } catch (ex) { err.textContent = errText(ex); shake(form); }
  }) }, name.wrap, u.wrap, p.wrap, h("div", { class: "field" }, birthBtn, birthMsg), err, btn);
  const root = h("section", { class: "page auth" }, logoMark(), h("h1", null, t("auth.registerTitle")), h("p", { class: "lead" }, t("auth.registerLead")), form,
    h("div", { class: "auth-links center" }, h("span", null, t("auth.haveAccount"), " ", h("a", { href: "#/login" }, t("auth.login")))));
  return root;
}

/** Layar kode pemulihan: ditampilkan sekali; pengguna wajib menegaskan sudah menyimpannya. */
function showRecovery(result, host) {
  const codes = result.recoveryCodes;
  const ok = h("input", { type: "checkbox", class: "check", id: "rc-ok" });
  const go1 = h("button", { class: "btn primary block", type: "button", disabled: true }, t("common.continue"));
  ok.addEventListener("change", () => { go1.disabled = !ok.checked; });
  go1.addEventListener("click", () => { setMe(result.me, result.token); go("/"); });
  const copy = h("button", { class: "btn ghost block", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(codes.join("\n")); toast(t("common.copied"), "ok"); } catch { toast(t("err.unknown"), "error"); } } }, icon("copy", 18), t("common.copy"));
  host.replaceChildren(h("div", { class: "auth-logo ok" }, icon("shield", 34)), h("h1", null, t("recovery.title")), h("p", { class: "lead" }, t("recovery.explain")),
    h("div", { class: "codes" }, codes.map((c, i) => h("code", { style: { "--i": i } }, c))), copy,
    h("label", { class: "check-row" }, ok, h("span", null, t("recovery.confirm"))), go1);
  window.scrollTo(0, 0);
}

export function recoverPage() {
  const u = field({ label: t("auth.username"), name: "username", autocomplete: "username" });
  const c = field({ label: t("recover.code"), name: "code", autocomplete: "off", maxlength: 14 });
  const p = field({ label: t("recover.newPassword"), type: "password", name: "newPassword", autocomplete: "new-password" });
  const err = h("div", { class: "form-error", role: "alert" });
  const btn = h("button", { class: "btn primary block", type: "submit" }, h("span", { class: "label" }, t("recover.submit")));
  const form = h("form", { class: "auth-form", novalidate: "", onsubmit: busy(btn, async (e) => {
    e.preventDefault(); err.textContent = "";
    try {
      const r = await api("/api/auth/recover", { method: "POST", body: { username: u.input.value, recoveryCode: c.input.value, newPassword: p.input.value } });
      toast(t("recover.done", { n: r.remainingCodes }), "ok"); go("/login");
    } catch (ex) { err.textContent = errText(ex); shake(form); }
  }) }, u.wrap, c.wrap, p.wrap, err, btn);
  return h("section", { class: "page auth" }, logoMark(), h("h1", null, t("recover.title")), h("p", { class: "lead" }, t("recover.explain")), form, h("a", { class: "link-btn center", href: "#/login" }, t("common.back")));
}
