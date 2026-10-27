-- Supabase di Onym HANYA menyimpan video & audio. Bucket privat; semua akses lewat URL bertanda tangan yang dibuat Worker
-- (kunci layanan ada di Worker, bukan di klien). Tidak ada tabel aplikasi di sini.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['video/mp4','audio/mp4','audio/mpeg','audio/ogg','audio/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Tanpa policy untuk anon/authenticated → klien tidak bisa membaca/menulis langsung (RLS menolak); hanya kunci layanan (Worker) yang bisa.
