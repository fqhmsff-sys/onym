import { LIMITS, checkRelationKind, checkUsername } from "@onym/shared";
import type { UserRow } from "../lib/auth";
import { sessionCookie } from "../lib/auth";
import { verifyPassword, newId } from "../lib/crypto";
import { decodeCursor, encodeCursor, escapeLike, fail, json, rateLimit, readJson } from "../lib/http";
import { inspectMedia, MediaRejected } from "../lib/mediainfo";
import { notify, pairKey, postSelect, toPostDTOs, toSummary, VIS_SQL, visParams, type NotificationType, type PostRow } from "../lib/queries";
import type { Ctx, Router } from "../lib/router";
import { pageOf } from "./posts";

const PAGE = LIMITS.pageSize;
type Sum = Pick<UserRow, "id" | "username" | "display_name" | "avatar_version">;

async function findUser(c: Ctx, username: string): Promise<UserRow> {
  const u = checkUsername(username);
  const row = u.ok ? await c.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(u.value).first<UserRow>() : null;
  return row ?? fail(404, "not_found");
}

interface RelRow { pair_key: string; requester_id: string; target_id: string; kind: string; status: "pending" | "accepted"; created_at: number; accepted_at: number | null }
async function relBetween(c: Ctx, a: string, b: string): Promise<RelRow | null> {
  return c.env.DB.prepare("SELECT * FROM relationships WHERE pair_key = ?").bind(pairKey(a, b)).first<RelRow>();
}

export function socialRoutes(r: Router) {
  // ---------------------------------------------------------------- Profil
  r.add("GET", "/api/users/:username", "optional", async (c) => {
    const t = await findUser(c, c.params.username!);
    const me = c.auth?.user.id ?? null;
    const viewer = me ?? "";
    const posts = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE p.owner_id = ? AND ${VIS_SQL}`)
      .bind(t.id, ...visParams(me)).first<{ n: number }>();
    const counts = await c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
              (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
              (SELECT COUNT(*) FROM relationships WHERE status = 'accepted' AND (requester_id = ? OR target_id = ?)) AS relations,
              EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS i_follow,
              EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS follows_me`,
    ).bind(t.id, t.id, t.id, t.id, viewer, t.id, t.id, viewer).first<{ followers: number; following: number; relations: number; i_follow: number; follows_me: number }>();
    let relation: null | { kind: string; status: string; direction: "outgoing" | "incoming" | "mutual" } = null;
    if (me && me !== t.id) {
      const rel = await relBetween(c, me, t.id);
      if (rel) relation = { kind: rel.kind, status: rel.status, direction: rel.status === "accepted" ? "mutual" : rel.requester_id === me ? "outgoing" : "incoming" };
    }
    return json({
      profile: {
        ...toSummary(t), bio: t.bio, self: me === t.id,
        postCount: posts?.n ?? 0, followerCount: counts?.followers ?? 0, followingCount: counts?.following ?? 0, relationCount: counts?.relations ?? 0,
        following: !!counts?.i_follow, followsMe: !!counts?.follows_me, relation,
        birthDate: t.birth_date_public ? t.birth_date : null, joinedAt: t.created_at,
      },
    });
  });

  r.add("GET", "/api/users/:username/posts", "optional", async (c) => {
    const viewer = c.auth?.user.id ?? null;
    const t = await findUser(c, c.params.username!);
    const cur = decodeCursor(c.url.searchParams.get("cursor"));
    const q = postSelect(viewer);
    let sql = `${q.sql} AND p.owner_id = ?`;
    const params = [...q.params, t.id];
    if (c.url.searchParams.get("media") === "1") sql += " AND p.has_media = 1";
    if (cur) { sql += " AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))"; params.push(cur.ts, cur.ts, cur.id); }
    sql += " ORDER BY p.created_at DESC, p.id DESC LIMIT ?";
    params.push(PAGE + 1);
    const rows = await c.env.DB.prepare(sql).bind(...params).all<PostRow>();
    return json(await pageOf(c.env, rows.results, viewer));
  });

  // ---------------------------------------------------------------- Mengikuti / pengikut (satu arah, langsung aktif)
  r.add("POST", "/api/users/:username/follow", "required", async (c) => {
    await rateLimit(c.env, `follow:${c.auth.user.id}`, 120, 3600_000);
    const t = await findUser(c, c.params.username!);
    if (t.id === c.auth.user.id) return fail(400, "cannot_follow_self");
    const ins = await c.env.DB.prepare("INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)")
      .bind(c.auth.user.id, t.id, Date.now()).run();
    if (ins.meta.changes) await notify(c.env, { to: t.id, type: "follow", actor: c.auth.user });
    return json({ following: true });
  });
  r.add("DELETE", "/api/users/:username/follow", "required", async (c) => {
    const t = await findUser(c, c.params.username!);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").bind(c.auth.user.id, t.id),
      c.env.DB.prepare("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'follow'").bind(t.id, c.auth.user.id),
    ]);
    return json({ following: false });
  });

  for (const [path, mine, other] of [["followers", "followee_id", "follower_id"], ["following", "follower_id", "followee_id"]] as const) {
    r.add("GET", `/api/users/:username/${path}`, "optional", async (c) => {
      const t = await findUser(c, c.params.username!);
      const cur = decodeCursor(c.url.searchParams.get("cursor"));
      let sql = `SELECT u.id, u.username, u.display_name, u.avatar_version, f.created_at AS ts FROM follows f JOIN users u ON u.id = f.${other} WHERE f.${mine} = ?`;
      const params: unknown[] = [t.id];
      if (cur) { sql += " AND (f.created_at < ? OR (f.created_at = ? AND u.id < ?))"; params.push(cur.ts, cur.ts, cur.id); }
      sql += " ORDER BY f.created_at DESC, u.id DESC LIMIT ?";
      params.push(PAGE + 1);
      const rows = (await c.env.DB.prepare(sql).bind(...params).all<Sum & { ts: number }>()).results;
      const last = rows[PAGE - 1];
      return json({ items: rows.slice(0, PAGE).map(toSummary), nextCursor: rows.length > PAGE && last ? encodeCursor(last.ts, last.id) : null });
    });
  }

  // ---------------------------------------------------------------- Hubungan: butuh persetujuan KEDUA pihak
  // Hubungan DISETUJUI milik pengguna mana pun; bisa dilihat siapa saja
  r.add("GET", "/api/users/:username/relations", "optional", async (c) => {
    const t = await findUser(c, c.params.username!);
    const rows = (await c.env.DB.prepare(
      `SELECT rl.kind, rl.created_at, rl.accepted_at, u.id, u.username, u.display_name, u.avatar_version
       FROM relationships rl JOIN users u ON u.id = (CASE WHEN rl.requester_id = ? THEN rl.target_id ELSE rl.requester_id END)
       WHERE rl.status = 'accepted' AND (rl.requester_id = ? OR rl.target_id = ?) ORDER BY COALESCE(rl.accepted_at, rl.created_at) DESC LIMIT 500`,
    ).bind(t.id, t.id, t.id).all<Sum & { kind: string; created_at: number; accepted_at: number | null }>()).results;
    return json({ items: rows.map((x) => ({ user: toSummary(x), kind: x.kind, since: x.accepted_at ?? x.created_at })) });
  });

  r.add("GET", "/api/relations", "required", async (c) => {
    const me = c.auth.user.id;
    const rows = (await c.env.DB.prepare(
      `SELECT rl.requester_id, rl.target_id, rl.kind, rl.status, rl.created_at, rl.accepted_at,
              u.id, u.username, u.display_name, u.avatar_version
       FROM relationships rl JOIN users u ON u.id = (CASE WHEN rl.requester_id = ? THEN rl.target_id ELSE rl.requester_id END)
       WHERE rl.requester_id = ? OR rl.target_id = ? ORDER BY COALESCE(rl.accepted_at, rl.created_at) DESC LIMIT 500`,
    ).bind(me, me, me).all<Sum & { requester_id: string; kind: string; status: string; created_at: number; accepted_at: number | null }>()).results;
    const pick = (f: (x: (typeof rows)[number]) => boolean) =>
      rows.filter(f).map((x) => ({ user: toSummary(x), kind: x.kind, since: x.accepted_at ?? x.created_at }));
    return json({
      accepted: pick((x) => x.status === "accepted"),
      incoming: pick((x) => x.status === "pending" && x.requester_id !== me),
      outgoing: pick((x) => x.status === "pending" && x.requester_id === me),
    });
  });

  r.add("POST", "/api/relations", "required", async (c) => {
    const b = await readJson(c.req);
    await rateLimit(c.env, `relreq:${c.auth.user.id}`, 40, 3600_000);
    const kind = checkRelationKind(b.kind);
    if (!kind.ok) return fail(400, kind.code);
    const t = await findUser(c, String(b.username ?? ""));
    const me = c.auth.user;
    if (t.id === me.id) return fail(400, "cannot_relate_self");
    const ex = await relBetween(c, me.id, t.id);
    if (ex?.status === "accepted") return fail(409, "relation_exists");
    if (ex && ex.requester_id === t.id) return fail(409, "relation_pending_incoming"); // dia sudah meminta: terima permintaannya
    const key = pairKey(me.id, t.id);
    if (ex) await c.env.DB.prepare("UPDATE relationships SET kind = ?, created_at = ? WHERE pair_key = ?").bind(kind.value, Date.now(), key).run();
    else await c.env.DB.prepare("INSERT INTO relationships (pair_key, requester_id, target_id, kind, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").bind(key, me.id, t.id, kind.value, Date.now()).run();
    await c.env.DB.prepare("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'relation_request'").bind(t.id, me.id).run();
    await notify(c.env, { to: t.id, type: "relation_request", actor: me, kind: kind.value });
    return json({ relation: { kind: kind.value, status: "pending", direction: "outgoing" } }, 201);
  });

  r.add("POST", "/api/relations/:username/accept", "required", async (c) => {
    const t = await findUser(c, c.params.username!);
    const rel = await relBetween(c, c.auth.user.id, t.id);
    if (!rel || rel.status !== "pending" || rel.target_id !== c.auth.user.id) return fail(404, "not_found"); // hanya pihak yang diminta
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE relationships SET status = 'accepted', accepted_at = ? WHERE pair_key = ?").bind(Date.now(), rel.pair_key),
      c.env.DB.prepare("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'relation_request'").bind(c.auth.user.id, t.id),
    ]);
    await notify(c.env, { to: t.id, type: "relation_accepted", actor: c.auth.user, kind: rel.kind as never });
    return json({ relation: { kind: rel.kind, status: "accepted", direction: "mutual" } });
  });

  // Tolak (yang diminta), batalkan (peminta), atau putuskan (salah satu pihak).
  r.add("DELETE", "/api/relations/:username", "required", async (c) => {
    const t = await findUser(c, c.params.username!);
    const key = pairKey(c.auth.user.id, t.id);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM relationships WHERE pair_key = ?").bind(key),
      c.env.DB.prepare("DELETE FROM notifications WHERE type IN ('relation_request','relation_accepted') AND ((user_id = ? AND actor_id = ?) OR (user_id = ? AND actor_id = ?))")
        .bind(c.auth.user.id, t.id, t.id, c.auth.user.id),
    ]);
    return json({ relation: null });
  });

  // ---------------------------------------------------------------- Tersimpan (privat)
  r.add("GET", "/api/me/saved", "required", async (c) => {
    const viewer = c.auth.user.id;
    const cur = decodeCursor(c.url.searchParams.get("cursor"));
    const q = postSelect(viewer, "JOIN saves sv ON sv.post_id = p.id AND sv.user_id = ?", [viewer]);
    let sql = q.sql.replace("SELECT p.id,", "SELECT sv.created_at AS saved_at, p.id,");
    const params = [...q.params];
    if (cur) { sql += " AND (sv.created_at < ? OR (sv.created_at = ? AND p.id < ?))"; params.push(cur.ts, cur.ts, cur.id); }
    sql += " ORDER BY sv.created_at DESC, p.id DESC LIMIT ?";
    params.push(PAGE + 1);
    const rows = (await c.env.DB.prepare(sql).bind(...params).all<PostRow & { saved_at: number }>()).results;
    const last = rows[PAGE - 1];
    return json({ items: await toPostDTOs(c.env, rows.slice(0, PAGE), viewer), nextCursor: rows.length > PAGE && last ? encodeCursor(last.saved_at, last.id) : null });
  });

  // ---------------------------------------------------------------- Notifikasi
  r.add("GET", "/api/notifications", "required", async (c) => {
    const cur = decodeCursor(c.url.searchParams.get("cursor"));
    let sql = `SELECT n.id, n.type, n.kind, n.created_at, n.read_at, n.post_id, n.comment_id,
                 u.id AS uid, u.username, u.display_name, u.avatar_version, cm.body AS comment_body
               FROM notifications n JOIN users u ON u.id = n.actor_id LEFT JOIN comments cm ON cm.id = n.comment_id
               WHERE n.user_id = ?`;
    const params: unknown[] = [c.auth.user.id];
    if (cur) { sql += " AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))"; params.push(cur.ts, cur.ts, cur.id); }
    sql += " ORDER BY n.created_at DESC, n.id DESC LIMIT ?";
    params.push(PAGE + 1);
    type NRow = { id: string; type: NotificationType; kind: string | null; created_at: number; read_at: number | null; post_id: string | null; comment_id: string | null; uid: string; username: string; display_name: string; avatar_version: number; comment_body: string | null };
    const rows = (await c.env.DB.prepare(sql).bind(...params).all<NRow>()).results;
    // Status hubungan terkini, agar tombol Terima/Tolak hanya muncul untuk permintaan yang masih tertunda.
    const pending = new Set((await c.env.DB.prepare("SELECT requester_id FROM relationships WHERE target_id = ? AND status = 'pending'").bind(c.auth.user.id).all<{ requester_id: string }>()).results.map((x) => x.requester_id));
    const items = rows.slice(0, PAGE).map((n) => ({
      id: n.id, type: n.type, kind: n.kind, createdAt: n.created_at, read: n.read_at !== null,
      actor: toSummary({ id: n.uid, username: n.username, display_name: n.display_name, avatar_version: n.avatar_version }),
      postId: n.post_id, commentId: n.comment_id,
      commentPreview: n.comment_body ? [...n.comment_body].slice(0, 80).join("") : null,
      actionable: n.type === "relation_request" && pending.has(n.uid),
    }));
    const last = rows[PAGE - 1];
    return json({ items, nextCursor: rows.length > PAGE && last ? encodeCursor(last.created_at, last.id) : null });
  });

  r.add("POST", "/api/notifications/read", "required", async (c) => {
    await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(Date.now(), c.auth.user.id).run();
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- Pencarian: pengguna + teks post yang boleh dilihat
  r.add("GET", "/api/search", "optional", async (c) => {
    const viewer = c.auth?.user.id ?? null;
    await rateLimit(c.env, `search:${viewer ?? c.ip}`, 60, 60_000);
    const raw = (c.url.searchParams.get("q") ?? "").trim().replace(/^@/, "").slice(0, 50);
    if (raw.length < 2) return json({ users: [], posts: [] });
    const like = `%${escapeLike(raw.toLowerCase())}%`;
    const prefix = `${escapeLike(raw.toLowerCase())}%`;
    const users = await c.env.DB.prepare(
      `SELECT id, username, display_name, avatar_version FROM users
       WHERE username LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\'
       ORDER BY (username LIKE ? ESCAPE '\\') DESC, username LIMIT 15`,
    ).bind(like, like, prefix).all<Sum>();
    const q = postSelect(viewer);
    const posts = await c.env.DB.prepare(`${q.sql} AND LOWER(p.body) LIKE ? ESCAPE '\\' ORDER BY p.created_at DESC, p.id DESC LIMIT 15`)
      .bind(...q.params, like).all<PostRow>();
    return json({ users: users.results.map(toSummary), posts: await toPostDTOs(c.env, posts.results, viewer) });
  });

  // ---------------------------------------------------------------- Foto profil
  r.add("GET", "/api/avatar/:id", "none", async (c) => {
    const u = await c.env.DB.prepare("SELECT avatar_version FROM users WHERE id = ?").bind(c.params.id!).first<{ avatar_version: number }>();
    if (!u || u.avatar_version === 0) return fail(404, "not_found");
    const obj = await c.env.MEDIA_BUCKET.get(`avatars/${c.params.id}`);
    if (!obj) return fail(404, "not_found");
    const buf = new Uint8Array(await obj.arrayBuffer());
    let mime = "application/octet-stream";
    try { mime = inspectMedia(buf).mime; } catch { /* abaikan */ }
    return new Response(buf, { headers: {
      "content-type": mime, "x-content-type-options": "nosniff", "cross-origin-resource-policy": "cross-origin",
      "cache-control": c.url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "content-security-policy": "default-src 'none'; sandbox",
    } });
  });

  r.add("PUT", "/api/me/avatar", "required", async (c) => {
    await rateLimit(c.env, `avatar:${c.auth.user.id}`, 20, 3600_000);
    const len = Number(c.req.headers.get("content-length") ?? "0");
    if (len > LIMITS.maxAvatarBytes) return fail(413, "avatar_too_large");
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.length > LIMITS.maxAvatarBytes) return fail(413, "avatar_too_large");
    let info;
    try { info = inspectMedia(buf); } catch (e) { if (e instanceof MediaRejected) return fail(415, "avatar_unsupported"); throw e; }
    if (info.kind !== "photo" || info.mime === "image/gif") return fail(415, "avatar_unsupported");
    await c.env.MEDIA_BUCKET.put(`avatars/${c.auth.user.id}`, buf, { httpMetadata: { contentType: info.mime } });
    const v = Date.now();
    await c.env.DB.prepare("UPDATE users SET avatar_version = ? WHERE id = ?").bind(v, c.auth.user.id).run();
    return json({ avatarUrl: `/api/avatar/${c.auth.user.id}?v=${v}` });
  });

  r.add("DELETE", "/api/me/avatar", "required", async (c) => {
    await c.env.MEDIA_BUCKET.delete(`avatars/${c.auth.user.id}`);
    await c.env.DB.prepare("UPDATE users SET avatar_version = 0 WHERE id = ?").bind(c.auth.user.id).run();
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- Hapus akun (wajib ada di dalam aplikasi untuk Google Play / App Store)
  r.add("DELETE", "/api/me", "required", async (c) => {
    const b = await readJson(c.req);
    await rateLimit(c.env, `delacct:${c.auth.user.id}`, 5, 3600_000);
    if (typeof b.password !== "string" || !(await verifyPassword(b.password, c.auth.user.password_hash))) return fail(403, "wrong_password");
    const keys = (await c.env.DB.prepare("SELECT m.object_key FROM post_media m JOIN posts p ON p.id = m.post_id WHERE p.owner_id = ?").bind(c.auth.user.id).all<{ object_key: string }>())
      .results.map((x) => x.object_key);
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(c.auth.user.id).run(); // CASCADE membersihkan sisanya
    for (let i = 0; i < keys.length; i += 100) await c.env.MEDIA_BUCKET.delete(keys.slice(i, i + 100));
    await c.env.MEDIA_BUCKET.delete(`avatars/${c.auth.user.id}`);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(null, c.url.protocol === "https:") });
  });
}
void newId;
