# Onym v3.4
- Beranda kosong setelah pindah halaman: elemen Beranda yang disimpan masih berkelas `page-out` (transparan). Kini kelas dibersihkan saat dipakai ulang (main.js).
- Acak: kartu hanya berisi SATU media (tanpa teks/media lain post); foto diketuk → pelihat layar penuh.
- "Berkas gagal disimpan di perangkat" saat posting video: penyimpanan IndexedDB kini mencoba Blob → ArrayBuffer → memori sesi, tidak langsung gagal. Hanya "penyimpanan penuh" yang benar-benar menolak.
- Uji: e2e/v34.mjs

## v3.5
- Foto/video/audio dari galeri: isi berkas disalin ke memori saat dipilih (File dari Android/WebView bisa tak terbaca lagi → "Tidak dapat memutar" & foto kosong).
- Audio per post: maks. 10 (dulu 1).
- Hitungan lihat: kunci "akun:post" di klien (dulu per post saja → akun lain di perangkat sama tidak terhitung). Server tetap 1 akun = 1 kali.

## v3.6
- Komentar bisa diedit (menu ⋯ → Edit komentar, hanya pemilik; teks saja; penanda "diedit"). Uji: e2e/v36.mjs

## v3.7
- Pratinjau video/foto: di penulis post (dan kolom komentar) thumbnail bisa diketuk → pemutar layar penuh dengan kontrol (putar/jeda/geser) sebelum diposting.
- Ikon suara (mute) video dipindah ke kanan-bawah; penghitung "1/n" tetap kanan-atas → tidak lagi menumpuk.
- Komentar: bisa lampirkan banyak foto, video (maks. 10 dtk), suara — aturan sama seperti post (web/js/attach.js).
- Edit komentar: teks + SEMUA media (hapus/tambah foto, video, suara). Komentar lama (1 foto/1 suara) otomatis kompatibel.
- Laporan (/api/reports) hanya TERSIMPAN di tabel `reports` (mode lokal: localStorage `hh_local_db`.reports); belum ada layar/jalur moderator yang membacanya.

## v3.7 (lanjutan)
- Backsound: tiap suara di penulis post punya ikon musik. Menyala = suara itu jadi backsound (diputar otomatis pelan & berulang saat post terlihat, chip "Backsound" bisa dimatikan/dinyalakan). Suara yang tidak dijadikan backsound tetap pemutar biasa.
- Backsound dijeda bila ada suara/video biasa sedang diputar, lanjut lagi setelah selesai. Satu backsound sekali waktu. Di kartu ringkas/Acak, suara backsound tampil sebagai pemutar biasa.
- Rating bintang diganti suka (love) seperti komentar: /api/posts/:id/like (PUT/DELETE), notifikasi "menyukai postmu". Data bintang lama tidak ditampilkan lagi.
- Ukuran media: foto/video memakai rasio ASLI persis (tanpa batas 0.5–1.78) dan tidak dipotong. Terlalu tinggi → kotak dikecilkan (tinggi maks. 72% layar; komentar 360px) dan tetap pas dengan media, tanpa bilah hitam. Thumbnail di penulis tidak lagi dipotong. Foto komentar tidak lagi dikecilkan ke 1280px.
