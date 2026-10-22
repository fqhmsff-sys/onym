# Onym v3.1 — perbaikan unggah media + komentar gaya Threads

## Penyebab utama "upload tidak bisa"
Versi lokal menyimpan SETIAP foto/video/suara sebagai teks base64 di localStorage (kuota ±5 MB, dan base64 membengkak 33%).
Akibatnya suara ±4 menit, video dari kamera HP, atau beberapa foto saja sudah memunculkan "Berkas terlalu besar".
Dibuktikan di Chromium: audio 4 menit (5,7 MB) gagal sebelum perbaikan, berhasil sesudahnya.

## Yang diperbaiki
- Media kini disimpan sebagai Blob asli di **IndexedDB** (ratusan MB), bukan localStorage. Data lama (data URL di localStorage) **dimigrasi otomatis** saat dibuka.
- Foto profil dan foto komentar juga di IndexedDB. Aplikasi meminta penyimpanan permanen (`navigator.storage.persist`).
- **Batas**: video maks 10 detik (unggah + kamera, kamera berhenti otomatis); audio maks 3 menit (unggah + rekam langsung, timer "0:42 / 3:00").
- Pemilih berkas video/audio kini input tetap di DOM dan dipicu langsung dari ketukan (dulu input ikut hilang bersama lembar pilihan → di sebagian WebView/Android hasil pilihan tak pernah sampai). Pilihan menampilkan batasnya.
- Kamera sistem (cadangan) kini input-nya menempel di DOM sampai hasil datang.
- Video yang tak terbaca peramban (codec) langsung diberi pesan jelas; pesan "penyimpanan penuh" yang jelas bila perangkat penuh.
- Bug: membatalkan/menghapus lampiran saat **edit post** mencabut blob: URL milik media lama sehingga media post itu rusak di feed. Diperbaiki.
- Bug: balasan komentar bisa terpisah dari induknya antar halaman. Kini satu halaman = komentar utama + semua balasannya.
- Bug: hitungan komentar salah setelah menghapus komentar saat belum semua dimuat. Diperbaiki.
- Bug: hapus post/akun tidak membersihkan foto komentar dan suka komentar. Diperbaiki.
- Build Android: `sync-web.mjs` dan workflow tidak lagi mewajibkan alamat server (mode lokal tidak memakainya).

## Komentar gaya Threads (tampilan halaman tetap)
Suka (hati + hitungan), Balas (bersarang, garis utas, "Membalas @nama" saat membalas balasan), lencana Penulis,
komentar bisa berisi **foto** (tombol gambar di kolom komentar; boleh hanya foto), bagikan, menu ⋯ (salin teks, laporkan, hapus),
"Lihat N balasan" / "Sembunyikan balasan".

## Diuji (Chromium, perangkat media palsu)
Unggah foto+video 9 dtk+audio 4 menit dalam 1 post; video 12 dtk dan audio 6 menit ditolak; rekam suara; kamera foto; kamera video (berhenti di 10 dtk);
media bertahan setelah reload; 8 post × audio 4 menit (±46 MB); migrasi data lama; edit/batal edit; hapus membersihkan IndexedDB;
komentar (utama, foto, hanya-foto, balas, balas-balasan, suka, hapus, reload); daftar/masuk/keluar, avatar, Acak, ikuti, hubungan, notifikasi, cari, tema, bahasa, hapus akun.

## Belum bisa dipastikan
Kamera/mikrofon/pemilih berkas di HP sungguhan hanya bisa diuji di perangkat. Data lokal tetap hanya ada di satu perangkat/peramban (tidak tersinkron).

## Pembaruan 2 (permintaan lanjutan)
- **Balasan bersarang sungguhan**: balasan ke balasan tampil di bawah balasan yang dibalas (dulu semuanya diratakan ke komentar utama). Tingkat 0 menampilkan 1 balasan pratinjau; sisanya lewat "Lihat N balasan". Balasan baru otomatis membuka seluruh rantai induknya. Menghapus komentar menghapus seluruh cabang di bawahnya.
- **Hitungan dilihat (ikon mata)**: 1 akun = 1 kali dilihat per post, selamanya (dulu bisa naik lagi tiap 30 menit, dan semua tamu dianggap 1 orang). Pemilik post juga dihitung 1 kali. Tamu dihitung per perangkat. Angka di kartu langsung diperbarui.
- **Komentar bisa suara**: tombol "+" di kolom komentar → Foto / Rekam suara / Unggah audio (maks 3 menit). Boleh teks + foto + suara sekaligus.
- **Notifikasi suka komentar** ("menyukai komentarmu"); hilang lagi bila suka dibatalkan; mengikuti pengaturan notifikasi komentar.
- **Pemotong video**: video > 10 detik tidak lagi ditolak; muncul pemotong (geser untuk memilih bagian 10 detik, lalu "Potong & pakai"). Pemotongan berjalan real-time (10 detik) lewat captureStream + MediaRecorder; peramban tanpa fitur itu tetap menolak dengan pesan jelas.
- **Batas audio diubah menjadi 3 menit** (post dan komentar).
- Foto di komposer post kini satu per ketukan (tanpa pilih-banyak) agar sama dengan jalur komentar yang terbukti jalan di HP.
