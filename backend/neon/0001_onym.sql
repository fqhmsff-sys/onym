-- Onym · Neon Postgres = isi sosial: profil publik, posting, komentar, reaksi, ikuti/hubungan/blokir, pencarian, laporan, audit.
-- (Kredensial akun, sesi & batas login ada di Cloudflare D1; foto posting di MongoDB; video/audio di Supabase Storage.)
-- Akses HANYA lewat fungsi api_* : peran `onym_api` cuma boleh EXECUTE (tidak bisa SELECT/INSERT langsung ke tabel).
create extension if not exists pg_trgm;

create table public.profiles (
  id uuid primary key,                                   -- dibuat Worker (sama dengan id akun di D1)
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  bio text check (char_length(bio) <= 160),
  avatar_ver bigint check (avatar_ver is null or avatar_ver > 0),            -- foto profil disimpan di Cloudflare D1
  birth_date date check (birth_date is null or (birth_date >= date '1900-01-01' and birth_date <= current_date)),
  birth_date_visibility text not null default 'me',
  default_visibility text not null default 'public',
  relations_visibility text not null default 'public',
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 2048),
  created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  updated_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  media jsonb not null default '[]'::jsonb,
  visibility text not null default 'public' check (visibility in ('public','followers','following','mutual','relationship','friend','bestfriend','partner','family','me')),
  in_random boolean not null default false,
  random_key double precision not null default random(),
  created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint posts_media_shape check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 4),
  constraint posts_not_empty check (char_length(body) > 0 or jsonb_array_length(media) > 0)
);
create index posts_feed_idx   on public.posts (created_at desc, id desc) where deleted_at is null;
create index posts_author_idx on public.posts (author_id, created_at desc) where deleted_at is null;
create index posts_random_idx on public.posts (random_key) where deleted_at is null and in_random and visibility = 'public' and jsonb_array_length(media) > 0;
create index posts_body_trgm  on public.posts using gin (body gin_trgm_ops) where deleted_at is null and visibility = 'public';
create index posts_media_gin  on public.posts using gin (media jsonb_path_ops);
create index profiles_name_trgm  on public.profiles using gin (display_name gin_trgm_ops);
create index profiles_user_trgm  on public.profiles using gin (username gin_trgm_ops);

create table public.post_counters (
  post_id uuid primary key references public.posts(id) on delete cascade,
  stars int not null default 0 check (stars >= 0), comments int not null default 0 check (comments >= 0),
  views bigint not null default 0, rating_sum int not null default 0, rating_count int not null default 0
);
create table public.stars (post_id uuid not null references public.posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()), primary key (post_id, user_id));
create table public.post_ratings (post_id uuid not null references public.posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, stars smallint not null check (stars between 1 and 5), primary key (post_id, user_id));
create table public.saves (user_id uuid not null references public.profiles(id) on delete cascade, post_id uuid not null references public.posts(id) on delete cascade, created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()), primary key (user_id, post_id));
create index saves_user_idx on public.saves (user_id, created_at desc);
create table public.post_views (post_id uuid not null references public.posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, day date not null default current_date, primary key (post_id, user_id, day));

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  like_count int not null default 0 check (like_count >= 0),
  created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()), edited_at timestamptz, deleted_at timestamptz
);
create index comments_post_idx on public.comments (post_id, created_at) where deleted_at is null;
create table public.comment_likes (comment_id uuid not null references public.comments(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, primary key (comment_id, user_id));

create table public.follows (follower_id uuid not null references public.profiles(id) on delete cascade, followee_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()), primary key (follower_id, followee_id), check (follower_id <> followee_id));
create index follows_followee_idx on public.follows (followee_id);
create table public.profile_counters (user_id uuid primary key references public.profiles(id) on delete cascade, followers int not null default 0 check (followers >= 0), following int not null default 0 check (following >= 0), posts int not null default 0 check (posts >= 0));
create table public.blocks (blocker uuid not null references public.profiles(id) on delete cascade, blocked uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()), primary key (blocker, blocked), check (blocker <> blocked));
create table public.relations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade, user_b uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('friend','bestfriend','partner','family')), status text not null default 'pending' check (status in ('pending','approved')),
  pair_key text generated always as (least(user_a::text, user_b::text) || ':' || greatest(user_a::text, user_b::text)) stored,
  created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()), approved_at timestamptz, check (user_a <> user_b), unique (pair_key));
create index relations_a_idx on public.relations (user_a); create index relations_b_idx on public.relations (user_b);

create table public.audit_events (id bigint generated always as identity primary key, at timestamptz not null default now(), kind text not null check (char_length(kind) <= 40), user_id uuid, ip_hash text, route text, status int, detail jsonb not null default '{}'::jsonb);
create index audit_at_idx on public.audit_events (at desc); create index audit_kind_idx on public.audit_events (kind, at desc);
create table public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid not null, post_id uuid not null, reason text not null check (reason in ('spam','kekerasan','pelecehan','ilegal','lainnya')), note text check (char_length(note) <= 500), status text not null default 'baru' check (status in ('baru','ditinjau','selesai','ditolak')), created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()), unique (reporter_id, post_id));

-- ===================================================== Trigger
create function public.t_touch() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger posts_touch before update on public.posts for each row execute function public.t_touch();
create trigger profiles_touch before update on public.profiles for each row execute function public.t_touch();
create function public.t_user_new() returns trigger language plpgsql set search_path = '' as $$ begin insert into public.profile_counters (user_id) values (new.id); return new; end $$;
create trigger profiles_counters after insert on public.profiles for each row execute function public.t_user_new();
create function public.t_post_new() returns trigger language plpgsql set search_path = '' as $$ begin insert into public.post_counters (post_id) values (new.id); return new; end $$;
create trigger posts_counters after insert on public.posts for each row execute function public.t_post_new();

create function public.t_post_media() returns trigger language plpgsql set search_path = '' as $$
declare m jsonb;
begin
  for m in select * from jsonb_array_elements(new.media) loop
    if jsonb_typeof(m) <> 'object' or (m->>'kind') not in ('photo','video','audio')
       or ((m->>'kind') = 'photo' and (m->>'key') !~ '^p/[0-9a-f]{24}$')
       or ((m->>'kind') = 'video' and (m->>'key') !~ ('^v/' || new.author_id::text || '/[0-9a-f-]{36}\.mp4$'))
       or ((m->>'kind') = 'audio' and (m->>'key') !~ ('^a/' || new.author_id::text || '/[0-9a-f-]{36}\.(m4a|mp3|ogg|webm)$'))
       or coalesce((m->>'w')::int, 0) not between 0 and 20000 or coalesce((m->>'h')::int, 0) not between 0 and 20000
       or ((m->>'kind') = 'video' and coalesce((m->>'d')::bigint, 0) > 10500)
       or coalesce((m->>'d')::bigint, 0) not between 0 and 86400000 then
      raise exception 'invalid';
    end if;
  end loop;
  if new.in_random and (new.visibility <> 'public' or jsonb_array_length(new.media) = 0) then new.in_random := false; end if;
  return new;
end $$;
create trigger posts_media before insert or update of media, visibility, in_random on public.posts for each row execute function public.t_post_media();

create function public.t_post_count() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.profile_counters set posts = posts + 1 where user_id = new.author_id;
  elsif old.deleted_at is null and new.deleted_at is not null then update public.profile_counters set posts = greatest(posts - 1, 0) where user_id = new.author_id; end if;
  return null;
end $$;
create trigger posts_pcount after insert or update of deleted_at on public.posts for each row execute function public.t_post_count();

create function public.t_follow_count() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.profile_counters set followers = followers + 1 where user_id = new.followee_id; update public.profile_counters set following = following + 1 where user_id = new.follower_id;
  else update public.profile_counters set followers = greatest(followers - 1, 0) where user_id = old.followee_id; update public.profile_counters set following = greatest(following - 1, 0) where user_id = old.follower_id; end if;
  return null;
end $$;
create trigger follows_count after insert or delete on public.follows for each row execute function public.t_follow_count();

create function public.t_star_count() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.post_counters set stars = stars + 1 where post_id = new.post_id; else update public.post_counters set stars = greatest(stars - 1, 0) where post_id = old.post_id; end if;
  return null;
end $$;
create trigger stars_count after insert or delete on public.stars for each row execute function public.t_star_count();

create function public.t_rating_count() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.post_counters set rating_sum = rating_sum + new.stars, rating_count = rating_count + 1 where post_id = new.post_id;
  elsif tg_op = 'UPDATE' then update public.post_counters set rating_sum = rating_sum - old.stars + new.stars where post_id = new.post_id;
  else update public.post_counters set rating_sum = greatest(rating_sum - old.stars, 0), rating_count = greatest(rating_count - 1, 0) where post_id = old.post_id; end if;
  return null;
end $$;
create trigger ratings_count after insert or update or delete on public.post_ratings for each row execute function public.t_rating_count();

create function public.t_comment_count() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.post_counters set comments = comments + 1 where post_id = new.post_id;
  elsif old.deleted_at is null and new.deleted_at is not null then update public.post_counters set comments = greatest(comments - 1, 0) where post_id = new.post_id; end if;
  return null;
end $$;
create trigger comments_count after insert or update of deleted_at on public.comments for each row execute function public.t_comment_count();

create function public.t_clike_count() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.comments set like_count = like_count + 1 where id = new.comment_id; else update public.comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id; end if;
  return null;
end $$;
create trigger clikes_count after insert or delete on public.comment_likes for each row execute function public.t_clike_count();

create function public.t_limit() returns trigger language plpgsql set search_path = '' as $$
declare n int;
begin
  if tg_table_name = 'posts' then select count(*) into n from public.posts where author_id = new.author_id and created_at > now() - interval '1 minute'; if n >= 10 then raise exception 'rate_limited'; end if;
  elsif tg_table_name = 'comments' then select count(*) into n from public.comments where author_id = new.author_id and created_at > now() - interval '1 minute'; if n >= 30 then raise exception 'rate_limited'; end if;
  elsif tg_table_name = 'follows' then select count(*) into n from public.follows where follower_id = new.follower_id and created_at > now() - interval '1 hour'; if n >= 100 then raise exception 'rate_limited'; end if;
  elsif tg_table_name = 'relations' then select count(*) into n from public.relations where user_a = new.user_a and created_at > now() - interval '1 hour'; if n >= 20 then raise exception 'rate_limited'; end if; end if;
  return new;
end $$;
create trigger posts_limit before insert on public.posts for each row execute function public.t_limit();
create trigger comments_limit before insert on public.comments for each row execute function public.t_limit();
create trigger follows_limit before insert on public.follows for each row execute function public.t_limit();
create trigger relations_limit before insert on public.relations for each row execute function public.t_limit();

-- ===================================================== Inti aturan akses (SATU tempat)
create function public.can_view(p_viewer uuid, p_owner uuid, p_vis text) returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_viewer is null then return p_vis = 'public'; end if;
  if p_owner = p_viewer then return true; end if;
  if exists (select 1 from public.blocks b where (b.blocker = p_owner and b.blocked = p_viewer) or (b.blocker = p_viewer and b.blocked = p_owner)) then return false; end if;
  return case p_vis
    when 'public' then true
    when 'me' then false
    when 'followers' then exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = p_owner)
    when 'following' then exists (select 1 from public.follows f where f.follower_id = p_owner and f.followee_id = p_viewer)
    when 'mutual' then exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = p_owner) and exists (select 1 from public.follows f where f.follower_id = p_owner and f.followee_id = p_viewer)
    when 'relationship' then exists (select 1 from public.relations r where r.status = 'approved' and ((r.user_a = p_owner and r.user_b = p_viewer) or (r.user_a = p_viewer and r.user_b = p_owner)))
    when 'friend' then exists (select 1 from public.relations r where r.status = 'approved' and r.kind = 'friend' and ((r.user_a = p_owner and r.user_b = p_viewer) or (r.user_a = p_viewer and r.user_b = p_owner)))
    when 'bestfriend' then exists (select 1 from public.relations r where r.status = 'approved' and r.kind = 'bestfriend' and ((r.user_a = p_owner and r.user_b = p_viewer) or (r.user_a = p_viewer and r.user_b = p_owner)))
    when 'partner' then exists (select 1 from public.relations r where r.status = 'approved' and r.kind = 'partner' and ((r.user_a = p_owner and r.user_b = p_viewer) or (r.user_a = p_viewer and r.user_b = p_owner)))
    when 'family' then exists (select 1 from public.relations r where r.status = 'approved' and r.kind = 'family' and ((r.user_a = p_owner and r.user_b = p_viewer) or (r.user_a = p_viewer and r.user_b = p_owner)))
    else false end;
end $$;

create function public.assert_active(p_actor uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = p_actor) then raise exception 'unauthorized'; end if;
end $$;

-- ===================================================== Bentuk baris posting
create type public.post_row as (id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, media jsonb, visibility text, in_random boolean,
  created_at timestamptz, updated_at timestamptz, stars int, comments int, views int, rating_avg float8, rating_count int, starred boolean, saved boolean, my_rating smallint);

create function public.post_rows(p_viewer uuid, p_ids uuid[]) returns setof public.post_row language sql stable security definer set search_path = '' as $$
  select p.id, p.author_id, u.display_name, u.username, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end, p.body, p.media, p.visibility, p.in_random, p.created_at, p.updated_at,
         c.stars, c.comments, c.views::int, case when c.rating_count > 0 then round(c.rating_sum::numeric / c.rating_count, 2)::float8 else null end, c.rating_count,
         exists (select 1 from public.stars s where s.post_id = p.id and s.user_id = p_viewer),
         exists (select 1 from public.saves sv where sv.post_id = p.id and sv.user_id = p_viewer),
         (select r.stars from public.post_ratings r where r.post_id = p.id and r.user_id = p_viewer)
  from public.posts p join public.profiles u on u.id = p.author_id join public.post_counters c on c.post_id = p.id
  where p.deleted_at is null and p.id = any (p_ids[1:50]) and public.can_view(p_viewer, p.author_id, p.visibility)
$$;

create function public.valid_vis(p text) returns boolean language sql immutable set search_path = '' as $$
  select p = any (array['public','followers','following','mutual','relationship','friend','bestfriend','partner','family','me'])
$$;

-- ===================================================== API: akun
create function public.api_create_profile(p_id uuid, p_username text, p_display text) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, display_name) values (p_id, lower(p_username), p_display);
exception when unique_violation then raise exception 'conflict'; when check_violation then raise exception 'invalid';
end $$;
create function public.api_me(p_actor uuid) returns table (id uuid, username text, display_name text, bio text, avatar text, birth_date text, birth_date_visibility text, default_visibility text, relations_visibility text, settings jsonb)
language sql stable security definer set search_path = '' as $$
  select u.id, u.username, u.display_name, u.bio, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end, u.birth_date::text, u.birth_date_visibility, u.default_visibility, u.relations_visibility, u.settings
  from public.profiles u where u.id = p_actor
$$;
create function public.api_update_me(p_actor uuid, p_patch jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_active(p_actor);
  if (p_patch ? 'birth_date_visibility' and not public.valid_vis(p_patch->>'birth_date_visibility'))
     or (p_patch ? 'default_visibility' and not public.valid_vis(p_patch->>'default_visibility'))
     or (p_patch ? 'relations_visibility' and not public.valid_vis(p_patch->>'relations_visibility')) then raise exception 'invalid'; end if;
  update public.profiles set
    display_name = coalesce(p_patch->>'display_name', display_name),
    bio = case when p_patch ? 'bio' then nullif(p_patch->>'bio', '') else bio end,
    birth_date = case when p_patch ? 'birth_date' then nullif(p_patch->>'birth_date', '')::date else birth_date end,
    birth_date_visibility = coalesce(p_patch->>'birth_date_visibility', birth_date_visibility),
    default_visibility = coalesce(p_patch->>'default_visibility', default_visibility),
    relations_visibility = coalesce(p_patch->>'relations_visibility', relations_visibility),
    settings = case when p_patch ? 'settings' then p_patch->'settings' else settings end
  where id = p_actor;
exception when check_violation or invalid_text_representation or datetime_field_overflow then raise exception 'invalid';
end $$;
create function public.api_set_avatar(p_actor uuid, p_ver bigint) returns void language plpgsql security definer set search_path = '' as $$
begin perform public.assert_active(p_actor); update public.profiles set avatar_ver = p_ver where id = p_actor; end $$;
create function public.api_delete_me(p_actor uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare keys jsonb;
begin
  select coalesce(jsonb_agg(m->>'key'), '[]'::jsonb) into keys from public.posts p, jsonb_array_elements(p.media) m where p.author_id = p_actor;
  delete from public.profiles where id = p_actor;
  return keys;
end $$;

-- ===================================================== API: umpan & posting
create function public.api_feed(p_viewer uuid, p_before_ts timestamptz, p_before_id uuid, p_limit int) returns setof public.post_row language sql stable security definer set search_path = '' as $$
  select r.* from (select p.id from public.posts p where p.deleted_at is null and public.can_view(p_viewer, p.author_id, p.visibility)
      and (p_before_ts is null or (p.created_at, p.id) < (p_before_ts, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by p.created_at desc, p.id desc limit least(greatest(p_limit, 1), 50)) k cross join lateral public.post_rows(p_viewer, array[k.id]) r order by r.created_at desc, r.id desc
$$;
create function public.api_posts_by_ids(p_viewer uuid, p_ids uuid[]) returns setof public.post_row language sql stable security definer set search_path = '' as $$ select * from public.post_rows(p_viewer, p_ids) $$;
create function public.api_user_posts(p_viewer uuid, p_username text, p_before_ts timestamptz, p_before_id uuid, p_limit int) returns setof public.post_row language sql stable security definer set search_path = '' as $$
  select r.* from (select p.id from public.posts p join public.profiles u on u.id = p.author_id where u.username = lower(p_username) and p.deleted_at is null and public.can_view(p_viewer, p.author_id, p.visibility)
      and (p_before_ts is null or (p.created_at, p.id) < (p_before_ts, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by p.created_at desc, p.id desc limit least(greatest(p_limit, 1), 50)) k cross join lateral public.post_rows(p_viewer, array[k.id]) r order by r.created_at desc, r.id desc
$$;
create function public.api_random(p_viewer uuid, p_limit int) returns setof public.post_row language plpgsql stable security definer set search_path = '' as $$
declare x double precision := random(); n int := least(greatest(p_limit, 1), 20); ids uuid[];
begin
  select array_agg(id) into ids from (
    (select id, 0 as part, random_key from public.posts where deleted_at is null and in_random and visibility = 'public' and jsonb_array_length(media) > 0 and random_key >= x order by random_key limit n)
    union all
    (select id, 1, random_key from public.posts where deleted_at is null and in_random and visibility = 'public' and jsonb_array_length(media) > 0 and random_key < x order by random_key limit n)
    order by part, random_key limit n) q;
  return query select * from public.post_rows(p_viewer, coalesce(ids, '{}'));
end $$;
create function public.api_saved(p_viewer uuid, p_limit int) returns setof public.post_row language sql stable security definer set search_path = '' as $$
  select r.* from (select s.post_id, s.created_at from public.saves s where s.user_id = p_viewer order by s.created_at desc limit least(greatest(p_limit, 1), 50)) k
  cross join lateral public.post_rows(p_viewer, array[k.post_id]) r order by k.created_at desc
$$;
create function public.api_search_posts(p_viewer uuid, p_q text) returns setof public.post_row language sql stable security definer set search_path = '' as $$
  select r.* from (select p.id from public.posts p where length(trim(p_q)) between 2 and 60 and p.deleted_at is null and p.visibility = 'public'
      and p.body ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    order by p.created_at desc limit 30) k cross join lateral public.post_rows(p_viewer, array[k.id]) r order by r.created_at desc
$$;
create function public.api_search_users(p_viewer uuid, p_q text) returns table (id uuid, username text, display_name text, avatar text) language sql stable security definer set search_path = '' as $$
  select u.id, u.username, u.display_name, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end from public.profiles u
  where length(trim(p_q)) between 2 and 40
    and (u.username ilike replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' or u.display_name ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%')
    and not exists (select 1 from public.blocks b where (b.blocker = u.id and b.blocked = p_viewer) or (b.blocker = p_viewer and b.blocked = u.id))
  order by (u.username = lower(trim(p_q))) desc, u.username limit 30
$$;

create function public.api_create_post(p_actor uuid, p_id uuid, p_body text, p_media jsonb, p_vis text, p_random boolean) returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.assert_active(p_actor);
  if not public.valid_vis(p_vis) then raise exception 'invalid'; end if;
  insert into public.posts (id, author_id, body, media, visibility, in_random) values (p_id, p_actor, p_body, p_media, p_vis, p_random) on conflict (id) do nothing;
  get diagnostics n = row_count;
  if n = 0 and not exists (select 1 from public.posts where id = p_id and author_id = p_actor) then raise exception 'conflict'; end if;
  return n > 0;
exception when check_violation then raise exception 'invalid';
end $$;
create function public.api_edit_post(p_actor uuid, p_id uuid, p_patch jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.assert_active(p_actor);
  if p_patch ? 'visibility' and not public.valid_vis(p_patch->>'visibility') then raise exception 'invalid'; end if;
  update public.posts set body = coalesce(p_patch->>'body', body), visibility = coalesce(p_patch->>'visibility', visibility),
    in_random = case when p_patch ? 'in_random' then (p_patch->>'in_random')::boolean else in_random end
   where id = p_id and author_id = p_actor and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found'; end if;
exception when check_violation or invalid_text_representation then raise exception 'invalid';
end $$;
create function public.api_delete_post(p_actor uuid, p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  perform public.assert_active(p_actor);
  update public.posts set deleted_at = now() where id = p_id and author_id = p_actor and deleted_at is null returning media into m;
  if m is null then raise exception 'not_found'; end if;
  return m;
end $$;

-- helper: postingan yang boleh dilihat aktor → pemiliknya
create function public.visible_author(p_viewer uuid, p_post uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare a uuid; v text;
begin
  select author_id, visibility into a, v from public.posts where id = p_post and deleted_at is null;
  if a is null or not public.can_view(p_viewer, a, v) then raise exception 'not_found'; end if;
  return a;
end $$;

create function public.api_set_star(p_actor uuid, p_post uuid, p_on boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare a uuid;
begin
  perform public.assert_active(p_actor); a := public.visible_author(p_actor, p_post);
  if p_on then insert into public.stars (post_id, user_id) values (p_post, p_actor) on conflict do nothing; else delete from public.stars where post_id = p_post and user_id = p_actor; end if;
  return a;
end $$;
create function public.api_set_save(p_actor uuid, p_post uuid, p_on boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_active(p_actor); perform public.visible_author(p_actor, p_post);
  if p_on then insert into public.saves (user_id, post_id) values (p_actor, p_post) on conflict do nothing; else delete from public.saves where user_id = p_actor and post_id = p_post; end if;
end $$;
create function public.api_rate(p_actor uuid, p_post uuid, p_stars int) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_active(p_actor); perform public.visible_author(p_actor, p_post);
  if p_stars is null then delete from public.post_ratings where post_id = p_post and user_id = p_actor;
  elsif p_stars between 1 and 5 then insert into public.post_ratings (post_id, user_id, stars) values (p_post, p_actor, p_stars) on conflict (post_id, user_id) do update set stars = excluded.stars;
  else raise exception 'invalid'; end if;
end $$;
create function public.api_view(p_actor uuid, p_post uuid) returns void language plpgsql security definer set search_path = '' as $$
declare a uuid; n int;
begin
  a := public.visible_author(p_actor, p_post);
  if a = p_actor then return; end if;
  insert into public.post_views (post_id, user_id) values (p_post, p_actor) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then update public.post_counters set views = views + 1 where post_id = p_post; end if;
end $$;

-- ===================================================== API: komentar
create function public.api_comments(p_viewer uuid, p_post uuid) returns table (id uuid, post_id uuid, parent_id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, created_at timestamptz, edited_at timestamptz, like_count int, liked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.visible_author(p_viewer, p_post);
  return query select c.id, c.post_id, c.parent_id, c.author_id, u.display_name, u.username, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end, c.body, c.created_at, c.edited_at, c.like_count,
         exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = p_viewer)
    from public.comments c join public.profiles u on u.id = c.author_id
    where c.post_id = p_post and c.deleted_at is null
      and not exists (select 1 from public.blocks b where (b.blocker = c.author_id and b.blocked = p_viewer) or (b.blocker = p_viewer and b.blocked = c.author_id))
    order by c.created_at asc limit 200;
end $$;
create function public.api_add_comment(p_actor uuid, p_id uuid, p_post uuid, p_parent uuid, p_body text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a uuid; pa uuid; n int;
begin
  perform public.assert_active(p_actor); a := public.visible_author(p_actor, p_post);
  if p_parent is not null then select author_id into pa from public.comments where id = p_parent and post_id = p_post and deleted_at is null; if pa is null then raise exception 'not_found'; end if; end if;
  insert into public.comments (id, post_id, author_id, parent_id, body) values (p_id, p_post, p_actor, p_parent, p_body) on conflict (id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('created', n > 0, 'post_author', a, 'parent_author', pa);
exception when check_violation then raise exception 'invalid';
end $$;
create function public.api_edit_comment(p_actor uuid, p_id uuid, p_body text) returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.assert_active(p_actor);
  update public.comments set body = p_body, edited_at = now() where id = p_id and author_id = p_actor and deleted_at is null;
  get diagnostics n = row_count; if n = 0 then raise exception 'not_found'; end if;
exception when check_violation then raise exception 'invalid';
end $$;
create function public.api_delete_comment(p_actor uuid, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.assert_active(p_actor);
  update public.comments set deleted_at = now() where id = p_id and author_id = p_actor and deleted_at is null;
  get diagnostics n = row_count; if n = 0 then raise exception 'not_found'; end if;
end $$;
create function public.api_like_comment(p_actor uuid, p_id uuid, p_on boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare a uuid; pid uuid;
begin
  perform public.assert_active(p_actor);
  select author_id, post_id into a, pid from public.comments where id = p_id and deleted_at is null;
  if a is null then raise exception 'not_found'; end if;
  perform public.visible_author(p_actor, pid);
  if p_on then insert into public.comment_likes (comment_id, user_id) values (p_id, p_actor) on conflict do nothing; else delete from public.comment_likes where comment_id = p_id and user_id = p_actor; end if;
  return a;
end $$;

-- ===================================================== API: sosial
create function public.api_profile(p_viewer uuid, p_username text) returns table (id uuid, username text, display_name text, bio text, avatar text, birth_date text, created_at timestamptz,
  followers int, following int, posts int, i_follow boolean, follows_me boolean, relation_kind text, relation_status text, relation_id uuid, blocked boolean, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.username, u.display_name, u.bio, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end,
         case when public.can_view(p_viewer, u.id, u.birth_date_visibility) then u.birth_date::text else null end, u.created_at, pc.followers, pc.following, pc.posts,
         exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = u.id), exists (select 1 from public.follows f where f.follower_id = u.id and f.followee_id = p_viewer),
         r.kind, r.status, r.id, exists (select 1 from public.blocks b where b.blocker = p_viewer and b.blocked = u.id), u.id = p_viewer
  from public.profiles u join public.profile_counters pc on pc.user_id = u.id
  left join lateral (select x.kind, x.status, x.id from public.relations x where (x.user_a = u.id and x.user_b = p_viewer) or (x.user_b = u.id and x.user_a = p_viewer) limit 1) r on true
  where u.username = lower(p_username) and not exists (select 1 from public.blocks b where b.blocker = u.id and b.blocked = p_viewer)
$$;
create function public.api_follow(p_actor uuid, p_username text, p_on boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  perform public.assert_active(p_actor);
  select id into t from public.profiles where username = lower(p_username);
  if t is null or t = p_actor then raise exception 'not_found'; end if;
  if exists (select 1 from public.blocks b where (b.blocker = t and b.blocked = p_actor) or (b.blocker = p_actor and b.blocked = t)) then raise exception 'forbidden'; end if;
  if p_on then insert into public.follows (follower_id, followee_id) values (p_actor, t) on conflict do nothing; else delete from public.follows where follower_id = p_actor and followee_id = t; end if;
  return t;
end $$;
create function public.api_follow_list(p_viewer uuid, p_username text, p_kind text, p_before timestamptz, p_limit int) returns table (id uuid, username text, display_name text, avatar text, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select pr.id, pr.username, pr.display_name, case when pr.avatar_ver is null then null else pr.id::text || '/' || pr.avatar_ver end, f.created_at
  from public.profiles t join public.follows f on (p_kind = 'followers' and f.followee_id = t.id) or (p_kind = 'following' and f.follower_id = t.id)
  join public.profiles pr on pr.id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
  where t.username = lower(p_username) and p_kind in ('followers', 'following') and (p_before is null or f.created_at < p_before)
    and not exists (select 1 from public.blocks b where (b.blocker = pr.id and b.blocked = p_viewer) or (b.blocker = p_viewer and b.blocked = pr.id))
  order by f.created_at desc limit least(greatest(p_limit, 1), 50)
$$;
create function public.api_block(p_actor uuid, p_username text, p_on boolean) returns void language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  perform public.assert_active(p_actor);
  select id into t from public.profiles where username = lower(p_username);
  if t is null or t = p_actor then raise exception 'not_found'; end if;
  if p_on then
    insert into public.blocks (blocker, blocked) values (p_actor, t) on conflict do nothing;
    delete from public.follows where (follower_id = p_actor and followee_id = t) or (follower_id = t and followee_id = p_actor);
    delete from public.relations where (user_a = p_actor and user_b = t) or (user_a = t and user_b = p_actor);
  else delete from public.blocks where blocker = p_actor and blocked = t; end if;
end $$;
create function public.api_blocked(p_actor uuid) returns table (id uuid, username text, display_name text, avatar text) language sql stable security definer set search_path = '' as $$
  select u.id, u.username, u.display_name, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end from public.blocks b join public.profiles u on u.id = b.blocked where b.blocker = p_actor order by b.created_at desc limit 200
$$;
create function public.api_request_relation(p_actor uuid, p_username text, p_kind text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; rid uuid;
begin
  perform public.assert_active(p_actor);
  select id into t from public.profiles where username = lower(p_username);
  if t is null or t = p_actor then raise exception 'not_found'; end if;
  if exists (select 1 from public.blocks b where (b.blocker = t and b.blocked = p_actor) or (b.blocker = p_actor and b.blocked = t)) then raise exception 'forbidden'; end if;
  insert into public.relations (user_a, user_b, kind) values (p_actor, t, p_kind) returning id into rid;
  return jsonb_build_object('id', rid, 'target', t);
exception when unique_violation then raise exception 'conflict'; when check_violation then raise exception 'invalid';
end $$;
create function public.api_my_relations(p_actor uuid) returns table (id uuid, other_username text, other_name text, other_avatar text, kind text, status text, incoming boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, u.username, u.display_name, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end, r.kind, r.status, r.user_b = p_actor, r.created_at
  from public.relations r join public.profiles u on u.id = case when r.user_a = p_actor then r.user_b else r.user_a end where r.user_a = p_actor or r.user_b = p_actor order by r.created_at desc
$$;
create function public.api_approve_relation(p_actor uuid, p_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare a uuid;
begin
  perform public.assert_active(p_actor);
  update public.relations set status = 'approved', approved_at = now() where id = p_id and user_b = p_actor and status = 'pending' returning user_a into a;
  if a is null then raise exception 'not_found'; end if;
  return a;
end $$;
create function public.api_remove_relation(p_actor uuid, p_id uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.relations where id = p_id and (user_a = p_actor or user_b = p_actor)
$$;
create function public.api_user_relations(p_viewer uuid, p_username text) returns table (other_username text, other_name text, other_avatar text, kind text) language sql stable security definer set search_path = '' as $$
  select pr.username, pr.display_name, case when pr.avatar_ver is null then null else pr.id::text || '/' || pr.avatar_ver end, r.kind from public.profiles t
  join public.relations r on r.status = 'approved' and (r.user_a = t.id or r.user_b = t.id) join public.profiles pr on pr.id = case when r.user_a = t.id then r.user_b else r.user_a end
  where t.username = lower(p_username) and public.can_view(p_viewer, t.id, t.relations_visibility)
$$;

-- ===================================================== API: bantuan Worker (media, linimasa, audit, laporan)
create function public.api_users_lite(p_ids uuid[]) returns table (id uuid, username text, display_name text, avatar text) language sql stable security definer set search_path = '' as $$
  select u.id, u.username, u.display_name, case when u.avatar_ver is null then null else u.id::text || '/' || u.avatar_ver end from public.profiles u where u.id = any (p_ids[1:100])
$$;
create function public.api_media_visible(p_viewer uuid, p_keys text[]) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(k), '[]'::jsonb) from unnest(p_keys[1:24]) k where exists (select 1 from public.posts p where p.deleted_at is null and p.media @> jsonb_build_array(jsonb_build_object('key', k)) and public.can_view(p_viewer, p.author_id, p.visibility))
$$;
create function public.api_fanout_targets(p_author uuid, p_limit int) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(follower_id), '[]'::jsonb) from (select follower_id from public.follows where followee_id = p_author limit least(p_limit, 5000)) q
$$;
create function public.api_report(p_actor uuid, p_post uuid, p_reason text, p_note text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_active(p_actor); perform public.visible_author(p_actor, p_post);
  insert into public.reports (reporter_id, post_id, reason, note) values (p_actor, p_post, p_reason, p_note) on conflict (reporter_id, post_id) do nothing;
exception when check_violation then raise exception 'invalid';
end $$;
create function public.api_audit(p_kind text, p_user uuid, p_ip_hash text, p_route text, p_status int, p_detail jsonb) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (kind, user_id, ip_hash, route, status, detail) values (left(p_kind, 40), p_user, p_ip_hash, left(p_route, 120), p_status, coalesce(p_detail, '{}'::jsonb))
$$;
create function public.api_purge() returns void language sql security definer set search_path = '' as $$
  delete from public.audit_events where at < now() - interval '90 days'; delete from public.post_views where day < current_date - 7
$$;

-- ===================================================== Hak akses: peran API hanya EXECUTE fungsi api_*
revoke all on all tables in schema public from public;
revoke all on all functions in schema public from public;
-- Jalankan sekali (ganti kata sandi):  create role onym_api login password '<acak-panjang>';
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'onym_api') then
    grant usage on schema public to onym_api;
    perform 1;
    execute (select 'grant execute on function ' || string_agg(p.oid::regprocedure::text, ', ') || ' to onym_api' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'api\_%');
  end if;
end $$;
