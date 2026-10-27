// Pintu ke Neon: HANYA memanggil fungsi api_* yang terdaftar di bawah (nama & tipe tetap → tidak ada SQL dinamis dari masukan).
import { neon } from "@neondatabase/serverless";
import { hex, hmac } from "./crypto";
import { HttpError } from "./http";

export interface NeonEnv { NEON_DATABASE_URL: string; IP_HASH_SALT: string }

const SIG: Record<string, string> = {
  api_feed: "uuid,timestamptz,uuid,int", api_posts_by_ids: "uuid,uuid[]", api_user_posts: "uuid,text,timestamptz,uuid,int", api_random: "uuid,int", api_saved: "uuid,int",
  api_search_posts: "uuid,text", api_search_users: "uuid,text",
  api_create_post: "uuid,uuid,text,jsonb,text,boolean", api_edit_post: "uuid,uuid,jsonb", api_delete_post: "uuid,uuid", api_set_star: "uuid,uuid,boolean", api_set_save: "uuid,uuid,boolean",
  api_rate: "uuid,uuid,int", api_view: "uuid,uuid",
  api_comments: "uuid,uuid", api_add_comment: "uuid,uuid,uuid,uuid,text", api_edit_comment: "uuid,uuid,text", api_delete_comment: "uuid,uuid", api_like_comment: "uuid,uuid,boolean",
  api_profile: "uuid,text", api_follow: "uuid,text,boolean", api_follow_list: "uuid,text,text,timestamptz,int", api_block: "uuid,text,boolean", api_blocked: "uuid",
  api_request_relation: "uuid,text,text", api_my_relations: "uuid", api_approve_relation: "uuid,uuid", api_remove_relation: "uuid,uuid", api_user_relations: "uuid,text",
  api_create_profile: "uuid,text,text,date", api_me: "uuid", api_update_me: "uuid,jsonb", api_set_avatar: "uuid,bigint", api_delete_me: "uuid",
  api_users_lite: "uuid[]", api_media_visible: "uuid,text[]", api_fanout_targets: "uuid,int", api_report: "uuid,uuid,text,text", api_audit: "text,uuid,text,text,int,jsonb", api_purge: "",
};
export type NeonFn = keyof typeof SIG;

const CODES: Record<string, number> = { unauthorized: 401, banned: 403, forbidden: 403, not_found: 404, conflict: 409, invalid: 422, rate_limited: 429 };

export async function nq(env: NeonEnv, fn: string, args: unknown[]): Promise<any[]> {
  const sig = SIG[fn]; if (sig === undefined) throw new Error("fn_not_allowed");
  const types = sig ? sig.split(",") : [];
  if (types.length !== args.length) throw new Error("arity");
  const text = `select * from public.${fn}(${types.map((t, i) => `$${i + 1}::${t}`).join(",")})`;
  try { return (await neon(env.NEON_DATABASE_URL).query(text, args.map((a, i) => (types[i] === "jsonb" && a !== null && typeof a !== "string" ? JSON.stringify(a) : a)))) as any[]; }
  catch (e) {
    const m = String((e as Error).message ?? "").trim();
    const code = Object.keys(CODES).find((k) => m === k || m.endsWith(": " + k) || m.includes(`ERROR: ${k}`));
    if (code) throw new HttpError(CODES[code], code);
    console.error("neon", fn, m.slice(0, 160));
    throw new HttpError(502, "upstream");
  }
}
/** Nilai tunggal dari fungsi yang mengembalikan skalar (uuid / boolean / jsonb / text[]). */
export async function nv<T = any>(env: NeonEnv, fn: string, args: unknown[]): Promise<T> { const r = await nq(env, fn, args); return (r.length ? (Object.values(r[0])[0] as T) : (null as T)); }

export async function hashIp(env: NeonEnv, ip: string): Promise<string> { return hex((await hmac(env.IP_HASH_SALT, ip)).slice(0, 16)); }
export function audit(env: NeonEnv, ctx: ExecutionContext, e: { kind: string; userId?: string | null; ip: string; route: string; status: number; detail?: Record<string, unknown> }) {
  ctx.waitUntil((async () => { try { await nq(env, "api_audit", [e.kind, e.userId ?? null, await hashIp(env, e.ip), e.route, e.status, e.detail ?? {}]); } catch { /* audit best-effort */ } })());
}
