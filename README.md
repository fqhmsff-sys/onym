# Onym

Platform sosial untuk berbagi **teks, suara, foto, dan video singkat (maks. 10 detik)** — boleh dicampur dalam satu post.
Satu kode untuk tiga tempat: **web (PWA)**, **Android**, dan **iOS**. UI, animasi, logo, dan fitur sama persis, karena aplikasi
Android/iOS memuat folder `web/` yang sama.

## Fitur
- **Feed**: post teks (seperti X/Threads), audio, foto (hingga 4), video ≤ 10 dtk, atau campuran. Tab *Terbaru* dan *Mengikuti*.
- **Tulis & rekam langsung** di app/web: kamera foto, rekam video (otomatis berhenti di 10 dtk), rekam suara (maks. 3 menit), atau pilih dari berkas.
- **Pengikut & mengikuti** (satu arah, langsung aktif).
- **Hubungan** (teman, sahabat, pacar, keluarga) — **hanya terjalin bila kedua pihak setuju**; bisa dibatalkan/diputus kapan saja.
- **Privasi per post**: Publik · Hubungan · Pengikut (default bisa diatur di Pengaturan).
- **Acak**: memunculkan audio/foto/video acak (teks tidak ikut), hanya yang boleh dilihat penonton.
- **Rating bintang**, komentar & balasan, simpan, notifikasi, pencarian, laporan, mode fokus, tema terang/gelap, Indonesia/English.
- **Tanggal lahir** dengan pemilih buatan sendiri (tanggal · bulan · tahun), bukan input bawaan peramban.
- Akun tanpa email: kode pemulihan sekali pakai; hapus akun dari dalam aplikasi.

## Struktur
```
web/        PWA (HTML/CSS/JS murni, tanpa build). Satu-satunya sumber UI untuk web, Android, dan iOS.
apps/api/   Backend Cloudflare Worker + D1 + R2 (juga menyajikan web/). Tes: 27 tes API.
packages/shared/  Batas & validasi yang dipakai server.
mobile/     Pembungkus Capacitor → APK/IPA dari web/ yang sama.
e2e/        Tes alur UI sungguhan (Playwright).
brand/      Logo final: kepala hitam dengan satu mata biru yang mengintip + tulisan "onym" (SVG, tanpa font eksternal).
docs/       BLUEPRINT.md, DEPLOY.md
```

## Jalankan lokal
```bash
npm install
npm test                 # 27 tes API (parser media, privasi, hubungan, Acak, keamanan)
npm run serve:test       # server uji + web di http://localhost:8787 (data di memori)
npm run dev              # Wrangler lokal (D1/R2 lokal)
```
Cara deploy ke internet dan membuat APK/iOS: lihat **docs/DEPLOY.md**.

## Keamanan (ringkas)
CSP ketat (tanpa skrip/gaya inline) · semua teks pengguna lewat `textContent` · jenis media dari *magic bytes* (bukan ekstensi) · durasi video
diperiksa di server dari struktur kontainer (MP4/WebM, termasuk hasil rekam langsung) · URL media bertanda tangan & berumur pendek,
mendukung Range · aturan visibilitas satu pintu untuk semua endpoint · kata sandi PBKDF2, token sesi di-hash · batas laju · CORS hanya
untuk asal aplikasi · HSTS, nosniff, frame-ancestors none · Android: backup mati, cleartext dilarang.
