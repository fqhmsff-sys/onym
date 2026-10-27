# Biaya & keamanan

## Tanpa biaya mendadak (paket gratis)
Workers (batas harian, berhenti sendiri) · D1 · Supabase Free (spend cap) · MongoDB M0 (tidak naik otomatis) · Neon Free. Tanpa R2. Batas Workers gratis: **100.000 permintaan/hari** untuk SELURUH lalu lintas (≈ ribuan pengguna aktif); melewati itu layanan berhenti sampai besok — naik ke Workers Paid ($5/bln) bila perlu, keputusanmu.

## Kontrol keamanan
- Kata sandi tak pernah dikirim; server hanya menyimpan HMAC berpepper dari kunci-turunan; login dikunci (8 gagal/15 mnt/akun, 40/IP); sesi dirotasi + deteksi pencurian; pemulihan lewat kode sekali pakai.
- JWT HS256 (alg lain ditolak), 15 menit; semua ID divalidasi; tidak ada SQL dinamis (nama fungsi dari daftar putih, tipe tetap); peran DB hanya EXECUTE.
- Privasi dipaksa di database (`can_view`) — bukan di aplikasi. Blokir dua arah.
- Media: bucket privat, URL bertanda tangan 1 jam, kuota, cek magic-bytes, nama acak, kunci layanan hanya di Worker.
- Batas laju 3 lapis: Workers, D1 (login/daftar/pemulihan), trigger Postgres.
- CSP ketat, `nosniff`, tanpa CORS, tanpa cookie (kebal CSRF); IP di audit hanya HMAC.

## Belum terbukti (jujur — baca)
- **Kode Flutter belum pernah dikompilasi.** Skema Neon SUDAH dipasang dan lolos di Postgres 17 sungguhan, tetapi **uji perilakunya belum dijalankan** (`neon/test_behavior.sql`). Worker lulus 85+ uji lokal (D1 = SQLite sungguhan). Edge Function `mongo` dan endpoint Supabase Storage (tanda tangan/Range/hapus) **belum dijalankan** terhadap layanan asli.
- Tanpa email: lupa kata sandi + kode pemulihan hilang = akun tak bisa dipulihkan.
- Token segar di web disimpan di penyimpanan browser (terenkripsi oleh flutter_secure_storage, bukan kebal XSS — CSP ketat jadi penjaganya).
- Atlas harus terbuka dari semua IP (batasan Edge Function). Tidak ada sistem "tanpa celah": lakukan uji penetrasi sebelum rilis publik besar.
