# Onym v3.9 — ganti nama + tampilan baru

- Nama HULHUP → **Onym** (teks, judul, manifest, i18n, ikon, logo, paket, appId `id.onym.app`, `ONYM_CONFIG`).
- Tidak diubah (agar deploy & data yang ada tidak putus): nama Worker/D1/R2 di `apps/api/wrangler.jsonc`, domain `hulhup.my.id`, nama IndexedDB `hulhup_media`, kunci localStorage `hh_*`.
- Logo baru: kotak hitam, dua cincin putih saling bertaut (SVG + PNG ikon/splash dibuat ulang).
- Tampilan: putih bersih, aksen biru; header logo + "Onym"; kotak posting dengan 3 tombol bergaris; tab Beranda/Mengikuti bergaris bawah biru; kartu post dengan suka/komentar/bagikan + simpan; navigasi bawah pil putih dengan titik biru; menu Profil memakai foto profil pengguna.
- `VERSION` service worker dinaikkan ke onym-v3.9.0.
- v3.9.1: aksen hitam; biru hanya titik kecil (menu aktif & notifikasi); cincin biru di tombol + dan foto profil dihapus.

## v3.10
- Biru kembali jadi identitas tapi tenang: tab/menu aktif, tautan, fokus, titik notifikasi. Tombol & teks tetap hitam.
- Tata letak dirapikan (tanpa bayangan berat, kotak posting tanpa tombol berbingkai, navigasi lebih ramping). Semua fitur tetap ada.
- BARU: hubungan pengguna lain bisa dilihat siapa saja — ketuk angka "Hubungan" di profil mana pun → `#/u/<nama>/relations` (hanya hubungan yang sudah disetujui). API: `GET /api/users/:username/relations` (mode lokal + apps/api).

## v3.11
- Warna ala X/Facebook: putih dominan, hitam untuk teks & tombol utama (Ikuti, navigasi aktif), biru sedang untuk tombol + / Posting, garis bawah tab, tautan, ikon foto, backsound aktif, titik notifikasi.
- Backsound: SATU backsound per post (memilih yang lain mematikan yang sebelumnya) dan satu pemutar global. Terus berputar (berulang) untuk post teks/foto/video, tidak dijeda suara/video lain, berganti hanya saat post lain ber-backsound terlihat. Tombol "Backsound" = nyala/mati (diingat di perangkat, berlaku untuk semua post). Berhenti saat tab disembunyikan atau post pemilik dilepas.
