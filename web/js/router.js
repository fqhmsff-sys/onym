// Router berbasis hash (#/jalur): bekerja sama persis di web (PWA) dan di aplikasi native (berkas lokal).
export const state = { me: null, config: null };
export const nav = { depth: 0 };
export const go = (path) => { if (location.hash !== `#${path}`) location.hash = `#${path}`; else window.dispatchEvent(new HashChangeEvent("hashchange")); };
// Tombol kembali: satu pintu untuk seluruh aplikasi. Ketukan beruntun (<450 ms) diabaikan agar tak mundur dua halaman sekaligus.
let lastBack = 0;
export const back = (fallback = "/") => { const now = Date.now(); if (now - lastBack < 450) return; lastBack = now; if (nav.depth > 0) history.back(); else go(fallback); };
/** Halaman induk (dipakai bila tak ada riwayat, mis. tautan langsung ke /settings/account). */
export const parentOf = (p) => (/^\/settings\/[a-z]+$/.test(p) || p === "/about" ? "/settings" : p === "/settings" ? "/me" : "/");
export const here = () => (location.hash.replace(/^#/, "") || "/");
export const webUrl = (path) => `${(window.ONYM_CONFIG?.webUrl || location.origin).replace(/\/$/, "")}/#${path}`;
