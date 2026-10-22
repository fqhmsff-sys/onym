import {
  LANGS, THEMES, checkBio, checkBirthDate, checkDisplayName, checkPassword, checkUsername, checkVisibility,
} from "@onym/shared";
import { createSession, sessionCookie, type UserRow } from "../lib/auth";
import {
  hashPassword, newId, newRecoveryCode, normalizeRecoveryCode, sha256Hex, verifyPassword,
} from "../lib/crypto";
import { clearRateLimit, fail, json, rateLimit, readJson } from "../lib/http";
import { toMe } from "../lib/queries";
import type { AuthedCtx, Ctx, Router } from "../lib/router";
import type { Env } from "../env";

const isSecure = (url: URL) => url.protocol === "https:";

async function makeRecoveryCodes(env: Env, userId: string): Promise<string[]> {
  const codes = Array.from({ length: 8 }, newRecoveryCode);
  const stmts = [env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId)];
  for (const c of codes) {
    stmts.push(
      env.DB.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)")
        .bind(userId, await sha256Hex(normalizeRecoveryCode(c))),
    );
  }
  await env.DB.batch(stmts);
  return codes;
}

let dummyHash: Promise<string> | null = null;

async function authResponse(c: Ctx, user: UserRow, extra: Record<string, unknown> = {}, status = 200): Promise<Response> {
  const { token } = await createSession(c.env, user.id, c.req);
  const body = { token, me: await toMe(c.env, user), ...extra };
  return json(body, status, { "set-cookie": sessionCookie(token, isSecure(c.url)) });
}

export function authRoutes(r: Router) {
  r.add("GET", "/api/username-available", "none", async (c) => {
    await rateLimit(c.env, `uname:${c.ip}`, 60, 60_000);
    const u = checkUsername(c.url.searchParams.get("u"));
    if (!u.ok) return json({ available: false, code: u.code });
    const row = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE username = ?").bind(u.value).first();
    return json({ available: !row });
  });

  r.add("POST", "/api/auth/register", "none", async (c) => {
    await rateLimit(c.env, `reg:${c.ip}`, 10, 3600_000);
    const b = await readJson(c.req);
    const name = checkDisplayName(b.displayName);
    if (!name.ok) return fail(400, name.code);
    const uname = checkUsername(b.username);
    if (!uname.ok) return fail(400, uname.code);
    const pw = checkPassword(b.password, uname.value);
    if (!pw.ok) return fail(400, pw.code);
    const birth = checkBirthDate(b.birthDate);
    if (!birth.ok) return fail(birth.code === "underage" ? 403 : 400, birth.code);

    const exists = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE username = ?").bind(uname.value).first();
    if (exists) return fail(409, "username_taken");

    const id = newId();
    try {
      await c.env.DB.prepare(
        `INSERT INTO users (id, username, display_name, password_hash, birth_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, uname.value, name.value, await hashPassword(pw.value), birth.value, Date.now())
        .run();
    } catch {
      return fail(409, "username_taken"); // balapan antara pemeriksaan & insert
    }
    const user = (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>())!;
    const recoveryCodes = await makeRecoveryCodes(c.env, id);
    return authResponse(c, user, { recoveryCodes }, 201);
  });

  r.add("POST", "/api/auth/login", "none", async (c) => {
    const b = await readJson(c.req);
    const uname = typeof b.username === "string" ? b.username.trim().replace(/^@/, "").toLowerCase() : "";
    const password = typeof b.password === "string" ? b.password : "";
    if (!uname || !password || uname.length > 64 || password.length > 256) return fail(400, "bad_credentials");
    await rateLimit(c.env, `login-ip:${c.ip}`, 30, 15 * 60_000);
    await rateLimit(c.env, `login-u:${uname}:${c.ip}`, 10, 15 * 60_000); // per pengguna+IP: penyerang tak bisa mengunci korban dari IP lain
    await rateLimit(c.env, `login-ua:${uname}`, 100, 15 * 60_000); // plafon global per pengguna (tebakan terdistribusi)

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(uname).first<UserRow>();
    dummyHash ??= hashPassword("dummy-password-for-timing");
    const valid = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
    if (!user || !valid) return fail(401, "bad_credentials");
    await clearRateLimit(c.env, `login-u:${uname}:${c.ip}`);
    return authResponse(c, user);
  });

  r.add("POST", "/api/auth/logout", "required", async (c) => {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(c.auth.sessionId).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(null, isSecure(c.url)) });
  });

  // Pemulihan akun tanpa email: kode pemulihan sekali pakai yang diberikan saat daftar.
  r.add("POST", "/api/auth/recover", "none", async (c) => {
    const b = await readJson(c.req);
    const uname = typeof b.username === "string" ? b.username.trim().replace(/^@/, "").toLowerCase() : "";
    const code = typeof b.recoveryCode === "string" ? normalizeRecoveryCode(b.recoveryCode) : "";
    if (!uname || code.length !== 12) return fail(400, "bad_recovery");
    await rateLimit(c.env, `recover-ip:${c.ip}`, 10, 3600_000);
    await rateLimit(c.env, `recover-u:${uname}:${c.ip}`, 5, 3600_000);
    await rateLimit(c.env, `recover-ua:${uname}`, 30, 3600_000);
    const pw = checkPassword(b.newPassword, uname);
    if (!pw.ok) return fail(400, pw.code);

    const user = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(uname).first<{ id: string }>();
    const hash = await sha256Hex(code);
    const row = user && (await c.env.DB.prepare(
      "SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
    ).bind(user.id, hash).first<{ id: number }>());
    if (!user || !row) return fail(400, "bad_recovery");

    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ?").bind(Date.now(), row.id),
      c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(pw.value), user.id),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    ]);
    const remaining = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
    ).bind(user.id).first<{ n: number }>();
    return json({ ok: true, remainingCodes: remaining?.n ?? 0 });
  });

  // Untuk tamu mengembalikan {me:null} dengan status 200 (tanpa galat 401 di konsol peramban).
  r.add("GET", "/api/session", "optional", async (c) => json({ me: c.auth ? await toMe(c.env, c.auth.user) : null }));
  r.add("GET", "/api/me", "required", async (c) => json({ me: await toMe(c.env, c.auth.user) }));

  r.add("PATCH", "/api/me", "required", async (c) => {
    const b = await readJson(c.req);
    const u = c.auth.user;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };

    if ("displayName" in b) { const v = checkDisplayName(b.displayName); if (!v.ok) return fail(400, v.code); set("display_name", v.value); }
    if ("bio" in b) { const v = checkBio(b.bio); if (!v.ok) return fail(400, v.code); set("bio", v.value); }
    if ("username" in b) {
      const v = checkUsername(b.username);
      if (!v.ok) return fail(400, v.code);
      if (v.value !== u.username) {
        await rateLimit(c.env, `rename:${u.id}`, 5, 24 * 3600_000);
        const taken = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE username = ? AND id <> ?").bind(v.value, u.id).first();
        if (taken) return fail(409, "username_taken");
        set("username", v.value);
      }
    }
    if ("birthDate" in b) { const v = checkBirthDate(b.birthDate); if (!v.ok) return fail(v.code === "underage" ? 403 : 400, v.code); set("birth_date", v.value); }
    if ("birthDatePublic" in b) set("birth_date_public", b.birthDatePublic === true ? 1 : 0);
    if ("defaultVisibility" in b) { const v = checkVisibility(b.defaultVisibility); if (!v.ok) return fail(400, v.code); set("default_visibility", v.value); }
    if ("defaultInRandom" in b) set("default_in_random", b.defaultInRandom === true ? 1 : 0);
    if ("lang" in b) { if (!(LANGS as readonly unknown[]).includes(b.lang)) return fail(400, "lang_invalid"); set("lang", b.lang); }
    if ("theme" in b) { if (!(THEMES as readonly unknown[]).includes(b.theme)) return fail(400, "theme_invalid"); set("theme", b.theme); }
    for (const [k, col] of [["notifFollow", "notif_follow"], ["notifComment", "notif_comment"], ["notifReply", "notif_reply"], ["notifRelation", "notif_relation"]] as const) {
      if (k in b) set(col, b[k] === true ? 1 : 0);
    }
    if (sets.length) {
      await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, u.id).run();
    }
    const fresh = (await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first<UserRow>())!;
    return json({ me: await toMe(c.env, fresh) });
  });

  r.add("POST", "/api/me/password", "required", async (c) => {
    const b = await readJson(c.req);
    await rateLimit(c.env, `pwchange:${c.auth.user.id}`, 10, 3600_000);
    if (typeof b.currentPassword !== "string" || !(await verifyPassword(b.currentPassword, c.auth.user.password_hash))) {
      return fail(403, "wrong_password");
    }
    const pw = checkPassword(b.newPassword, c.auth.user.username);
    if (!pw.ok) return fail(400, pw.code);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(pw.value), c.auth.user.id),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(c.auth.user.id, c.auth.sessionId),
    ]);
    return json({ ok: true });
  });

  r.add("POST", "/api/me/recovery-codes", "required", async (c) => {
    const b = await readJson(c.req);
    await rateLimit(c.env, `rc:${c.auth.user.id}`, 10, 3600_000);
    if (typeof b.password !== "string" || !(await verifyPassword(b.password, c.auth.user.password_hash))) {
      return fail(403, "wrong_password");
    }
    return json({ recoveryCodes: await makeRecoveryCodes(c.env, c.auth.user.id) });
  });

  r.add("GET", "/api/sessions", "required", async (c: AuthedCtx) => {
    const rows = await c.env.DB.prepare(
      "SELECT id, device, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC",
    ).bind(c.auth.user.id).all<{ id: string; device: string; created_at: number; last_seen_at: number }>();
    return json({
      items: rows.results.map((s) => ({
        id: s.id, device: s.device, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === c.auth.sessionId,
      })),
    });
  });

  r.add("DELETE", "/api/sessions/:id", "required", async (c) => {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").bind(c.params.id!, c.auth.user.id).run();
    return json({ ok: true });
  });

  r.add("POST", "/api/sessions/revoke-others", "required", async (c) => {
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(c.auth.user.id, c.auth.sessionId).run();
    return json({ ok: true });
  });
}

