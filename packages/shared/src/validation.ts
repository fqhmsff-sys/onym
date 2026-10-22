import { LIMITS, RELATION_KINDS, RESERVED_USERNAMES, VISIBILITIES, type RelationKind, type Visibility } from "./constants";

export type Check<T> = { ok: true; value: T } | { ok: false; code: string };
const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const bad = (code: string): Check<never> => ({ ok: false, code });

export function checkUsername(raw: unknown): Check<string> {
  if (typeof raw !== "string") return bad("username_invalid");
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  if (u.length < LIMITS.usernameMin || u.length > LIMITS.usernameMax) return bad("username_length");
  if (!/^[a-z0-9][a-z0-9._]*$/.test(u) || u.includes("..") || u.endsWith(".")) return bad("username_invalid");
  if (RESERVED_USERNAMES.includes(u)) return bad("username_reserved");
  return ok(u);
}

export function checkDisplayName(raw: unknown): Check<string> {
  if (typeof raw !== "string") return bad("display_name_invalid");
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length < 1 || [...v].length > LIMITS.displayNameMax) return bad("display_name_length");
  if (/[\u0000-\u001f\u007f]/.test(v)) return bad("display_name_invalid");
  return ok(v);
}

export function checkBio(raw: unknown): Check<string> {
  if (raw == null) return ok("");
  if (typeof raw !== "string") return bad("bio_invalid");
  const v = raw.replace(/\r\n/g, "\n").trim();
  if ([...v].length > LIMITS.bioMax) return bad("bio_length");
  return ok(v);
}

/** Teks post. Boleh kosong (asal ada media); baris baru dipertahankan, baris kosong berlebih dirapikan. */
export function checkPostBody(raw: unknown): Check<string> {
  if (raw == null) return ok("");
  if (typeof raw !== "string") return bad("post_invalid");
  const v = raw.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if ([...v].length > LIMITS.postMax) return bad("post_length");
  return ok(v);
}

export function checkVisibility(raw: unknown): Check<Visibility> {
  return typeof raw === "string" && (VISIBILITIES as readonly string[]).includes(raw) ? ok(raw as Visibility) : bad("visibility_invalid");
}

export function checkRelationKind(raw: unknown): Check<RelationKind> {
  return typeof raw === "string" && (RELATION_KINDS as readonly string[]).includes(raw) ? ok(raw as RelationKind) : bad("relation_kind_invalid");
}

export function checkPassword(raw: unknown, username?: string): Check<string> {
  if (typeof raw !== "string") return bad("password_invalid");
  if (raw.length < LIMITS.passwordMin) return bad("password_short");
  if (raw.length > LIMITS.passwordMax) return bad("password_long");
  if (username && raw.toLowerCase() === username.toLowerCase()) return bad("password_same_as_username");
  return ok(raw);
}

/** Tanggal kalender nyata (termasuk tahun kabisat). Mengembalikan komponen atau null. */
export function parseCalendarDate(s: unknown): { y: number; m: number; d: number } | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function ageOn(birth: { y: number; m: number; d: number }, today: Date): number {
  let age = today.getUTCFullYear() - birth.y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < birth.m || (today.getUTCMonth() + 1 === birth.m && today.getUTCDate() < birth.d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function checkBirthDate(raw: unknown, today: Date = new Date()): Check<string> {
  const p = parseCalendarDate(raw);
  if (!p || p.y < 1900) return bad("birth_date_invalid");
  const age = ageOn(p, today);
  if (age < 0) return bad("birth_date_future");
  if (age < LIMITS.minAge) return bad("underage");
  if (age > 120) return bad("birth_date_invalid");
  return ok(raw as string);
}

/** Komentar tidak boleh kosong atau hanya berisi emoji. */
export function checkComment(raw: unknown): Check<string> {
  if (typeof raw !== "string") return bad("comment_invalid");
  const v = raw.replace(/\r\n/g, "\n").trim();
  if (!v) return bad("comment_empty");
  if ([...v].length > LIMITS.commentMax) return bad("comment_length");
  const stripped = v.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}‍️︎⃣\u{1F3FB}-\u{1F3FF}\s]/gu,
    "",
  );
  if (!/[\p{L}\p{N}]/u.test(stripped)) return bad("comment_emoji_only");
  return ok(v);
}

export function checkStars(raw: unknown): Check<number> {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 5) return bad("stars_invalid");
  return ok(raw);
}

/** Lebar isi bintang (0–1) untuk bintang ke-`index` (1..5) dari rata-rata `avg`. */
export function starFill(avg: number | null, index: number): number {
  if (avg == null) return 0;
  return Math.max(0, Math.min(1, avg - (index - 1)));
}
