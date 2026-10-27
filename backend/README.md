# Onym — Backend (Misyi)

Pembagian tugas yang jelas — setiap layanan mengerjakan yang paling cocok untuknya:

| Layanan | Menyimpan / mengerjakan |
|---|---|
| **Cloudflare D1** | **identitas & sesi**: akun, verifier kata sandi, kode pemulihan, token segar, batas percobaan login · konfigurasi aplikasi · token perangkat · foto profil · indeks & kuota media |
| **Neon (Postgres)** | **isi sosial**: profil publik, posting, komentar, bintang/rating/simpan, ikuti, hubungan, blokir, pencarian, laporan, audit |
| **MongoDB Atlas** | **linimasa "Untuk kamu"**, **notifikasi**, dan **foto posting** (GridFS) |
| **Supabase Storage** | **hanya video & audio** (berkas terbesar) — bucket privat, URL bertanda tangan |
| **Cloudflare Workers** | menayangkan **web** (Flutter web) + **API** `/api/*` — satu-satunya pintu; tanpa R2 |

Supabase Edge Function `mongo` hanyalah gateway komputasi ke MongoDB (Worker tidak bisa memanggil Mongo langsung); tidak menyimpan data.

Folder: `d1/` · `neon/` · `supabase/` · `worker/` · `docs/`.
