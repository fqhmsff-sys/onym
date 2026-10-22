# Deploy Onym

## 1. Backend + Web (Cloudflare) — satu kali setup
```bash
npm install
cd apps/api
npx wrangler login
npx wrangler d1 create onym              # salin database_id ke apps/api/wrangler.jsonc
npx wrangler r2 bucket create onym-media
openssl rand -hex 32 | npx wrangler secret put MEDIA_SECRET   # WAJIB: penanda tangan URL media
npx wrangler d1 migrations apply onym --remote
npx wrangler deploy
```
Hasilnya `https://onym.<akun>.workers.dev` — web (PWA) dan API sekaligus. Domain sendiri: Dashboard → Workers → onym → Domains.
Tanpa `MEDIA_SECRET`, server menolak menyajikan media (sengaja, agar tidak jalan tanpa kunci).

Catatan batas platform: satu permintaan unggah maksimal ±100 MB (batas Cloudflare); audio tidak dibatasi aplikasi, hanya platform.

## 2. PWA (web)
Buka alamat di atas di Chrome/Safari → *Tambahkan ke layar utama*. Tidak ada langkah lain.

## 3. Android (APK)
Cara termudah tanpa Android Studio — GitHub Actions:
1. Unggah proyek ke repo GitHub.
2. Actions → **Bangun APK Android** → Run workflow → isi alamat server HTTPS dari langkah 1.
3. Unduh artifact `onym-debug-apk` → pasang di HP.

Atau lokal (Node + JDK 21 + Android SDK):
```bash
cd mobile && npm install
ONYM_API_URL=https://onym.<akun>.workers.dev npm run sync-web
npm run add:android && npx cap sync android
cd android && ./gradlew assembleDebug      # APK: app/build/outputs/apk/debug/
```
Untuk Google Play: buat keystore & bangun `bundleRelease`.

## 4. iOS
Butuh macOS + Xcode + akun Apple Developer untuk menandatangani.
```bash
cd mobile && npm install
ONYM_API_URL=https://onym.<akun>.workers.dev npm run sync-web
npm run add:ios && npx cap sync ios && npx cap open ios
```
Workflow `ios.yml` hanya membangun versi simulator tanpa tanda tangan.

## 5. Verifikasi
`npm test` (API) dan `npm run e2e` (UI sungguhan; butuh `npm i -D playwright && npx playwright install chromium`).
