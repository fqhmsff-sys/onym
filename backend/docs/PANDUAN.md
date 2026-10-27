# Panduan pasang (urut)

Rahasia di bawah ini dibuat sendiri (jangan dibagikan, simpan cadangan — kehilangan `AUTH_PEPPER` = semua orang tak bisa masuk):
`openssl rand -base64 48` untuk **AUTH_PEPPER**, **JWT_SECRET**, **INTERNAL_SECRET**, **IP_HASH_SALT** (masing-masing nilai BERBEDA).

## 1. Neon (Postgres)
1. SQL Editor → jalankan `neon/0001_onym.sql` (sekali).
2. Buat peran aplikasi lalu beri hak: `create role onym_api login password '<acak-panjang>';` lalu jalankan lagi blok `do $$ … $$` di akhir berkas (memberi EXECUTE fungsi `api_*` saja).
3. (Opsional) jalankan `neon/test_behavior.sql` — harus berakhir dengan pesan `TEST_OK`.
4. Connection string peran `onym_api` (pooled, `sslmode=require`) → rahasia Worker `NEON_DATABASE_URL`.

## 2. Cloudflare D1
`npx wrangler d1 create onym-edge` → salin `database_id` ke `backend/worker/wrangler.jsonc`. Skema dipasang otomatis oleh CI (`d1/0001_edge.sql`).

## 3. MongoDB Atlas
Cluster M0. Pengguna DB `onym_app` (readWrite pada `onym`), TLS. Network Access 0.0.0.0/0 (Edge Function tidak punya IP tetap; pengguna DB berhak minimum + sandi panjang).

## 4. Supabase (hanya Storage + 1 Edge Function)
1. SQL Editor → `supabase/storage.sql` (membuat bucket privat `media`).
2. `supabase secrets set MONGODB_URI='mongodb+srv://…' MONGODB_DB=onym INTERNAL_SECRET='<sama dengan Worker>'`
3. `supabase functions deploy mongo --no-verify-jwt`
4. Kunci layanan (Project Settings → API → `service_role`) → rahasia Worker `SUPABASE_SERVICE_KEY`. **Hanya di Worker, jangan di aplikasi.**

## 5. GitHub → deploy otomatis
Unggah seluruh folder ke repo. Settings → Secrets → Actions:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_DATABASE_URL`, `AUTH_PEPPER`, `JWT_SECRET`, `INTERNAL_SECRET`, `SUPABASE_SERVICE_KEY`, `IP_HASH_SALT`.
Push ke `main` → hasilnya: **web** (alamat Worker, di catatan rilis) dan **APK** (GitHub → Releases → unduh `app-release.apk`).

## 6. Uji
`curl https://<alamat>/api/health` · daftar akun di web → simpan kode pemulihan → tulis posting. Uji lokal Worker: `bash backend/worker/test/run.sh` (Node 22+).
