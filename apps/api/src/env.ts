export interface Env {
  DB: D1Database;
  /** Bucket R2 untuk semua media (audio, foto, video) dan avatar. */
  MEDIA_BUCKET: R2Bucket;
  /** Binding Workers Assets (web/PWA). Tidak ada saat tes. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Rahasia penandatangan URL media + garam hash penonton anonim. Wajib: `wrangler secret put MEDIA_SECRET`. */
  MEDIA_SECRET?: string;
}
