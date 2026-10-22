// Pemilih tanggal lahir buatan sendiri: tiga roda (tanggal, bulan, tahun). Bukan input tanggal bawaan peramban.
import { t, lang } from "./i18n.js";
import { h, icon, sheet } from "./ui.js";

const ITEM = 44;
export const monthNames = () => Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(lang() === "en" ? "en" : "id-ID", { month: "long" }));
export const daysIn = (m, y) => new Date(y, m, 0).getDate();

export function formatBirth(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${monthNames()[m - 1]} ${y}`;
}

function wheel(items, selected, onChange, label) {
  const col = h("div", { class: "wheel", role: "listbox", "aria-label": label, tabindex: "0" });
  const pad = () => h("div", { class: "wheel-pad" });
  let timer = 0, sel = selected;
  const list = h("div", { class: "wheel-list" });
  function paint() { for (const el of list.children) el.classList.toggle("on", Number(el.dataset.i) === sel); }
  // Posisi roda SELALU dibaca dari gulir (tidak ada status terpisah yang bisa basi): satu sumber kebenaran.
  const settle = () => {
    const i = Math.max(0, Math.min(items.length - 1, Math.round(col.scrollTop / ITEM)));
    sel = i; paint(); onChange(i);
  };
  function jump(i, smooth) { sel = Math.max(0, Math.min(items.length - 1, i)); paint(); col.scrollTo({ top: sel * ITEM, behavior: smooth ? "smooth" : "auto" }); }
  const rebuild = (arr, idx) => {
    items = arr;
    list.replaceChildren(...arr.map((txt, i) => h("button", { class: "wheel-item", type: "button", role: "option", "data-i": String(i), onclick: () => jump(i, true) }, txt)));
    requestAnimationFrame(() => jump(Math.min(idx, arr.length - 1), false));
  };
  col.addEventListener("scroll", () => {
    const i = Math.max(0, Math.min(items.length - 1, Math.round(col.scrollTop / ITEM)));
    if (i !== sel) { sel = i; paint(); }
    clearTimeout(timer); timer = setTimeout(settle, 110);
  }, { passive: true });
  col.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); jump(sel + 1, true); } if (e.key === "ArrowUp") { e.preventDefault(); jump(sel - 1, true); } });
  col.append(pad(), list, pad());
  rebuild(items, selected);
  return { el: col, rebuild, jump, get length() { return items.length; } };
}

/** Membuka pemilih. Mengembalikan Promise<string|null> berformat YYYY-MM-DD. */
export function pickBirthDate({ value, minAge = 13 } = {}) {
  return new Promise((resolve) => {
    const now = new Date();
    const maxYear = now.getFullYear() - minAge, minYear = now.getFullYear() - 110;
    const years = []; for (let y = maxYear; y >= minYear; y--) years.push(y);
    let [y, m, d] = value ? value.split("-").map(Number) : [maxYear - 8, 1, 1];
    if (y > maxYear) y = maxYear;
    // Batas: tidak boleh lebih muda dari minAge (dihitung sampai hari ini).
    const limit = new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate());
    const dayList = () => Array.from({ length: daysIn(m, y) }, (_, i) => String(i + 1));
    const preview = h("div", { class: "dp-preview" });
    const upd = () => { preview.textContent = `${d} ${monthNames()[m - 1]} ${y}`; };
    let wd, wm, wy;
    const tooYoung = () => new Date(y, m - 1, d) > limit;
    function normalize() {
      const n = daysIn(m, y);
      if (d > n) d = n;
      if (wd.length !== n) wd.rebuild(dayList(), d - 1);
      if (tooYoung()) { y = limit.getFullYear(); m = limit.getMonth() + 1; d = limit.getDate(); wd.rebuild(dayList(), d - 1); wm.jump(m - 1, true); wy.jump(years.indexOf(y), true); }
      upd();
    }
    wd = wheel(dayList(), d - 1, (i) => { d = i + 1; normalize(); }, t("dp.day"));
    wm = wheel(monthNames(), m - 1, (i) => { m = i + 1; normalize(); }, t("dp.month"));
    wy = wheel(years.map(String), years.indexOf(y), (i) => { y = years[i]; normalize(); }, t("dp.year"));
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
    const ok = h("button", { class: "btn primary block", type: "button", onclick: () => finish(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`) }, icon("check", 18), t("common.done"));
    const s = sheet({
      title: t("dp.title"), className: "datepicker", onClose: () => finish(null),
      content: h("div", { class: "dp" },
        preview,
        h("div", { class: "wheels" }, h("div", { class: "wheel-hl" }), h("div", { class: "wheel-labels" }, h("span", null, t("dp.day")), h("span", null, t("dp.month")), h("span", null, t("dp.year"))), h("div", { class: "wheel-cols" }, wd.el, wm.el, wy.el)),
        ok),
    });
    upd();
  });
}
