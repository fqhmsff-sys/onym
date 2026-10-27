-- Uji perilaku skema di Postgres sungguhan. Seluruhnya DIBATALKAN di akhir (raise 'TEST_OK' = lolos; pesan 'FAIL …' = ada yang salah).
-- Jalankan di Neon SQL Editor setelah 0001_onym.sql.
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); n int; r record; j jsonb;
begin
  perform public.api_create_profile(a,'alice','Alice'); perform public.api_create_profile(b,'bob','Bob'); perform public.api_create_profile(c,'carol','Carol');
  begin perform public.api_create_profile(gen_random_uuid(),'ALICE','x'); raise exception 'FAIL dup'; exception when others then if sqlerrm <> 'conflict' then raise exception 'FAIL dup %', sqlerrm; end if; end;
  perform public.api_create_post(a, p1, 'halo publik', '[]', 'public', false);
  perform public.api_create_post(a, p2, 'rahasia pengikut', '[]', 'followers', false);
  if public.api_create_post(a, p1, 'halo publik', '[]', 'public', false) then raise exception 'FAIL idempoten'; end if;
  begin perform public.api_create_post(b, p1, 'x', '[]', 'public', false); raise exception 'FAIL conflict'; exception when others then if sqlerrm <> 'conflict' then raise exception 'FAIL conflict %', sqlerrm; end if; end;
  select count(*) into n from public.api_feed(null, null, null, 20); if n <> 1 then raise exception 'FAIL feed anonim %', n; end if;
  select count(*) into n from public.api_feed(b, null, null, 20); if n <> 1 then raise exception 'FAIL feed bukan pengikut %', n; end if;
  perform public.api_follow(b, 'alice', true);
  select count(*) into n from public.api_feed(b, null, null, 20); if n <> 2 then raise exception 'FAIL feed pengikut %', n; end if;
  select followers into n from public.profile_counters where user_id = a; if n <> 1 then raise exception 'FAIL hitung pengikut %', n; end if;
  perform public.api_block(a, 'bob', true);
  select count(*) into n from public.api_feed(b, null, null, 20); if n <> 0 then raise exception 'FAIL terblokir masih melihat %', n; end if;
  select followers into n from public.profile_counters where user_id = a; if n <> 0 then raise exception 'FAIL blokir tidak memutus ikuti %', n; end if;
  perform public.api_block(a, 'bob', false);
  perform public.api_set_star(c, p1, true); perform public.api_rate(c, p1, 4); perform public.api_rate(c, p1, 2); perform public.api_set_save(c, p1, true); perform public.api_view(c, p1);
  select * into r from public.api_posts_by_ids(c, array[p1]);
  if r.stars <> 1 or r.rating_avg <> 2 or r.rating_count <> 1 or not r.starred or not r.saved or r.my_rating <> 2 or r.views <> 1 then raise exception 'FAIL reaksi %', row_to_json(r); end if;
  begin perform public.api_set_star(c, p2, true); raise exception 'FAIL bintang posting privat'; exception when others then if sqlerrm <> 'not_found' then raise exception 'FAIL bintang privat %', sqlerrm; end if; end;
  perform public.api_add_comment(c, gen_random_uuid(), p1, null, 'komentar');
  select count(*) into n from public.api_comments(c, p1); if n <> 1 then raise exception 'FAIL komentar %', n; end if;
  select comments into n from public.post_counters where post_id = p1; if n <> 1 then raise exception 'FAIL hitung komentar'; end if;
  perform public.api_create_post(a, gen_random_uuid(), 'untuk teman', '[]', 'friend', false);
  j := public.api_request_relation(a, 'carol', 'friend');
  select count(*) into n from public.api_feed(c, null, null, 20); if n <> 1 then raise exception 'FAIL sebelum disetujui %', n; end if;
  perform public.api_approve_relation(c, (j->>'id')::uuid);
  select count(*) into n from public.api_feed(c, null, null, 20); if n <> 2 then raise exception 'FAIL setelah disetujui %', n; end if;
  begin perform public.api_create_post(a, gen_random_uuid(), 'x', jsonb_build_array(jsonb_build_object('kind','video','key','v/'||b||'/'||gen_random_uuid()||'.mp4','d',1000)), 'public', false); raise exception 'FAIL media orang lain'; exception when others then if sqlerrm <> 'invalid' then raise exception 'FAIL media orang lain %', sqlerrm; end if; end;
  begin perform public.api_create_post(a, gen_random_uuid(), 'x', jsonb_build_array(jsonb_build_object('kind','video','key','v/'||a||'/'||gen_random_uuid()||'.mp4','d',20000)), 'public', false); raise exception 'FAIL video panjang'; exception when others then if sqlerrm <> 'invalid' then raise exception 'FAIL video panjang %', sqlerrm; end if; end;
  perform public.api_create_post(a, gen_random_uuid(), 'foto', '[{"kind":"photo","key":"p/0123456789abcdef01234567","w":800,"h":6000}]', 'public', true);
  select count(*) into n from public.api_random(c, 5); if n <> 1 then raise exception 'FAIL acak %', n; end if;
  select count(*) into n from public.api_search_posts(c, 'halo'); if n <> 1 then raise exception 'FAIL cari posting %', n; end if;
  select count(*) into n from public.api_search_users(c, 'ali'); if n <> 1 then raise exception 'FAIL cari orang %', n; end if;
  select count(*) into n from public.api_search_posts(c, '%'); if n <> 0 then raise exception 'FAIL wildcard %', n; end if;
  select * into r from public.api_profile(c, 'alice'); if r.username <> 'alice' or r.relation_kind <> 'friend' then raise exception 'FAIL profil %', row_to_json(r); end if;
  j := public.api_delete_post(a, p1);
  select count(*) into n from public.api_feed(c, null, null, 20); if n <> 1 then raise exception 'FAIL hapus posting %', n; end if;
  j := public.api_delete_me(a); select count(*) into n from public.posts where author_id = a; if n <> 0 then raise exception 'FAIL cascade'; end if;
  raise exception 'TEST_OK';
end $$;
