import {
  LIMITS, RELATION_KINDS, checkComment, checkPostBody, checkStars, checkVisibility, type Visibility,
} from "@onym/shared";
import { MediaRejected, inspectMedia, type MediaInfo } from "../lib/mediainfo";
import { newId, secureRandomInt, sha256Hex } from "../lib/crypto";
import { decodeCursor, encodeCursor, fail, json, rateLimit, readJson } from "../lib/http";
import { verifyMediaToken } from "../lib/media";
import { getPost, notify, postSelect, toPostDTOs, toSummary, VIS_SQL, visParams, type PostRow } from "../lib/queries";
import type { AuthedCtx, Router } from "../lib/router";

const PAGE = LIMITS.pageSize;

export async function pageOf(env: Parameters<typeof toPostDTOs>[0], rows: PostRow[], viewer: string | null) {
  const items = await toPostDTOs(env, rows.slice(0, PAGE), viewer);
  const last = rows[PAGE - 1];
  return { items, nextCursor: rows.length > PAGE && last ? encodeCursor(last.created_at, last.id) : null };
}

type Kind = "photo" | "audio" | "video";

/** Periksa berkas unggahan baru (aturan sama dengan pembuatan post). `have` = media lama yang dipertahankan per jenis. */
async function readMediaItems(form: FormData, have: Record<Kind, number>): Promise<{ info: MediaInfo; bytes: Uint8Array }[]> {
  const files = form.getAll("media").filter((x): x is File => typeof x !== "string");
  if (files.length > LIMITS.maxPhotos + 2) fail(400, "too_many_files");
  const hints = String(form.get("durations") ?? "").split(",").map((x) => Math.max(0, Math.min(120_000, Number(x) || 0)));
  const n = { ...have };
  const items: { info: MediaInfo; bytes: Uint8Array }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    if (f.size > LIMITS.maxRequestBytes) fail(413, "post_too_large");
    const bytes = new Uint8Array(await f.arrayBuffer());
    let info: MediaInfo;
    try { info = inspectMedia(bytes, hints[i] ?? 0); } catch (e) {
      if (e instanceof MediaRejected) fail(415, e.code);
      throw e;
    }
    if (info.kind === "photo") {
      if (++n.photo > LIMITS.maxPhotos) fail(400, "too_many_photos");
      if (bytes.length > LIMITS.maxPhotoBytes) fail(413, "photo_too_large");
      if (info.width * info.height > LIMITS.maxPhotoPixels) fail(422, "photo_too_big_dims");
    } else if (info.kind === "audio") {
      if (++n.audio > 1) fail(400, "too_many_audio");
      if (info.silent === true) fail(422, "audio_silent");
    } else {
      if (++n.video > 1) fail(400, "too_many_video");
      if (bytes.length > LIMITS.maxVideoBytes) fail(413, "video_too_large");
      if (info.durationMs <= 0) fail(422, "media_corrupt");
      if (info.durationMs > LIMITS.maxVideoMs + LIMITS.videoToleranceMs) fail(422, "video_too_long");
    }
    items.push({ info, bytes });
  }
  return items;
}

/** Edit penuh (multipart): teks, privasi, Acak, media yang dipertahankan (`keep`) + media baru. Dipakai UI saat mengedit post. */
async function editPostWithMedia(c: AuthedCtx): Promise<Response> {
  const me = c.auth.user, id = c.params.id!;
  await rateLimit(c.env, `postedit:${me.id}`, 60, 3600_000);
  const len = Number(c.req.headers.get("content-length") ?? "0");
  if (len > LIMITS.maxRequestBytes) return fail(413, "post_too_large");
  const own = await c.env.DB.prepare("SELECT visibility, in_random FROM posts WHERE id = ? AND owner_id = ?").bind(id, me.id).first<{ visibility: string; in_random: number }>();
  if (!own) return fail(404, "not_found");
  let form: FormData;
  try { form = await c.req.formData(); } catch { return fail(400, "bad_form"); }

  const body = checkPostBody(form.get("body") ?? "");
  if (!body.ok) return fail(400, body.code);
  const vis = checkVisibility(form.get("visibility") ?? own.visibility);
  if (!vis.ok) return fail(400, vis.code);
  const irRaw = form.get("inRandom");
  const inRandom = irRaw === null ? !!own.in_random : irRaw === "1" || irRaw === "true";

  type Row = { id: string; kind: Kind; object_key: string };
  const existing = (await c.env.DB.prepare("SELECT id, kind, object_key FROM post_media WHERE post_id = ? ORDER BY position").bind(id).all<Row>()).results;
  const keepIds = new Set(String(form.get("keep") ?? "").split(",").filter(Boolean));
  const kept = existing.filter((m) => keepIds.has(m.id));
  const dropped = existing.filter((m) => !keepIds.has(m.id));
  const have: Record<Kind, number> = { photo: 0, audio: 0, video: 0 };
  for (const m of kept) have[m.kind]++;

  const items = await readMediaItems(form, have);
  if (!body.value && !kept.length && !items.length) return fail(400, "post_empty");

  const order = { video: 0, photo: 1, audio: 2 } as const;
  const rank = (k: Kind) => order[k];
  type Final = { id: string; kind: Kind; isNew: boolean; key: string; info?: MediaInfo; bytes?: Uint8Array };
  const finals: Final[] = [
    ...kept.map((m): Final => ({ id: m.id, kind: m.kind, isNew: false, key: m.object_key })),
    ...items.map((it): Final => { const mid = newId(); return { id: mid, kind: it.info.kind as Kind, isNew: true, key: `media/${id}/${mid}.${extOf(it.info.mime)}`, info: it.info, bytes: it.bytes }; }),
  ].sort((a, b) => rank(a.kind) - rank(b.kind));

  const uploaded: string[] = [];
  try {
    for (const f of finals) if (f.isNew) { await c.env.MEDIA_BUCKET.put(f.key, f.bytes!, { httpMetadata: { contentType: f.info!.mime } }); uploaded.push(f.key); }
    const stmts = [
      ...dropped.map((m) => c.env.DB.prepare("DELETE FROM post_media WHERE id = ? AND post_id = ?").bind(m.id, id)),
      c.env.DB.prepare("UPDATE posts SET body = ?, visibility = ?, in_random = ?, has_media = ? WHERE id = ?").bind(body.value, vis.value, inRandom ? 1 : 0, finals.length ? 1 : 0, id),
      ...finals.map((f, i) => f.isNew
        ? c.env.DB.prepare("INSERT INTO post_media (id, post_id, position, kind, object_key, mime, size_bytes, duration_ms, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(f.id, id, i, f.kind, f.key, f.info!.mime, f.bytes!.length, f.info!.durationMs, f.info!.width, f.info!.height)
        : c.env.DB.prepare("UPDATE post_media SET position = ? WHERE id = ? AND post_id = ?").bind(i, f.id, id)),
    ];
    await c.env.DB.batch(stmts);
  } catch (e) {
    if (uploaded.length) await c.env.MEDIA_BUCKET.delete(uploaded);
    throw e;
  }
  if (dropped.length) await c.env.MEDIA_BUCKET.delete(dropped.map((m) => m.object_key));
  const row = (await getPost(c.env, me.id, id))!;
  return json({ post: (await toPostDTOs(c.env, [row], me.id))[0] });
}

const extOf = (mime: string) => mime.split("/")[1]!.replace("quicktime", "mov").replace("mpeg", "mp3");

export function postRoutes(r: Router) {
  r.add("GET", "/api/config", "none", () => json({
    maxVideoMs: LIMITS.maxVideoMs, maxPhotos: LIMITS.maxPhotos,
    maxVideoBytes: LIMITS.maxVideoBytes, maxPhotoBytes: LIMITS.maxPhotoBytes, maxRequestBytes: LIMITS.maxRequestBytes,
    maxAvatarBytes: LIMITS.maxAvatarBytes, postMax: LIMITS.postMax, commentMax: LIMITS.commentMax, minAge: LIMITS.minAge,
    relationKinds: RELATION_KINDS,
  }));

  // ---- Feed: terbaru → terlama (timestamp server + ID stabil). scope=following → hanya yang diikuti, berhubungan, dan diri sendiri.
  r.add("GET", "/api/feed", "optional", async (c) => {
    const viewer = c.auth?.user.id ?? null;
    const cur = decodeCursor(c.url.searchParams.get("cursor"));
    const q = postSelect(viewer);
    let sql = q.sql;
    const params = [...q.params];
    if (c.url.searchParams.get("scope") === "following") {
      if (!viewer) return fail(401, "unauthorized");
      sql += ` AND (p.owner_id = ? OR p.owner_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
               OR p.owner_id IN (SELECT CASE WHEN requester_id = ? THEN target_id ELSE requester_id END FROM relationships
                                 WHERE status = 'accepted' AND (requester_id = ? OR target_id = ?)))`;
      params.push(viewer, viewer, viewer, viewer, viewer);
    }
    if (cur) { sql += " AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))"; params.push(cur.ts, cur.ts, cur.id); }
    sql += " ORDER BY p.created_at DESC, p.id DESC LIMIT ?";
    params.push(PAGE + 1);
    const rows = await c.env.DB.prepare(sql).bind(...params).all<PostRow>();
    return json(await pageOf(c.env, rows.results, viewer));
  });

  // ---- Acak: hanya post bermedia (audio/foto/video) yang ikut Acak; teks tidak. Undian seragam, sumber kriptografis.
  r.add("POST", "/api/random", "optional", async (c) => {
    const viewer = c.auth?.user.id ?? null;
    await rateLimit(c.env, `random:${viewer ?? c.ip}`, 120, 60_000);
    const count = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM posts p WHERE p.in_random = 1 AND p.has_media = 1 AND ${VIS_SQL}`,
    ).bind(...visParams(viewer)).first<{ n: number }>();
    const n = count?.n ?? 0;
    if (n === 0) return fail(404, "no_media");
    const k = secureRandomInt(n);
    const q = postSelect(viewer);
    const row = await c.env.DB.prepare(`${q.sql} AND p.in_random = 1 AND p.has_media = 1 ORDER BY p.id LIMIT 1 OFFSET ?`)
      .bind(...q.params, k).first<PostRow>();
    if (!row) return fail(404, "no_media");
    return json({ post: (await toPostDTOs(c.env, [row], viewer))[0] });
  });

  // ---- Buat post: teks dan/atau media (multipart). Semua pemeriksaan dilakukan di server.
  r.add("POST", "/api/posts", "required", async (c) => {
    const me = c.auth.user;
    await rateLimit(c.env, `post:${me.id}`, 40, 3600_000);
    const len = Number(c.req.headers.get("content-length") ?? "0");
    if (len > LIMITS.maxRequestBytes) return fail(413, "post_too_large"); // plafon teknis platform, bukan batas audio
    let form: FormData;
    try { form = await c.req.formData(); } catch { return fail(400, "bad_form"); }

    const body = checkPostBody(form.get("body") ?? "");
    if (!body.ok) return fail(400, body.code);
    const vis = checkVisibility(form.get("visibility") ?? me.default_visibility);
    if (!vis.ok) return fail(400, vis.code);
    const inRandomRaw = form.get("inRandom");
    const inRandom = inRandomRaw === null ? !!me.default_in_random : inRandomRaw === "1" || inRandomRaw === "true";

    const files = form.getAll("media").filter((x): x is File => typeof x !== "string");
    if (files.length > LIMITS.maxPhotos + 2) return fail(400, "too_many_files");
    const hints = String(form.get("durations") ?? "").split(",").map((x) => Math.max(0, Math.min(120_000, Number(x) || 0)));

    const items: { info: MediaInfo; bytes: Uint8Array }[] = [];
    let photos = 0, audios = 0, videos = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (f.size > LIMITS.maxRequestBytes) return fail(413, "post_too_large");
      const bytes = new Uint8Array(await f.arrayBuffer());
      let info: MediaInfo;
      try { info = inspectMedia(bytes, hints[i] ?? 0); } catch (e) {
        if (e instanceof MediaRejected) return fail(415, e.code);
        throw e;
      }
      if (info.kind === "photo") {
        if (++photos > LIMITS.maxPhotos) return fail(400, "too_many_photos");
        if (bytes.length > LIMITS.maxPhotoBytes) return fail(413, "photo_too_large");
        if (info.width * info.height > LIMITS.maxPhotoPixels) return fail(422, "photo_too_big_dims");
      } else if (info.kind === "audio") {
        if (++audios > 1) return fail(400, "too_many_audio");
        // Audio: tanpa batas durasi/ukuran. Durasi 0 (tak terbaca dari header) tetap diterima.
        if (info.silent === true) return fail(422, "audio_silent");
      } else {
        if (++videos > 1) return fail(400, "too_many_video");
        if (bytes.length > LIMITS.maxVideoBytes) return fail(413, "video_too_large");
        if (info.durationMs <= 0) return fail(422, "media_corrupt");
        if (info.durationMs > LIMITS.maxVideoMs + LIMITS.videoToleranceMs) return fail(422, "video_too_long");
      }
      items.push({ info, bytes });
    }
    if (!body.value && !items.length) return fail(400, "post_empty");
    // Urutan tampilan tetap: video, foto, audio.
    const order = { video: 0, photo: 1, audio: 2 } as const;
    items.sort((a, b) => order[a.info.kind] - order[b.info.kind]);

    const postId = newId();
    const keys: string[] = [];
    const stmts = [c.env.DB.prepare(
      "INSERT INTO posts (id, owner_id, body, visibility, in_random, has_media, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(postId, me.id, body.value, vis.value, inRandom ? 1 : 0, items.length ? 1 : 0, Date.now())];
    try {
      for (let i = 0; i < items.length; i++) {
        const { info, bytes } = items[i]!;
        const mid = newId();
        const key = `media/${postId}/${mid}.${extOf(info.mime)}`;
        await c.env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: info.mime } });
        keys.push(key);
        stmts.push(c.env.DB.prepare(
          "INSERT INTO post_media (id, post_id, position, kind, object_key, mime, size_bytes, duration_ms, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(mid, postId, i, info.kind, key, info.mime, bytes.length, info.durationMs, info.width, info.height));
      }
      await c.env.DB.batch(stmts);
    } catch (e) {
      if (keys.length) await c.env.MEDIA_BUCKET.delete(keys);
      throw e;
    }
    const row = (await getPost(c.env, me.id, postId))!;
    return json({ post: (await toPostDTOs(c.env, [row], me.id))[0] }, 201);
  });

  r.add("GET", "/api/posts/:id", "optional", async (c) => {
    const viewer = c.auth?.user.id ?? null;
    const row = await getPost(c.env, viewer, c.params.id!);
    if (!row) return fail(404, "not_found");
    return json({ post: (await toPostDTOs(c.env, [row], viewer))[0] });
  });

  r.add("PATCH", "/api/posts/:id", "required", async (c) => {
    if ((c.req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) return editPostWithMedia(c);
    const b = await readJson(c.req);
    const own = await c.env.DB.prepare("SELECT 1 AS x FROM posts WHERE id = ? AND owner_id = ?").bind(c.params.id!, c.auth.user.id).first();
    if (!own) return fail(404, "not_found");
    const sets: string[] = []; const vals: unknown[] = [];
    if ("visibility" in b) { const v = checkVisibility(b.visibility); if (!v.ok) return fail(400, v.code); sets.push("visibility = ?"); vals.push(v.value as Visibility); }
    if ("inRandom" in b) { sets.push("in_random = ?"); vals.push(b.inRandom === true ? 1 : 0); }
    if ("body" in b) {
      const v = checkPostBody(b.body); if (!v.ok) return fail(400, v.code);
      const m = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM post_media WHERE post_id = ?").bind(c.params.id!).first<{ n: number }>();
      if (!v.value && !(m?.n)) return fail(400, "post_empty");
      sets.push("body = ?"); vals.push(v.value);
    }
    if (sets.length) await c.env.DB.prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, c.params.id!).run();
    const row = (await getPost(c.env, c.auth.user.id, c.params.id!))!;
    return json({ post: (await toPostDTOs(c.env, [row], c.auth.user.id))[0] });
  });

  r.add("DELETE", "/api/posts/:id", "required", async (c) => {
    const own = await c.env.DB.prepare("SELECT 1 AS x FROM posts WHERE id = ? AND owner_id = ?").bind(c.params.id!, c.auth.user.id).first();
    if (!own) return fail(404, "not_found");
    const keys = (await c.env.DB.prepare("SELECT object_key FROM post_media WHERE post_id = ?").bind(c.params.id!).all<{ object_key: string }>())
      .results.map((x) => x.object_key);
    await c.env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(c.params.id!).run();
    if (keys.length) await c.env.MEDIA_BUCKET.delete(keys);
    return json({ ok: true });
  });

  // ---- Berkas media (URL bertanda tangan, mendukung Range agar video/audio bisa diputar & di-seek di semua perangkat, termasuk iOS).
  r.add("GET", "/api/media/:id", "none", async (c) => {
    const id = c.params.id!;
    if (!(await verifyMediaToken(c.env, id, c.url.searchParams.get("t")))) return fail(403, "forbidden");
    const m = await c.env.DB.prepare("SELECT object_key, mime, size_bytes FROM post_media WHERE id = ?").bind(id).first<{ object_key: string; mime: string; size_bytes: number }>();
    if (!m) return fail(404, "not_found");
    const size = m.size_bytes;
    const base: Record<string, string> = {
      "content-type": m.mime, "accept-ranges": "bytes", "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600", "cross-origin-resource-policy": "cross-origin",
      "content-security-policy": "default-src 'none'; sandbox",
    };
    const range = c.req.headers.get("range");
    let start = 0, end = size - 1, partial = false;
    if (range) {
      const rm = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!rm || (rm[1] === "" && rm[2] === "")) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
      if (rm[1] === "") { start = Math.max(0, size - Number(rm[2])); }
      else { start = Number(rm[1]); if (rm[2] !== "") end = Math.min(size - 1, Number(rm[2])); }
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
      partial = true;
    }
    const obj = await c.env.MEDIA_BUCKET.get(m.object_key, partial ? { range: { offset: start, length: end - start + 1 } } : undefined);
    if (!obj) return fail(404, "not_found");
    const headers: Record<string, string> = { ...base, "content-length": String(end - start + 1) };
    if (partial) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    return new Response(c.req.method === "HEAD" ? null : (obj as { body: ReadableStream }).body, { status: partial ? 206 : 200, headers });
  });

  // ---- Penayangan: klien melapor setelah media benar-benar tampil/terputar. Pemilik tidak dihitung.
  r.add("POST", "/api/posts/:id/view", "optional", async (c) => {
    const viewer = c.auth?.user.id ?? null;
    const row = await getPost(c.env, viewer, c.params.id!);
    if (!row) return fail(404, "not_found");
    if (viewer === row.owner_id) return json({ counted: false });
    const key = viewer ? `u:${viewer}` : `a:${await sha256Hex(`${c.ip}|${c.req.headers.get("user-agent") ?? ""}|${c.env.MEDIA_SECRET ?? ""}`)}`;
    const now = Date.now();
    const prev = await c.env.DB.prepare("SELECT last_at FROM view_dedupe WHERE post_id = ? AND viewer_key = ?").bind(row.id, key).first<{ last_at: number }>();
    if (prev && now - prev.last_at < LIMITS.viewDedupeMs) return json({ counted: false });
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR REPLACE INTO view_dedupe (post_id, viewer_key, last_at) VALUES (?, ?, ?)").bind(row.id, key, now),
      c.env.DB.prepare("UPDATE posts SET view_count = view_count + 1 WHERE id = ?").bind(row.id),
    ]);
    return json({ counted: true });
  });

  // ---- Rating bintang
  r.add("PUT", "/api/posts/:id/rating", "required", async (c) => {
    const b = await readJson(c.req);
    const s = checkStars(b.stars);
    if (!s.ok) return fail(400, s.code);
    await rateLimit(c.env, `rate:${c.auth.user.id}`, 200, 3600_000);
    if (!(await getPost(c.env, c.auth.user.id, c.params.id!))) return fail(404, "not_found");
    await c.env.DB.prepare(
      "INSERT INTO ratings (post_id, user_id, stars, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (post_id, user_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at",
    ).bind(c.params.id!, c.auth.user.id, s.value, Date.now()).run();
    return json({ post: (await toPostDTOs(c.env, [(await getPost(c.env, c.auth.user.id, c.params.id!))!], c.auth.user.id))[0] });
  });
  r.add("DELETE", "/api/posts/:id/rating", "required", async (c) => {
    await c.env.DB.prepare("DELETE FROM ratings WHERE post_id = ? AND user_id = ?").bind(c.params.id!, c.auth.user.id).run();
    const row = await getPost(c.env, c.auth.user.id, c.params.id!);
    return row ? json({ post: (await toPostDTOs(c.env, [row], c.auth.user.id))[0] }) : fail(404, "not_found");
  });

  // ---- Simpan
  r.add("PUT", "/api/posts/:id/save", "required", async (c) => {
    if (!(await getPost(c.env, c.auth.user.id, c.params.id!))) return fail(404, "not_found");
    await c.env.DB.prepare("INSERT OR IGNORE INTO saves (user_id, post_id, created_at) VALUES (?, ?, ?)").bind(c.auth.user.id, c.params.id!, Date.now()).run();
    return json({ saved: true });
  });
  r.add("DELETE", "/api/posts/:id/save", "required", async (c) => {
    await c.env.DB.prepare("DELETE FROM saves WHERE user_id = ? AND post_id = ?").bind(c.auth.user.id, c.params.id!).run();
    return json({ saved: false });
  });

  // ---- Komentar (terlihat hanya bila posnya terlihat)
  r.add("GET", "/api/posts/:id/comments", "optional", async (c) => {
    const viewer = c.auth?.user.id ?? null;
    if (!(await getPost(c.env, viewer, c.params.id!))) return fail(404, "not_found");
    const cur = decodeCursor(c.url.searchParams.get("cursor"));
    let sql = `SELECT cm.id, cm.parent_id, cm.body, cm.created_at, u.id AS uid, u.username, u.display_name, u.avatar_version
               FROM comments cm JOIN users u ON u.id = cm.user_id WHERE cm.post_id = ?`;
    const params: unknown[] = [c.params.id!];
    if (cur) { sql += " AND (cm.created_at < ? OR (cm.created_at = ? AND cm.id < ?))"; params.push(cur.ts, cur.ts, cur.id); }
    sql += " ORDER BY cm.created_at DESC, cm.id DESC LIMIT ?";
    params.push(PAGE + 1);
    type CRow = { id: string; parent_id: string | null; body: string; created_at: number; uid: string; username: string; display_name: string; avatar_version: number };
    const rows = (await c.env.DB.prepare(sql).bind(...params).all<CRow>()).results;
    const last = rows[PAGE - 1];
    return json({
      items: rows.slice(0, PAGE).map((x) => ({
        id: x.id, parentId: x.parent_id, body: x.body, createdAt: x.created_at, mine: viewer === x.uid,
        author: toSummary({ id: x.uid, username: x.username, display_name: x.display_name, avatar_version: x.avatar_version }),
      })),
      nextCursor: rows.length > PAGE && last ? encodeCursor(last.created_at, last.id) : null,
    });
  });

  r.add("POST", "/api/posts/:id/comments", "required", async (c) => {
    const b = await readJson(c.req);
    const body = checkComment(b.body);
    if (!body.ok) return fail(400, body.code);
    await rateLimit(c.env, `comment:${c.auth.user.id}`, 60, 3600_000);
    const post = await getPost(c.env, c.auth.user.id, c.params.id!);
    if (!post) return fail(404, "not_found");
    let parent: { id: string; user_id: string; parent_id: string | null } | null = null;
    if (typeof b.parentId === "string") {
      parent = await c.env.DB.prepare("SELECT id, user_id, parent_id FROM comments WHERE id = ? AND post_id = ?").bind(b.parentId, post.id).first();
      if (!parent) return fail(404, "not_found");
    }
    const parentId = parent ? (parent.parent_id ?? parent.id) : null; // satu tingkat balasan
    const id = newId(); const now = Date.now();
    await c.env.DB.prepare("INSERT INTO comments (id, post_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, post.id, c.auth.user.id, parentId, body.value, now).run();
    if (parent) await notify(c.env, { to: parent.user_id, type: "reply", actor: c.auth.user, postId: post.id, commentId: id });
    if (!parent || parent.user_id !== post.owner_id) await notify(c.env, { to: post.owner_id, type: "comment", actor: c.auth.user, postId: post.id, commentId: id });
    return json({ comment: { id, parentId, body: body.value, createdAt: now, mine: true, author: toSummary(c.auth.user) } }, 201);
  });

  r.add("DELETE", "/api/comments/:id", "required", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT cm.id, cm.user_id, p.owner_id FROM comments cm JOIN posts p ON p.id = cm.post_id WHERE cm.id = ?",
    ).bind(c.params.id!).first<{ id: string; user_id: string; owner_id: string }>();
    if (!row) return fail(404, "not_found");
    if (row.user_id !== c.auth.user.id && row.owner_id !== c.auth.user.id) return fail(403, "forbidden");
    await c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(row.id).run();
    return json({ ok: true });
  });

  // ---- Laporan
  r.add("POST", "/api/reports", "required", async (c) => {
    const b = await readJson(c.req);
    await rateLimit(c.env, `report:${c.auth.user.id}`, 20, 3600_000);
    const type = b.targetType, id = b.targetId;
    const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
    if (!reason) return fail(400, "reason_required");
    if (!["post", "comment", "user"].includes(String(type)) || typeof id !== "string" || id.length > 64) return fail(400, "bad_request");
    await c.env.DB.prepare("INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId(), c.auth.user.id, type, id, reason, Date.now()).run();
    return json({ ok: true }, 201);
  });
}
