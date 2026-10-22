# Onym v3.8 — Lancar tanpa delay, video bisa digeser, hardening

## Kecepatan (video & media)
- **Video dimuat malas (lazy)**: hanya video yang dekat layar (±1,5 layar) yang dipasang sumbernya; yang jauh (>4 layar) dilepas lagi dan posisi putarnya diingat. Dulu semua video di Beranda memuat serentak saat dibuka → patah-patah di HP RAM kecil. Uji: dari 8 video, 4 yang dimuat saat dibuka (dulu 8).
- **Geser galeri tanpa jeda**: video di slide sebelah slide aktif dipasang lebih dulu (warm), jadi geser ke video berikutnya langsung tampil; 3 foto pertama di galeri dimuat eager.
- **Pelihat foto**: foto kiri/kanan dipramuat → geser ke foto lain langsung tampil.
- **Blur dihapus dari semua lapisan di atas video** (tombol, penghitung, durasi, bilah atas/bawah, tirai): `backdrop-filter` di atas video yang berputar memaksa GPU menghitung ulang blur tiap bingkai, penyebab utama lag di HP kelas menengah/bawah. Latar kini solid semi-transparan (tampilan hampir sama).
- **Muat IndexedDB satu transaksi** (dulu satu transaksi per berkas); permintaan paralel menunggu satu pekerjaan yang sama (dulu tiap permintaan memuat ulang dan membocorkan blob: URL ganda).
- **Tak lagi menyalin isi berkas dua kali** saat posting (RAM video besar tidak berlipat).
- **Service worker**: JS/CSS/ikon dibuka dari cache lebih dulu (stale-while-revalidate) → aplikasi terbuka instan; halaman & config tetap jaringan-dulu. Daftar cangkang dilengkapi (attach.js sebelumnya tak ikut → offline tak utuh). Permintaan Range (video/audio) tak pernah disentuh SW. `modulepreload` untuk 21 modul JS → tak lagi berantai satu per satu.
- Progres video digambar per bingkai (rAF) → bilah mulus; `contain` pada galeri/pemutar agar menggulir tak memicu hitung ulang seluruh halaman.

## Geser (seek)
- **Video**: bilah geser di dasar video. Seret atau ketuk untuk lompat ke bagian mana pun; knob muncul saat disentuh; area sentuh 34px di layar sentuh; pratinjau bingkai saat menggeser; keyboard (← → ±2 dtk, Home/End, Spasi). Menggeser bilah tidak menggeser galeri dan tidak memutar/menjeda video. Ikon suara dinaikkan agar tak menimpa bilah.
- Audio (gelombang) dan pratinjau layar penuh (kontrol bawaan) sudah bisa digeser sejak sebelumnya; foto: geser kiri/kanan, cubit, ketuk 2x.

## Keamanan (lihat docs/AUDIT-KEAMANAN.md §6)
- `abs()` menolak `//host` dan skema selain blob:/data:/https:/jalur relatif.
- CSP meta: wildcard `https:` dibuang dari `img-src`/`media-src`/`connect-src`; `sync-web.mjs` hanya menambahkan asal API yang dipakai.
- Mode lokal menolak SVG & format gambar aktif lain (daftar putih jpeg/png/webp/gif/avif/bmp/heic/heif).

## Uji
Chromium sungguhan (Playwright): daftar → posting 9 post video/foto/suara → muat ulang (media kembali dari IndexedDB) → putar otomatis → seret bilah ke 70%/80% (tepat) → ketuk bilah → galeri video/foto geser → viewer foto → SW aktif. Tanpa galat konsol.
Belum diuji: perangkat Android/iOS sungguhan, `npm test` (tidak ada jaringan untuk `npm install`), `apps/api` (tidak diubah).
NAIKKAN `VERSION` di web/sw.js tiap rilis baru.
