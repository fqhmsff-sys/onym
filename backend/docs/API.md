# API `/api/*` (JSON). Auth: `Authorization: Bearer <access>` kecuali ditandai publik.
**Akun**: POST `/auth/salt` `{username}` · `/auth/register` `{username,displayName,salt,key}` · `/auth/login` `{username,key}` · `/auth/refresh` `{refresh}` · `/auth/logout` · `/auth/recover` `{username,code,salt,key}` · (login) `/auth/password` `{oldKey,salt,key}` · `/auth/logout-all`
**Profil**: GET/PATCH/DELETE `/me` · GET `/users/{u}` · `/users/{u}/posts|followers|following|relations` · PUT/DELETE `/users/{u}/follow|block`
**Umpan**: GET `/feed/public` (publik, cache 10 dtk) · `/feed/home` · `/random` · `/saves` · `/search?q&type=users|posts`
**Posting**: POST `/posts` `{id?,body,media[],visibility,inRandom}` · GET/PATCH/DELETE `/posts/{id}` · PUT/DELETE `/posts/{id}/star|save|rating` · POST `/posts/{id}/view|report` · GET/POST `/posts/{id}/comments` · PATCH/DELETE `/comments/{id}` · PUT/DELETE `/comments/{id}/like`
**Hubungan**: GET/POST `/relations` · POST `/relations/{id}/approve` · DELETE `/relations/{id}` · GET `/blocked`
**Media**: POST `/media/photo` (mentah, ≤900 KB) · `/media/upload-url` `{ext,size}` → PUT langsung ke Supabase → `/media/commit` `{key}` · `/media/sign` `{keys[]}` · POST `/avatar` (mentah, ≤90 KB) · GET `/avatar/{uid}/{ver}` (publik) · GET `/photo/{id}?e&s` (URL bertanda tangan)
**Lain**: GET `/config` (publik) · `/notifications` · `/notifications/unread` · POST `/notifications/read` · POST/DELETE `/devices`
Galat: `{"error":"kode"}` — 400/401/403/404/409/411/413/415/422/429(+Retry-After)/502/507.
