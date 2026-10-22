-- Onym — skema (Cloudflare D1 / SQLite). Semua waktu = epoch milidetik dari server.

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  username           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name       TEXT NOT NULL,
  bio                TEXT NOT NULL DEFAULT '',
  password_hash      TEXT NOT NULL,
  birth_date         TEXT NOT NULL,                 -- YYYY-MM-DD, dari pemilih tanggal/bulan/tahun
  birth_date_public  INTEGER NOT NULL DEFAULT 0,
  default_visibility TEXT NOT NULL DEFAULT 'public' CHECK (default_visibility IN ('public','relationship','followers')),
  default_in_random  INTEGER NOT NULL DEFAULT 1,
  avatar_version     INTEGER NOT NULL DEFAULT 0,
  lang               TEXT NOT NULL DEFAULT 'id',
  theme              TEXT NOT NULL DEFAULT 'light',
  notif_follow       INTEGER NOT NULL DEFAULT 1,
  notif_comment      INTEGER NOT NULL DEFAULT 1,
  notif_reply        INTEGER NOT NULL DEFAULT 1,
  notif_relation     INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  device       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Akun tanpa email: pemulihan lewat kode sekali pakai (disimpan sebagai hash).
CREATE TABLE recovery_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at   INTEGER
);
CREATE INDEX idx_recovery_user ON recovery_codes(user_id);

-- Post: teks dan/atau media (audio, foto, video ≤ 10 dtk) — campur bebas.
CREATE TABLE posts (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('public','relationship','followers')),
  in_random  INTEGER NOT NULL DEFAULT 1,
  has_media  INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_posts_feed   ON posts(created_at DESC, id DESC);
CREATE INDEX idx_posts_owner  ON posts(owner_id, created_at DESC, id DESC);
CREATE INDEX idx_posts_random ON posts(in_random, has_media, id);

CREATE TABLE post_media (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('audio','photo','video')),
  object_key  TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_media_post ON post_media(post_id, position);

CREATE TABLE ratings (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- Penayangan sah: satu hitungan per penonton per post per jendela waktu.
CREATE TABLE view_dedupe (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  last_at    INTEGER NOT NULL,
  PRIMARY KEY (post_id, viewer_key)
);

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at DESC);
CREATE INDEX idx_comments_parent ON comments(parent_id);

-- Mengikuti: satu arah, langsung aktif (tanpa persetujuan).
CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_follows_followee ON follows(followee_id, created_at DESC);

-- Hubungan (teman, sahabat, pacar, keluarga): dua arah, WAJIB disetujui kedua pihak.
-- pair_key = id terkecil + ":" + id terbesar → satu baris per pasangan.
CREATE TABLE relationships (
  pair_key     TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('friend','bestfriend','partner','family')),
  status       TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  CHECK (requester_id <> target_id)
);
CREATE INDEX idx_rel_requester ON relationships(requester_id, status);
CREATE INDEX idx_rel_target ON relationships(target_id, status);

CREATE TABLE saves (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX idx_saves_user ON saves(user_id, created_at DESC);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('follow','relation_request','relation_accepted','comment','reply')),
  actor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    TEXT REFERENCES posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  kind       TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC, id DESC);

-- Pelaporan penyalahgunaan (laporan dikumpulkan di tabel ini untuk ditinjau).
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','user')),
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
