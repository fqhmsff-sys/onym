// Klien API. Web: cookie HttpOnly (asal sama). Aplikasi native: token Bearer (apiBase diisi saat build).
import { handle } from "./localapi.js";

const BASE = String(window.ONYM_CONFIG?.apiBase || "").replace(/\/$/, "");
export const isNative = BASE !== "";
const TOKEN_KEY = "hh_token";

export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
export const getToken = () => (isNative ? localStorage.getItem(TOKEN_KEY) : null);
export const setToken = (t) => { if (isNative) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } };
/** Ubah jalur /api/... menjadi URL absolut (di aplikasi native) agar <img>/<video>/<audio> memuat dari server. */
export const abs = (path) => {
  if (!path || typeof path !== "string") return path; // kosong/null tetap apa adanya (elemen tanpa sumber)
  if (path.startsWith("//") || path.startsWith("/\\")) return "about:blank"; // URL tanpa skema (//host) = asal luar → tolak
  if (path.startsWith("/")) return BASE + path;
  return /^(blob:|data:(image|video|audio)\/|https:\/\/)/i.test(path) ? path : "about:blank"; // javascript:, http:, dll. tidak pernah dimuat
};

function headers(extra = {}) {
  const h = { ...extra };
  const t = getToken();
  if (t) h.authorization = `Bearer ${t}`;
  return h;
}

async function parse(res) {
  let data = null;
  try { data = await res.json(); } catch { /* tubuh kosong */ }
  // Balasan galat tanpa JSON (mis. 404 HTML dari hosting statis) = backend Onym tidak terhubung di alamat ini.
  if (!res.ok) throw new ApiError(data?.error?.code || (data ? "unknown" : res.status >= 500 && res.status !== 502 ? "internal" : "server_unreachable"), res.status);
  return data;
}

export async function api(path, { method = "GET", body, signal } = {}) {
  // MODE LOKAL: seluruh backend berjalan di peramban (localStorage), tanpa server.
  return handle(method, path, { body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
  // eslint-disable-next-line no-unreachable
  let res;
  try {
    res = await fetch(BASE + path, {
      method, signal, credentials: isNative ? "omit" : "same-origin",
      headers: headers(body !== undefined ? { "content-type": "application/json" } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError("network", 0);
  }
  return parse(res);
}

/** Unggah dengan kemajuan (fetch belum punya progress unggah). */
export function upload(path, { method = "POST", form, raw, onProgress, signal }) {
  // MODE LOKAL: simpan langsung ke localStorage.
  return handle(method, path, { form, raw }).then((r) => { onProgress?.(1); return r; });
  // eslint-disable-next-line no-unreachable
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, BASE + path);
    x.withCredentials = !isNative;
    const t = getToken();
    if (t) x.setRequestHeader("authorization", `Bearer ${t}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onerror = () => reject(new ApiError("network", 0));
    x.onabort = () => reject(new DOMException("aborted", "AbortError"));
    x.onload = () => {
      let data = null;
      try { data = JSON.parse(x.responseText); } catch { /* kosong */ }
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(new ApiError(data?.error?.code || (data ? "unknown" : x.status >= 500 && x.status !== 502 ? "internal" : "server_unreachable"), x.status));
    };
    if (signal) signal.addEventListener("abort", () => x.abort());
    x.send(form ?? raw);
  });
}
