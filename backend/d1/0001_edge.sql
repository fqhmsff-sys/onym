-- Onym · Cloudflare D1 (SQLite di tepi, konsisten kuat, dibaca langsung oleh Worker tanpa hop jaringan)
-- Tugas D1: IDENTITAS & SESI (akun, kata sandi-turunan, token segar, batas login), konfigurasi, perangkat, foto profil, indeks media.
create table if not exists accounts (
  id text primary key,
  username text not null unique check (length(username) between 3 and 20),
  salt text not null,                    -- base64 (16 byte) garam KDF — dipakai di perangkat
  verifier text not null,                -- base64 HMAC(pepper, kunci-turunan) — BUKAN kata sandi
  recovery text not null default '[]',   -- JSON: SHA-256 (hex) kode pemulihan yang belum terpakai
  banned_until integer, banned_reason text,
  created_at integer not null default (unixepoch())
);
create table if not exists sessions (
  id text primary key,
  user_id text not null references accounts(id) on delete cascade,
  token_hash text not null unique,       -- SHA-256 (hex) token segar; token asli tidak pernah disimpan
  family text not null,
  used integer not null default 0,       -- 1 = sudah dirotasi (dipakai ulang = pencurian token → seluruh keluarga dicabut)
  expires_at integer not null, created_at integer not null, last_used integer not null, ua text
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_family_idx on sessions (family);
create table if not exists attempts (    -- batas percobaan login / daftar / pemulihan
  k text primary key, n integer not null default 0, window_start integer not null, locked_until integer not null default 0
);

create table if not exists app_config (key text primary key, value text not null, updated_at integer not null default (unixepoch()));
insert or ignore into app_config (key, value) values
  ('min_version', '1'), ('maintenance', ''), ('motd', ''), ('flag_random', '1'), ('flag_audio', '1'), ('flag_signup', '1');

create table if not exists devices (token text primary key, user_id text not null, platform text not null check (platform in ('android','web')), updated_at integer not null);
create index if not exists devices_user_idx on devices (user_id, updated_at desc);

create table if not exists avatars (user_id text primary key, mime text not null, data text not null, updated_at integer not null);  -- foto profil (base64, ≤ 90 KB)

create table if not exists media_index (  -- semua berkas pengguna (kuota, kepemilikan, pembersihan)
  key text primary key, owner text not null, size integer not null, mime text not null,
  status text not null default 'pending' check (status in ('pending','ready','attached')), created_at integer not null
);
create index if not exists media_owner_idx on media_index (owner, created_at);
create index if not exists media_status_idx on media_index (status, created_at);
