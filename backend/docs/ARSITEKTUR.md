# Arsitektur

```
Flutter (web + Android) — satu kode, tampilan sama
   │  kata sandi diolah di PERANGKAT (PBKDF2-SHA256 600.000 putaran) → hanya kunci-turunan 32 byte yang dikirim
   ▼
Cloudflare Worker  (web statis + /api/*)  ── rate-limit · CSP · JWT HS256 (15 mnt) · validasi ketat
   ├─ D1 ........ akun, sesi (token segar dirotasi, pemakaian ulang = pencabutan keluarga), batas login, config, perangkat, avatar, indeks media
   ├─ Neon ...... fungsi api_*  (peran onym_api hanya boleh EXECUTE) — semua aturan akses ada di SQL: can_view()
   ├─ Edge Fn `mongo` ── MongoDB: linimasa (fan-out), notifikasi, foto posting (GridFS)
   └─ Supabase Storage (kunci layanan hanya di Worker): video & audio — klien mengunggah LANGSUNG lewat URL bertanda tangan
```

## Alur penting
- **Daftar/Masuk**: klien minta `salt` → hitung kunci-turunan di perangkat → kirim. Server menyimpan `HMAC(pepper, kunci)` (verifier) — bukan kata sandi, bukan kunci. Nama pengguna tak ada → salt palsu deterministik (anti-enumerasi). Tanpa email: pemulihan memakai 8 kode sekali-pakai (disimpan sebagai SHA-256).
- **Sesi**: access JWT 15 menit (stateless) + refresh token 60 hari (hanya hash di D1, dirotasi tiap dipakai). Token lama dipakai lagi (>10 dtk) = dianggap dicuri → seluruh keluarga sesi dicabut.
- **Privasi posting** (10 tingkat): `can_view()` di Neon dipakai SEMUA fungsi baca; blokir memutus dua arah.
- **Media**: video/audio → Supabase (URL baca/tulis bertanda tangan 1 jam; unggah dicek ukuran + isi/magic-bytes saat `commit`); foto → MongoDB (URL HMAC 1 jam, di-cache tepi); avatar → D1 (publik). Setiap berkas tercatat di D1 (pemilik, ukuran) untuk kuota & pembersihan.
- **Beban**: beranda publik di-cache tepi 10 dtk; salinan lokal di perangkat untuk beranda & konfigurasi; penghitung lewat trigger; paginasi keyset.

## Batas penyimpanan (paket gratis) & pemutus otomatis
Foto di MongoDB M0 (512 MB): pemutus global 400 MB, 60 MB/akun. Video/audio di Supabase (1 GB): pemutus global 900 MB, 250 MB/akun. Melewati batas → unggahan baru ditolak (`storage_full`), tidak ada tagihan.
