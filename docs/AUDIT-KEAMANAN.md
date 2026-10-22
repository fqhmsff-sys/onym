# Onym — Laporan Audit, Perbaikan & Hardening

Tanggal: 21 Oktober 2026 · Cakupan: `web/` (PWA + backend lokal localStorage), `apps/api` (Worker + D1 + R2), `packages/shared`, `mobile/`, `.github/`
Kerangka: OWASP Top 10 (2021) · Metode: baca seluruh kode → petakan alur data → buktikan bug dengan uji nyata → perbaiki → uji ulang.

## 1. Ringkasan

| | Hasil |
|---|---|
| Temuan terverifikasi & sudah diperbaiki | 14 |
| Temuan terbuka (butuh keputusan/infrastruktur) | 9 |
| Tes API | 27 → **31 lulus, 0 gagal** (4 tes regresi baru) |
| Bukti sebelum/sesudah | limiter lama meloloskan **100 dari 100** permintaan paralel (batas 60); versi baru tepat 60 |

**Catatan versi localStorage:** mode ini sengaja untuk tes. Ia *tidak pernah* aman untuk publik (lihat O5). Perbaikan di bagian lokal bertujuan menjaga integritas data & paritas perilaku dengan server, bukan membuatnya aman.

## 2. Langkah perbaikan yang SUDAH diterapkan

Format: **Action · Owner · Risk · Rationale/Deliverable**

### F1 — Data hilang saat dua tab terbuka (OWASP A04)
- **Action:** `localapi.js` menyinkronkan cache dengan localStorage di awal tiap permintaan (`syncCache`) dan membuang perubahan belum-commit bila permintaan gagal (rollback).
- **Owner:** Frontend.
- **Risk:** Akun/post hilang diam-diam. Terbukti: tab A daftar `tabuser1`, tab B daftar `tabuser2` → `tabuser1` terhapus dari storage tetapi tab A masih bisa login.
- **Deliverable:** setelah perbaikan keduanya bertahan.

### F2 — Edit post gagal di server (bug fungsional)
- **Action:** `PATCH /api/posts/:id` kini menerima multipart (teks, privasi, Acak, `keep`, media baru) lewat `editPostWithMedia`; objek R2 yang dibuang/yatim dibersihkan.
- **Owner:** Backend.
- **Risk:** UI mengirim multipart saat edit; server lama hanya menerima JSON → semua edit gagal (400) begitu beralih dari localStorage ke backend.
- **Deliverable:** tes "edit post penuh" (urutan media, batas jenis, R2 bersih, hanya pemilik).

### F3 — Pembatas laju bisa dilewati (A04/A07)
- **Action:** `rateLimit` diganti satu pernyataan `UPSERT … RETURNING` atomik.
- **Owner:** Backend.
- **Risk:** versi lama baca-lalu-tulis; permintaan paralel melewati batas login/daftar/pemulihan. Terbukti 100/100 lolos.
- **Deliverable:** tes paralel (tepat 60 lolos, 40 ditolak).

### F4 — Penyerang bisa mengunci korban (A07)
- **Action:** kunci login/pemulihan jadi per *pengguna + IP*, ditambah plafon global per pengguna (login 100/15 mnt, pemulihan 30/jam).
- **Owner:** Backend.
- **Risk:** 10 percobaan salah dari mana pun mengunci pemilik akun 15 menit (DoS akun) dan memblokir pemulihan 1 jam.
- **Deliverable:** tes: penyerang IP A terkunci, pemilik dari IP B tetap bisa masuk.

### F5 — Header `Origin: null` menyebabkan galat 500 (A05)
- **Action:** `originHost()` aman di `router.ts`; Origin tak valid → 403.
- **Owner:** Backend.
- **Risk:** 500 + log galat di produksi (iframe tersandbox mengirim `null`); melanggar target "tanpa error log".
- **Deliverable:** tes regresi.

### F6 — Mode lokal tanpa pembatas laju (A07)
- **Action:** pembatas laju lokal untuk daftar, login (10/15 mnt), pemulihan (5/jam), post (40/jam), komentar (60/jam), laporan (20/jam).
- **Owner:** Frontend.
- **Risk:** tebakan kata sandi/kode pemulihan tak terbatas (terbukti 30 dan 20 percobaan lolos).
- **Deliverable:** harness: 10 / 5 percobaan lalu `rate_limited`.

### F7 — Batas teks tak sama dengan server (A04)
- **Action:** `postMax`/`commentMax` lokal `Infinity` → `500` (sama dengan server).
- **Owner:** Frontend.
- **Risk:** post 5.000 huruf lolos di lokal tetapi ditolak server; satu komentar besar menghabiskan kuota 5 MB. `Infinity` juga menjadi `null` saat di-JSON-kan.
- **Deliverable:** `post_length` kini ditolak di lokal.

### F8 — Cadangan hash kata sandi lemah (A02)
- **Action:** tanpa `crypto.subtle` (konteks http) kata sandi ditolak (`insecure_context`), bukan di-hash dengan FNV sederhana.
- **Owner:** Frontend.
- **Risk:** hash mudah dipecahkan tersimpan permanen. **Deliverable:** pesan galat ID/EN ditambahkan.

### F9 — Enumerasi akun lewat waktu respons (A07)
- **Action:** login lokal selalu menghitung hash (kata sandi tiruan bila akun tak ada), sama seperti server.
- **Owner:** Frontend. **Risk:** rendah. **Deliverable:** paritas dengan `apps/api`.

### F10 — `%` rusak di URL merusak layar (A05)
- **Action:** `decodeURIComponent` dibungkus aman di `localapi.js` (→ `bad_request`) dan `main.js` (`dec()`).
- **Owner:** Frontend.
- **Risk:** `#/u/%E0%A4%A` memicu `URIError` tak tertangani → layar kosong/log galat. **Deliverable:** harness `bad_request`.

### F11 — Sesi lokal tak pernah kedaluwarsa (A07)
- **Action:** sesi lokal berlaku 90 hari (sama dengan server). **Owner:** Frontend. **Risk:** rendah.

### F12 — Service worker tidak menyimpan `router.js` & `session.js`
- **Action:** ditambahkan ke `SHELL`; versi cache → `v3.0.1-local`. **Owner:** Frontend.
- **Risk:** instal offline tidak lengkap. **Deliverable:** cangkang offline utuh.

### F13 — Laporan bisa dibanjiri (A04)
- **Action:** deduplikasi (pelapor+target), batas 20/jam, plafon 500 baris. **Owner:** Frontend.
- **Risk:** 1.001 laporan terbukti tersimpan → kuota habis.

### F14 — Workflow CI tanpa batas hak token (A05/A08)
- **Action:** `permissions: contents: read` ditambahkan di `android.yml`, `ios.yml`, `deploy.yml`.
- **Owner:** DevOps.
- **Risk:** tanpa blok `permissions`, `GITHUB_TOKEN` memakai hak bawaan repo (bisa luas) → bila langkah CI disusupi, repo bisa ditulis.
- **Deliverable:** hak minimum; rahasia Cloudflare tetap hanya dipakai langkah deploy.

## 3. Temuan TERBUKA (belum diubah)

| ID | Tingkat | Action yang disarankan | Owner | Risk bila dibiarkan | Alasan belum diubah |
|---|---|---|---|---|---|
| O1 | **Tinggi** | Unggah besar langsung ke R2 (presigned/multipart) atau batasi (mis. 25 MB) | Backend + Product | `formData()` + `arrayBuffer()` menahan hingga ~2× ukuran berkas di memori Worker (±128 MB); audio 95 MB bisa membuat Worker crash → downtime | Menyentuh keputusan produk "audio tanpa batas" |
| O2 | Sedang | Kirim `token` di body hanya untuk klien native (header `x-onym-client`) | Backend + Frontend | Skrip XSS bisa membaca token dari respons login walau cookie HttpOnly | Perlu ubah klien, native, dan tes bersamaan |
| O3 | Sedang | Persingkat `mediaUrlTtlMs` (6 jam → 15–30 mnt) atau cek visibilitas saat unduh | Backend | Setelah post dijadikan privat/dihapus, tautan media lama tetap sah ≤6 jam | Tarik-ulur cache vs privasi; butuh keputusan |
| O4 | Sedang | `sync-web.mjs` ganti `https:` di CSP meta dengan origin API persis; tambahkan `data:` ke `media-src` header bila mode lokal di-deploy lewat Worker | DevOps | Aplikasi native: `connect-src https:` membuka jalur eksfiltrasi bila ada XSS. Mode lokal di balik header CSP Worker akan memblokir audio/video `data:` | Bergantung target deploy |
| O5 | **Tinggi (bila publik)** | Jangan rilis mode localStorage ke publik; pindah ke backend (atau IndexedDB untuk tes besar) | Tim | Hash kata sandi, sesi, dan media terbaca skrip mana pun di origin; sesi bisa dipalsukan dengan menyunting `hh_local_session`; kuota ±5 MB → video 16 MB tak pernah muat, audio "tanpa batas" mustahil | Sifat bawaan localStorage |
| O6 | Rendah | Cron Trigger harian: hapus `sessions` kedaluwarsa, `view_dedupe`, `rate_limits` lama | Backend | Tabel membengkak, biaya D1 naik | Perlu konfigurasi Cloudflare |
| O7 | Rendah | Cookie `__Host-` (di HTTPS), cek kata sandi bocor, 2FA opsional | Backend | Pengerasan berlapis | Peningkatan, bukan celah |
| O8 | Rendah | Pakai `readMediaItems` juga di `POST /api/posts` | Backend | Dua salinan aturan validasi bisa melenceng (akar F2) | Tak diubah agar jalur buat-post yang sudah teruji tidak disentuh |
| O9 | Info | Jalankan `npm run typecheck`, e2e Playwright, build Android/iOS, `wrangler deploy`, dan tinjau log produksi | DevOps | — | Lihat §5 |

## 4. Pemetaan OWASP Top 10

- **A01 Akses:** aturan visibilitas terpusat (`VIS_SQL`), media bertanda tangan, IDOR dicek (hapus/edit hanya pemilik) — *baik*; O3 membuka celah masa berlaku tautan.
- **A02 Kripto:** PBKDF2-SHA256 100k (batas Workers), token acak 256-bit disimpan ter-hash, perbandingan waktu-konstan — *baik*; F8 menutup cadangan lemah.
- **A03 Injeksi:** semua SQL ber-parameter, `LIKE` di-escape, DOM dibangun tanpa `innerHTML` untuk data pengguna (hanya SVG/logo statis) — *tidak ditemukan celah*.
- **A04 Desain:** F1, F3, F7, F13, O1.
- **A05 Konfigurasi:** CSP ketat tanpa inline, HSTS, nosniff, frame DENY — *baik*; F5, O4.
- **A07 Autentikasi:** F3, F4, F6, F9, F11; kode pemulihan sekali pakai ter-hash.
- **A08 Integritas:** tidak ada dependensi runtime pihak ketiga di web; hak token CI dibatasi (F14); aksi GitHub masih di tag mayor `@v4` — pin ke SHA commit (rekomendasi).
- **A09 Logging:** galat 500 dari Origin rusak dihapus (F5); belum ada pemantauan terpusat.

## 5. Verifikasi & batasan

Sudah dijalankan: seluruh `apps/api/test/api.test.ts` (31 tes, SQLite sungguhan + R2 tiruan) dan uji harness `localapi.js` (sebelum/sesudah). Tidak bisa dijalankan di lingkungan ini (tanpa jaringan/browser): `npm install`, `tsc` typecheck, e2e Playwright, wrangler, build native. Jalankan di mesin Anda: `npm test && npm run typecheck && npm run e2e`.

## 6. Rencana jangka panjang

1. Putuskan O1 dan O5 (arsitektur unggah + migrasi dari localStorage) — dua risiko terbesar.
2. Terapkan O2–O4 sebelum rilis publik.
3. Tambahkan Cron pembersihan (O6) dan pemantauan galat (Workers Logs/Logpush).
4. Pin GitHub Actions ke SHA commit dan aktifkan Dependabot.
5. Tinjau ulang keamanan tiap rilis besar; tambahkan tes regresi untuk setiap temuan baru.

## 6. Tambahan v3.8 (temuan & perbaikan)

| ID | Tingkat | Temuan | Perbaikan |
|---|---|---|---|
| F15 | Rendah | `abs()` meneruskan URL `//host/...` (tanpa skema) dan skema apa pun → bisa memuat sumber luar bila data tercemar | Hanya blob:, data:image/video/audio, https:, dan jalur relatif; selain itu `about:blank` |
| F16 | Sedang | CSP meta membolehkan `https:` untuk gambar, media, dan koneksi → jalur eksfiltrasi bila ada XSS (O4) | Wildcard dibuang; `sync-web.mjs` menambahkan HANYA asal API bila dipakai |
| F17 | Rendah | Mode lokal menerima `image/svg+xml` dan tipe `image/*` apa pun sebagai foto | Daftar putih jenis gambar |
| F18 | Rendah | `hydrate()` berjalan paralel di tiap permintaan → blob: URL ganda bocor & memori berlipat | Satu pekerjaan bersama + satu transaksi |
| F19 | Rendah | Berkas dibaca ke memori dua kali saat posting → video besar bisa membuat tab/WebView kehabisan RAM | Cukup uji keterbacaan; salinan hanya sekali (saat dipilih) |
| F20 | Info | Cangkang offline tak memuat `attach.js` | Daftar cangkang dilengkapi (semua modul) |

Tidak ditemukan celah baru di `apps/api` (SQL ber-parameter, CSRF cookie, Range, token media). O1–O9 di atas masih terbuka; O5 (mode lokal tidak aman untuk publik) tetap yang terpenting bila situs dibuka untuk umum.
