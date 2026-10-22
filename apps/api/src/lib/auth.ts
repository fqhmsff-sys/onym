import { LIMITS } from "@onym/shared";
import type { Env } from "../env";
import { newId, randomToken, sha256Hex } from "./crypto";

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  password_hash: string;
  birth_date: string;
  birth_date_public: number;
  default_visibility: string;
  default_in_random: number;
  avatar_version: number;
  lang: string;
  theme: string;
  notif_follow: number;
  notif_comment: number;
  notif_reply: number;
  notif_relation: number;
  created_at: number;
}

export interface Auth {
  user: UserRow;
  sessionId: string;
  viaCookie: boolean;
}

export const COOKIE_NAME = "hh_session";

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function authenticate(req: Request, env: Env): Promise<Auth | null> {
  let token: string | null = null;
  let viaCookie = false;
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) token = h.slice(7).trim();
  else {
    token = readCookie(req, COOKIE_NAME);
    viaCookie = token !== null;
  }
  if (!token || token.length < 20 || token.length > 100) return null;

  const hash = await sha256Hex(token);
  const now = Date.now();
  const s = await env.DB.prepare(
    "SELECT s.id AS sid, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
  )
    .bind(hash, now)
    .first<UserRow & { sid: string; last_seen_at: number }>();
  if (!s) return null;
  if (now - s.last_seen_at > 3600_000) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .bind(now, now + LIMITS.sessionTtlMs, s.sid)
      .run();
  }
  const { sid, last_seen_at: _l, ...user } = s;
  return { user: user as UserRow, sessionId: sid, viaCookie };
}

export function deviceLabel(req: Request): string {
  const ua = req.headers.get("user-agent") ?? "";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Perangkat";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /okhttp|Expo|Onym/i.test(ua) ? "Aplikasi" : "Peramban";
  return `${br} · ${os}`;
}

export async function createSession(env: Env, userId: string, req: Request): Promise<{ token: string; id: string }> {
  const token = randomToken(32);
  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, userId, await sha256Hex(token), deviceLabel(req), now, now, now + LIMITS.sessionTtlMs)
    .run();
  return { token, id };
}

export function sessionCookie(token: string | null, secure: boolean): string {
  const base = `${COOKIE_NAME}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return token ? `${base}; Max-Age=${Math.floor(LIMITS.sessionTtlMs / 1000)}` : `${base}; Max-Age=0`;
}
