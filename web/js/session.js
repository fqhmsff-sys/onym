// Sesi pengguna: satu tempat untuk memuat/menyimpan `me`, tema, bahasa, dan keluar.
import { api, getToken, setToken } from "./api.js";
import { setLang } from "./i18n.js";
import { state } from "./router.js";

const listeners = new Set();
export const onMe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f(state.me));

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("hh_theme", theme); } catch { /* abaikan */ }
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = theme === "dark" ? "#0E0F12" : "#FFFFFF";
}
export function setMe(me, token) {
  if (token !== undefined) setToken(token);
  state.me = me;
  if (me) { applyTheme(me.theme); setLang(me.lang); }
  emit();
}
export async function refreshMe() {
  try { const r = await api("/api/session"); if (r.me) setMe(r.me); else if (state.me || getToken()) setMe(null, null); } catch (e) { if (e.status === 401) setMe(null, null); }
  return state.me;
}
export async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* sesi sudah habis */ }
  setMe(null, null);
}
/** Perbarui sebagian `me` secara lokal + di server. */
export async function updateMe(patch) {
  const r = await api("/api/me", { method: "PATCH", body: patch });
  setMe(r.me); return r.me;
}
