# Onym v3.3

## Bug Beranda kosong
Penyebab: tiap sesi disegarkan (45 dtk / saat kembali ke aplikasi) `onMe` memanggil `cleanup()` pada halaman Beranda yang disimpan → daftar post dikosongkan.
Perbaikan: cache halaman hanya dibuang bila akun benar-benar berganti. Post dari halaman lain kini langsung menyegarkan Beranda.

## Acak
- Dipilih PER MEDIA (ikon acak di tiap foto/video/suara saat menulis & mengedit post), bukan 1 post utuh.
- Tombol Acak memunculkan SATU media saja, dipilih acak sungguhan (peluang sama rata, tidak langsung mengulang yang sama).

## Feed
- Foto + video dalam 1 post digeser seperti Instagram (penghitung 1/N, titik, panah di desktop). Maks 10 foto/video per post, urutan bisa diatur (panah di komposer).
- Foto/video tampil sesuai aslinya (landscape/portrait, tidak dipotong, warna tidak diubah). Foto kecil diunggah apa adanya (tidak digambar ulang).
- Video & suara diputar otomatis saat ≥60% terlihat, dijeda saat keluar layar. Video berulang. Bila peramban menolak suara, video jatuh ke tanpa suara. Matikan: localStorage hh_autoplay = "0".
- Zoom: ketuk foto → pelihat layar penuh (cubit, ketuk 2x, roda tetikus, tombol + / −, geser saat diperbesar, geser ke samping untuk foto lain).

## Foto profil
- Editor: atur posisi (geser), zoom (cubit/penggeser), pratinjau langsung; tombol "Atur posisi" memakai foto asli yang disimpan.
- Ketuk foto profil (profil/pengaturan) → lihat besar + zoom.
- PP hitam jadi putih: penyebabnya latar putih saat foto digambar ulang. Kini transparansi/warna dipertahankan (PNG).

## Belum
- `apps/api` (backend D1) belum disesuaikan; mode lokal (localapi.js) sudah. Uji e2e lama (e2e/alur-*.mjs) belum dijalankan ulang; uji baru: e2e/v33.mjs.
