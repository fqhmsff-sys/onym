# Onym — Blueprint v3

Produk: platform sosial universal. Satu post = teks dan/atau audio, foto (≤4), video (≤10 dtk).

## Aturan penting
- **Video** maks. 10 dtk — ditegakkan di klien (rekam otomatis berhenti) **dan** di server (durasi dibaca dari MP4/WebM).
- **Audio**: tanpa batas durasi/ukuran dari aplikasi (hanya plafon platform ±100 MB per permintaan).
- **Foto**: dikecilkan klien ke 1600 px; server memvalidasi magic bytes & dimensi.
- **Privasi post**: `public` (semua) · `followers` (pemilik + pengikut) · `relationship` (pemilik + hubungan TERSETUJUI).
- **Hubungan**: teman/sahabat/pacar/keluarga; permintaan → persetujuan pihak yang diminta; satu baris per pasangan (`pair_key`).
- **Acak**: hanya post `has_media=1` & `in_random=1` yang terlihat oleh penonton; undian seragam (crypto).
- **Visibilitas** didefinisikan sekali (`VIS_SQL` di `apps/api/src/lib/queries.ts`) dan dipakai Feed, Acak, profil, pencarian, komentar, rating, simpan.
- **Media** disajikan lewat URL bertanda tangan (HMAC, 6 jam) dengan dukungan Range.

## Sistem desain
Gading `#F3F0E8` · Arang `#242B2A` · Sage `#87958D` · Champagne `#B6A58A`. Font sistem. Animasi: layar muat (cincin menggambar diri),
transisi halaman berarah, tab pill meluncur, bintang (pop + percikan + gelombang), simpan, posting (kemajuan → centang), cari, Acak (cincin berdenyut + balik kartu),
lembar geser, skeleton, toast. Menghormati `prefers-reduced-motion`.
