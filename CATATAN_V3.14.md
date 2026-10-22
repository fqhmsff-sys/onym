# Onym v3.14 — logo final, layar muat beranimasi, tombol kembali tunggal

## Logo
- Logo final (kepala hitam + mata biru yang mengintip) dipasang di mana-mana: bilah atas, layar muat, halaman masuk/daftar/pulihkan, Tentang, favicon, ikon PWA (192/512/maskable/monochrome), apple-touch-icon, dan aset native (`mobile/resources`: icon, icon-foreground, splash, splash-dark).
- Tulisan "onym" digambar sebagai garis SVG bulat (bukan font) → tajam di ukuran apa pun, mengikuti warna tema, dan bisa dianimasikan. Kode: `web/js/brand.js`. Berkas vektor: `brand/` (logo-mark, logo, logo-monochrome, logo-maskable).
- Kepala/tulisan memakai `currentColor`: hitam di tema terang, putih di tema gelap; iris tetap biru.

## Layar muat (animasi)
Kepala muncul memantul → mata terbuka (iris membesar) → iris melirik ke kiri lalu kembali (berulang) → tulisan "onym" tergambar huruf demi huruf → garis muat tipis. Total ±2,1 dtk (0,5 dtk bila "gerak dikurangi" / animasi dimatikan; keadaan akhir langsung tampil).
Iris juga melirik pelan di halaman masuk/daftar dan Tentang, dan saat logo di bilah atas ditekan.

## Tombol kembali
- Sebelumnya sub-halaman Pengaturan punya DUA panah kembali (bilah atas + di dalam halaman). Kini hanya satu: panah di bilah atas. Judul besar tidak lagi diulang di bilah atas.
- Bila tak ada riwayat (tautan langsung / muat ulang), kembali menuju halaman induk (`/settings/x` → `/settings`, `/settings` → profil), bukan selalu ke Beranda.
- Ketukan beruntun <450 ms diabaikan (tidak mundur dua halaman).
- Tombol "Kembali" di layar kosong/galat (profil/post tidak ditemukan) kini berlabel "Beranda" agar tidak tampak ganda dengan panah kembali.
- Panah galeri/carousel/pemindah urutan media kini berlabel aksesibilitas "Sebelumnya" (bukan "Kembali").

## Lain-lain
- Service worker: VERSION `onym-v3.14`, `js/brand.js` masuk daftar cache.
- BELUM: apps/api (Worker + D1) tetap belum mengikuti kolom & rute v3.12–v3.13 (anon, interaksi, dsb).
