/** Batas dan aturan bisnis Onym — dipakai server (dan dikirim ke klien lewat /api/config) agar selalu sama. */
export const LIMITS = {
  /** Video: maksimal 10 detik. Toleransi kecil untuk pembulatan encoder/MediaRecorder. */
  maxVideoMs: 10_000,
  videoToleranceMs: 350,
  maxVideoBytes: 16 * 1024 * 1024,
  /**
   * Audio: TANPA batas durasi dan TANPA batas ukuran dari aplikasi.
   * Satu-satunya batas adalah plafon teknis platform (badan permintaan Cloudflare Workers ±100 MB).
   */
  maxRequestBytes: 95 * 1024 * 1024,
  /** Foto (klien mengecilkan ke 1600 px sebelum unggah; server tetap membatasi). */
  maxPhotoBytes: 6 * 1024 * 1024,
  maxPhotoPixels: 40_000_000,
  maxPhotos: 4,
  maxAvatarBytes: 307_200,
  minAge: 13,
  usernameMin: 3,
  usernameMax: 24,
  displayNameMax: 40,
  bioMax: 160,
  /** Teks post (seperti X/Threads, tetapi lebih longgar). */
  postMax: 500,
  commentMax: 500,
  passwordMin: 8,
  passwordMax: 128,
  /** Satu penayangan sah per penonton per post per jendela ini. */
  viewDedupeMs: 30 * 60 * 1000,
  sessionTtlMs: 90 * 24 * 60 * 60 * 1000,
  mediaUrlTtlMs: 6 * 60 * 60 * 1000,
  pageSize: 20,
} as const;

export const VISIBILITIES = ["public", "relationship", "followers"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Jenis hubungan; selalu butuh persetujuan kedua pihak. */
export const RELATION_KINDS = ["friend", "bestfriend", "partner", "family"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RESERVED_USERNAMES = [
  "admin", "administrator", "root", "support", "help", "onym", "api", "app", "www", "mod",
  "moderator", "system", "settings", "search", "feed", "acak", "random", "profile", "about",
  "login", "logout", "register", "notifications", "official", "relations", "media",
];

export const LANGS = ["id", "en"] as const;
export const THEMES = ["light", "dark"] as const;
export type Lang = (typeof LANGS)[number];
export type Theme = (typeof THEMES)[number];
