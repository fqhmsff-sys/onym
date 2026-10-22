import type { Lang, Theme, Visibility, RelationKind } from "@onym/shared";
import type { Env } from "../env";
import type { UserRow } from "./auth";
import { newId } from "./crypto";
import { signedMediaUrl } from "./media";

export const avatarUrl = (id: string, version: number): string | null =>
  version > 0 ? `/api/avatar/${id}?v=${version}` : null;

export interface UserSummary { id: string; username: string; displayName: string; avatarUrl: string | null }

export const toSummary = (u: Pick<UserRow, "id" | "username" | "display_name" | "avatar_version">): UserSummary => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  avatarUrl: avatarUrl(u.id, u.avatar_version),
});

export async function toMe(env: Env, u: UserRow) {
  const c = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL) AS unread,
       (SELECT COUNT(*) FROM relationships WHERE target_id = ? AND status = 'pending') AS pending`,
  ).bind(u.id, u.id).first<{ unread: number; pending: number }>();
  return {
    ...toSummary(u),
    bio: u.bio,
    birthDate: u.birth_date,
    birthDatePublic: !!u.birth_date_public,
    defaultVisibility: u.default_visibility as Visibility,
    defaultInRandom: !!u.default_in_random,
    lang: u.lang as Lang,
    theme: u.theme as Theme,
    notifFollow: !!u.notif_follow,
    notifComment: !!u.notif_comment,
    notifReply: !!u.notif_reply,
    notifRelation: !!u.notif_relation,
    unreadNotifications: c?.unread ?? 0,
    pendingRelationRequests: c?.pending ?? 0,
  };
}

/**
 * Aturan visibilitas post — SATU-SATUNYA tempat yang menentukan siapa boleh mengakses post dan medianya.
 * Dipakai Feed, Acak, profil, pencarian, media, komentar, rating, dan simpan.
 *  - publik       : semua orang (termasuk tamu)
 *  - pengikut     : pemilik + orang yang mengikuti pemilik
 *  - hubungan     : pemilik + orang yang punya hubungan TERSETUJUI (teman/sahabat/pacar/keluarga) dengan pemilik
 * Membutuhkan alias `p` (posts). Mengikat 5 parameter: gunakan visParams(viewerId).
 */
export const VIS_SQL = `(p.owner_id = ? OR p.visibility = 'public'
  OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows vf WHERE vf.follower_id = ? AND vf.followee_id = p.owner_id))
  OR (p.visibility = 'relationship' AND EXISTS (SELECT 1 FROM relationships vr WHERE vr.status = 'accepted'
        AND vr.pair_key = (CASE WHEN ? < p.owner_id THEN ? || ':' || p.owner_id ELSE p.owner_id || ':' || ? END))))`;
export const visParams = (v: string | null): string[] => { const x = v ?? ""; return [x, x, x, x, x]; };

export const pairKey = (a: string, b: string): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export interface PostRow {
  id: string; owner_id: string; body: string; visibility: Visibility; in_random: number; has_media: number;
  view_count: number; created_at: number;
  username: string; display_name: string; avatar_version: number;
  avg_rating: number | null; rating_count: number; my_rating: number | null; comment_count: number; saved: number;
}
interface MediaRow {
  id: string; post_id: string; position: number; kind: string; mime: string; size_bytes: number;
  duration_ms: number; width: number; height: number;
}

/** SELECT dasar post terlihat. Parameter: [viewer (my_rating), viewer (saved), ...visParams]. */
export function postSelect(viewerId: string | null, join = "", joinParams: unknown[] = []) {
  const v = viewerId ?? "";
  return {
    sql: `SELECT p.id, p.owner_id, p.body, p.visibility, p.in_random, p.has_media, p.view_count, p.created_at,
            o.username, o.display_name, o.avatar_version,
            (SELECT AVG(stars) FROM ratings WHERE post_id = p.id) AS avg_rating,
            (SELECT COUNT(*) FROM ratings WHERE post_id = p.id) AS rating_count,
            (SELECT stars FROM ratings WHERE post_id = p.id AND user_id = ?) AS my_rating,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
            EXISTS (SELECT 1 FROM saves WHERE post_id = p.id AND user_id = ?) AS saved
          FROM posts p JOIN users o ON o.id = p.owner_id ${join}
          WHERE ${VIS_SQL}`,
    params: [v, v, ...joinParams, ...visParams(viewerId)] as unknown[],
  };
}

export async function toPostDTOs(env: Env, rows: PostRow[], viewerId: string | null) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const media = (await env.DB.prepare(
    `SELECT id, post_id, position, kind, mime, size_bytes, duration_ms, width, height FROM post_media
     WHERE post_id IN (${ids.map(() => "?").join(",")}) ORDER BY post_id, position`,
  ).bind(...ids).all<MediaRow>()).results;
  const byPost = new Map<string, MediaRow[]>();
  for (const m of media) { const l = byPost.get(m.post_id); if (l) l.push(m); else byPost.set(m.post_id, [m]); }
  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    author: toSummary({ id: r.owner_id, username: r.username, display_name: r.display_name, avatar_version: r.avatar_version }),
    body: r.body,
    visibility: r.visibility,
    createdAt: r.created_at,
    media: await Promise.all((byPost.get(r.id) ?? []).map(async (m) => ({
      id: m.id, kind: m.kind as "audio" | "photo" | "video", mime: m.mime, durationMs: m.duration_ms,
      width: m.width, height: m.height, url: await signedMediaUrl(env, m.id),
    }))),
    viewCount: r.view_count,
    rating: { avg: r.avg_rating === null ? null : Math.round(r.avg_rating * 10) / 10, count: r.rating_count, mine: r.my_rating },
    commentCount: r.comment_count,
    saved: !!r.saved,
    mine: viewerId === r.owner_id,
    inRandom: viewerId === r.owner_id ? !!r.in_random : null,
  })));
}

export async function getPost(env: Env, viewerId: string | null, id: string): Promise<PostRow | null> {
  const q = postSelect(viewerId);
  return env.DB.prepare(`${q.sql} AND p.id = ?`).bind(...q.params, id).first<PostRow>();
}

export type NotificationType = "follow" | "relation_request" | "relation_accepted" | "comment" | "reply";

export async function notify(
  env: Env,
  n: { to: string; type: NotificationType; actor: UserRow; postId?: string | null; commentId?: string | null; kind?: RelationKind | null },
): Promise<void> {
  if (n.to === n.actor.id) return;
  const rcpt = await env.DB.prepare("SELECT notif_follow, notif_comment, notif_reply, notif_relation FROM users WHERE id = ?")
    .bind(n.to).first<{ notif_follow: number; notif_comment: number; notif_reply: number; notif_relation: number }>();
  if (!rcpt) return;
  const enabled =
    n.type === "follow" ? rcpt.notif_follow
    : n.type === "comment" ? rcpt.notif_comment
    : n.type === "reply" ? rcpt.notif_reply
    : rcpt.notif_relation;
  if (!enabled) return;
  await env.DB.prepare(
    "INSERT INTO notifications (id, user_id, type, actor_id, post_id, comment_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(newId(), n.to, n.type, n.actor.id, n.postId ?? null, n.commentId ?? null, n.kind ?? null, Date.now()).run();
}
