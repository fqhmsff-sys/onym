# Onym v3.12

- Backsound: menyala terus selama post ber-backsound ada di layar (tidak dijeda suara/video lain). Begitu post itu keluar dari layar → otomatis mati. Post lain tanpa backsound tidak mengubah apa pun.
- Warna: hitam dominan. Biru hanya pemanis kecil: tombol Ikuti, titik notifikasi, titik kecil di menu aktif. Tombol +, Posting, tab, tautan, backsound → hitam/netral.
- Posting anonim: saklar "Posting anonim" di kotak buat/edit post. Post anonim hanya menampilkan isi (teks/foto/video/suara), tanpa nama & foto profil (API tidak mengirim identitas penulis).
- Profil: tab baru "Anonym" berisi post anonim milik pengguna. Pemilik memilih siapa yang bisa melihat tab itu: semua orang, pengikut, semua hubungan, teman, sahabat, pacar, keluarga, atau hanya saya (bawaan: hanya saya). Post anonim tidak masuk tab Post/Media dan tidak dihitung di jumlah post.
- Acak: media dari post anonim tampil tanpa profil/kartu post; foto langsung popup (layar penuh).
- API baru (mode lokal): GET /api/users/:username/anon; PATCH /api/me { anonVisibility }; form post/edit field `anon`.
- BELUM: apps/api (Cloudflare Worker + D1) belum mengikuti — perlu migrasi kolom posts.anon & users.anon_visibility, dan rute yang sama.

## v3.12.1
- Biru: garis bawah tab, ikon simpan aktif, dan backsound aktif kembali biru.
- Ikon bagikan di komentar disamakan dengan ikon bagikan di feed.
- Label "Post anonim — hanya kamu…" diganti "Milikmu" (penanda yang hanya terlihat oleh pemilik; tekan lama/arahkan untuk penjelasan).
- Satu media berbunyi: backsound kini ikut aturan yang sama dengan video/audio — saat video/audio diputar backsound berhenti, dan menyalakan backsound menghentikan video/audio. Backsound lanjut lagi setelah video/audio berhenti.
- Perbaikan tombol Backsound: bila putar otomatis diblokir peramban, ketukan pertama kini MEMUTAR (dulu malah mematikan).

## v3.12.2
- Edit post: pilihan anonim tidak muncul dan tidak bisa diubah (anonim hanya saat membuat post).
- Privasi post kini sama seperti pilihan Anonym: Publik, Pengikut, Semua hubungan, Teman, Sahabat, Pacar, Keluarga, Hanya saya (berlaku juga untuk privasi bawaan di Pengaturan).
- Backsound: terikat ke post-nya saja. Menyala terus selama post itu terlihat, TIDAK terpengaruh video/audio (di post itu maupun post lain). Pindah ke post lain → mati; bila post ber-backsound lain masih terlihat, ia yang menggantikan. (Aturan "video/audio menghentikan backsound" dari v3.12.1 dicabut.)
- Audio/backsound lebih dari 3 menit tidak lagi ditolak: muncul pemotong (geser untuk memilih 3 menit), hasil disimpan sebagai WAV. Berlaku di post dan komentar.
- BELUM: apps/api (CHECK visibilitas di migrasi D1) belum mengikuti pilihan privasi baru.

## v3.12.3
- Pilihan privasi (post & bagian Anonym) ditambah: "Yang saya ikuti" (orang yang kamu ikuti) dan "Saling ikuti", di samping Pengikut dan pilihan hubungan.

## v3.13 — Pengaturan baru
- Halaman Pengaturan dirapikan: dikelompokkan (Akun · Privasi & interaksi · Tampilan & fitur · Lainnya), ikon netral, jarak lebih lega.
- BARU Interaksi: siapa yang bisa berkomentar di postmu; siapa yang bisa mengirim permintaan hubungan; sembunyikan jumlah suka; sembunyikan jumlah dilihat (diterapkan di mode lokal; komentar/hubungan ditolak dengan pesan jelas bila dibatasi).
- BARU Fitur: putar otomatis video & audio, backsound nyala/mati, posting anonim sebagai bawaan, Acak sebagai bawaan.
- BARU Tampilan: tema + saklar animasi (matikan untuk tampilan tenang/hemat baterai).
- BELUM: apps/api (Worker + D1) belum mengikuti kolom & rute baru.

## v3.13.1 — Pengaturan premium
- Semua halaman pengaturan didesain ulang: tombol kembali + judul, kartu abu lembut tanpa garis tebal, baris dengan garis tipis, ikon netral, saklar ala iOS (hitam saat aktif).
- Pilihan privasi/interaksi kini satu daftar rapi dengan tanda centang (bukan kartu bergaris satu-satu); berlaku juga di lembar "Siapa yang bisa lihat" saat membuat post.
- Akun: foto di tengah, formulir & kata sandi dalam kartu terpisah. Tema: pratinjau bersih terang/gelap. Zona bahaya: kartu merah lembut.
