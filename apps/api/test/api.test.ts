import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBirthDate, checkPostBody, checkUsername } from "@onym/shared";
import { handle } from "../src/index";
import { secureRandomInt } from "../src/lib/crypto";
import { inspectMedia, MediaRejected } from "../src/lib/mediainfo";
import { createEnv } from "./shim";

// ------------------------------------------------------------------ fixtures (ffmpeg)
const dir = mkdtempSync(join(tmpdir(), "onym-fx-"));
const fx: Record<string, Uint8Array | undefined> = {};
function ffmpeg(name: string, args: string[]) {
  const out = join(dir, name);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args, out]);
  fx[name] = r.status === 0 ? new Uint8Array(readFileSync(out)) : undefined;
}
const sine = (d: number) => ["-f", "lavfi", "-i", `sine=frequency=440:duration=${d}`];
const color = (d: number) => ["-f", "lavfi", "-i", `color=c=red:s=64x48:d=${d}:r=15`];
before(() => {
  ffmpeg("tone2.m4a", [...sine(2), "-c:a", "aac"]);
  ffmpeg("tone2.mp3", [...sine(2), "-c:a", "libmp3lame"]);
  ffmpeg("long.wav", [...sine(120), "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le"]);
  ffmpeg("tone2.wav", [...sine(2), "-c:a", "pcm_s16le"]);
  ffmpeg("silent2.wav", ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2", "-c:a", "pcm_s16le"]);
  ffmpeg("tone2.opus.ogg", [...sine(2), "-c:a", "libopus"]);
  ffmpeg("tone3.webm", [...sine(3), "-c:a", "libopus"]);
  ffmpeg("tone3.live.webm", [...sine(3), "-c:a", "libopus", "-live", "1"]);
  ffmpeg("v3.mp4", [...color(3), ...sine(3), "-c:v", "mpeg4", "-c:a", "aac", "-shortest"]);
  ffmpeg("v3.frag.mp4", [...color(3), ...sine(3), "-c:v", "mpeg4", "-c:a", "aac", "-shortest", "-movflags", "frag_keyframe+empty_moov"]);
  ffmpeg("v3.webm", [...color(3), ...sine(3), "-c:v", "libvpx", "-c:a", "libopus", "-shortest"]);
  ffmpeg("v3.live.webm", [...color(3), ...sine(3), "-c:v", "libvpx", "-c:a", "libopus", "-shortest", "-live", "1"]);
  ffmpeg("v11.mp4", [...color(11), "-c:v", "mpeg4"]);
  ffmpeg("v11.live.webm", [...color(11), "-c:v", "libvpx", "-live", "1"]);
  ffmpeg("p.jpg", [...color(1), "-frames:v", "1"]);
  ffmpeg("p.png", [...color(1), "-frames:v", "1"]);
  ffmpeg("p.webp", [...color(1), "-frames:v", "1"]);
});
after(() => rmSync(dir, { recursive: true, force: true }));
const F = (n: string): Uint8Array => { const v = fx[n]; if (!v) throw new Error(`fixture ${n} gagal dibuat (ffmpeg?)`); return v; };

// ------------------------------------------------------------------ test app
let ipCounter = 0;
function makeApp() {
  const { env, db, store } = createEnv();
  const ec = { waitUntil() {} } as ExecutionContext;
  async function call(method: string, path: string, o: { body?: unknown; token?: string; form?: FormData; raw?: Uint8Array; headers?: Record<string, string>; ip?: string } = {}) {
    const headers: Record<string, string> = { "cf-connecting-ip": o.ip ?? "10.0.0.1", ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    let body: BodyInit | undefined;
    if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
    if (o.form) body = o.form;
    if (o.raw) body = o.raw as BodyInit;
    const res = await handle(new Request(`https://onym.test${path}`, { method, headers, body }), env, ec);
    const ct = res.headers.get("content-type") ?? "";
    const json = ct.includes("json") ? await res.json() : null;
    return { status: res.status, json: json as any, res };
  }
  let n = 0;
  async function signup(name = `user${++n}`) {
    const r = await call("POST", "/api/auth/register", {
      ip: `10.9.${++ipCounter % 250}.${Math.floor(ipCounter / 250)}`,
      body: { username: name, displayName: name.toUpperCase(), password: "passw0rd-ok", birthDate: "2000-05-17" },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return { name, token: r.json.token as string, id: r.json.me.id as string };
  }
  const form = (fields: Record<string, string>, files: { name: string; data: Uint8Array; type?: string }[] = []) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    for (const x of files) f.append("media", new Blob([x.data as BlobPart], { type: x.type ?? "application/octet-stream" }), x.name);
    return f;
  };
  async function post(u: { token: string }, fields: Record<string, string> = {}, files: { name: string; data: Uint8Array }[] = []) {
    return call("POST", "/api/posts", { token: u.token, form: form(fields, files) });
  }
  return { call, signup, post, form, db, store, env };
}

// ================================================================== parser media
describe("pemeriksa media", () => {
  it("audio m4a/mp3/wav/ogg/webm: jenis & durasi", () => {
    for (const [n, kind] of [["tone2.m4a", "audio"], ["tone2.mp3", "audio"], ["tone2.wav", "audio"], ["tone2.opus.ogg", "audio"], ["tone3.webm", "audio"], ["tone3.live.webm", "audio"]] as const) {
      const i = inspectMedia(F(n));
      assert.equal(i.kind, kind, n);
      const want = n.startsWith("tone3") ? 3000 : 2000;
      assert.ok(Math.abs(i.durationMs - want) < 200, `${n}: ${i.durationMs}`);
    }
  });
  it("WAV senyap terdeteksi", () => assert.equal(inspectMedia(F("silent2.wav")).silent, true));
  it("video mp4 / mp4 pecahan / webm / webm langsung: durasi benar", () => {
    for (const n of ["v3.mp4", "v3.frag.mp4", "v3.webm", "v3.live.webm"]) {
      const i = inspectMedia(F(n));
      assert.equal(i.kind, "video", n);
      assert.ok(Math.abs(i.durationMs - 3000) < 250, `${n}: ${i.durationMs}`);
      assert.ok(i.width === 64 && i.height === 48, `${n}: ${i.width}x${i.height}`);
    }
  });
  it("video 11 dtk terbaca >10 dtk", () => {
    assert.ok(inspectMedia(F("v11.mp4")).durationMs > 10_300);
    assert.ok(inspectMedia(F("v11.live.webm")).durationMs > 10_300);
  });
  it("foto jpeg/png/webp: dimensi", () => {
    for (const n of ["p.jpg", "p.png", "p.webp"]) { const i = inspectMedia(F(n)); assert.equal(i.kind, "photo"); assert.deepEqual([i.width, i.height], [64, 48], n); }
  });
  it("menolak sampah & HTML/SVG yang menyamar", () => {
    for (const bytes of [new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), new Uint8Array(64).fill(7), new TextEncoder().encode("<html><script>1</script></html>   ")]) {
      assert.throws(() => inspectMedia(bytes), MediaRejected);
    }
  });
});

describe("validasi bersama", () => {
  it("tanggal lahir", () => {
    assert.equal(checkBirthDate("2000-02-29", new Date("2026-01-01")).ok, true);
    assert.equal(checkBirthDate("2001-02-29", new Date("2026-01-01")).ok, false);
    assert.equal(checkBirthDate("2020-01-01", new Date("2026-01-01")).ok, false);
  });
  it("username & teks post", () => {
    assert.equal(checkUsername("Faqih_1").ok, true);
    assert.equal(checkUsername("admin").ok, false);
    assert.equal(checkPostBody("a".repeat(501)).ok, false);
    assert.equal(checkPostBody("  halo\n\n\n\ndunia ").ok && (checkPostBody("  halo\n\n\n\ndunia ") as any).value, "halo\n\ndunia");
  });
  it("acak seragam", () => {
    const c = [0, 0, 0, 0, 0]; for (let i = 0; i < 20000; i++) c[secureRandomInt(5)]!++;
    for (const x of c) assert.ok(x > 3600 && x < 4400);
  });
});

// ================================================================== API
describe("akun", () => {
  it("daftar, masuk, kode pemulihan, ganti kata sandi, sesi", async () => {
    const a = makeApp();
    const u = await a.signup("budi");
    const me = await a.call("GET", "/api/me", { token: u.token });
    assert.equal(me.json.me.username, "budi");
    assert.equal(me.json.me.defaultVisibility, "public");
    const bad = await a.call("POST", "/api/auth/login", { body: { username: "budi", password: "salah-banget" } });
    assert.equal(bad.status, 401);
    const ok = await a.call("POST", "/api/auth/login", { body: { username: "budi", password: "passw0rd-ok" } });
    assert.equal(ok.status, 200);
    const sess = await a.call("GET", "/api/sessions", { token: u.token });
    assert.equal(sess.json.items.length, 2);
    const young = await a.call("POST", "/api/auth/register", { ip: "10.8.8.8", body: { username: "kecil", displayName: "K", password: "passw0rd-ok", birthDate: `${new Date().getUTCFullYear() - 10}-01-01` } });
    assert.equal(young.status, 403);
  });
});

describe("post: teks, foto, audio, video, campur", () => {
  it("teks saja", async () => {
    const a = makeApp(); const u = await a.signup();
    const r = await a.post(u, { body: "Halo dunia" });
    assert.equal(r.status, 201); assert.equal(r.json.post.media.length, 0);
    assert.equal((await a.post(u, {})).status, 400); // kosong
  });
  it("campur: video + foto + audio + teks", async () => {
    const a = makeApp(); const u = await a.signup();
    const r = await a.post(u, { body: "semua" }, [
      { name: "a.m4a", data: F("tone2.m4a") }, { name: "p.jpg", data: F("p.jpg") }, { name: "v.mp4", data: F("v3.mp4") },
    ]);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.post.media.map((m: any) => m.kind), ["video", "photo", "audio"]);
  });
  it("video >10 dtk ditolak (mp4 & webm), 10 dtk diterima", async () => {
    const a = makeApp(); const u = await a.signup();
    assert.equal((await a.post(u, {}, [{ name: "v.mp4", data: F("v11.mp4") }])).json.error.code, "video_too_long");
    assert.equal((await a.post(u, {}, [{ name: "v.webm", data: F("v11.live.webm") }])).json.error.code, "video_too_long");
    assert.equal((await a.post(u, {}, [{ name: "v.webm", data: F("v3.live.webm") }])).status, 201);
  });
  it("batas jumlah & file palsu", async () => {
    const a = makeApp(); const u = await a.signup();
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}.jpg`, data: F("p.jpg") }));
    assert.equal((await a.post(u, {}, five)).status, 400);
    assert.equal((await a.post(u, {}, [{ name: "x.jpg", data: new TextEncoder().encode("<script>alert(1)</script>........") }])).status, 415);
    assert.equal((await a.post(u, {}, [{ name: "a.wav", data: F("silent2.wav") }])).json.error.code, "audio_silent");
  });
  it("audio tanpa batas durasi & ukuran (120 dtk, >20 MB) diterima; video tetap dibatasi", async () => {
    const a = makeApp(); const u = await a.signup();
    const big = F("long.wav");
    assert.ok(big.length > 20 * 1024 * 1024);
    const r = await a.post(u, {}, [{ name: "long.wav", data: big }]);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.ok(r.json.post.media[0].durationMs > 119_000);
    assert.equal((await a.post(u, {}, [{ name: "v.mp4", data: F("v11.mp4") }])).json.error.code, "video_too_long");
  });
  it("hanya pemilik yang menghapus; media ikut terhapus", async () => {
    const a = makeApp(); const u = await a.signup(); const o = await a.signup();
    const p = (await a.post(u, { body: "x" }, [{ name: "p.jpg", data: F("p.jpg") }])).json.post;
    assert.equal(a.store.size, 1);
    assert.equal((await a.call("DELETE", `/api/posts/${p.id}`, { token: o.token })).status, 404);
    assert.equal((await a.call("DELETE", `/api/posts/${p.id}`, { token: u.token })).status, 200);
    assert.equal(a.store.size, 0);
  });
});

describe("media: URL bertanda tangan & Range", () => {
  it("tanpa/dengan token salah ditolak; Range 206 berfungsi", async () => {
    const a = makeApp(); const u = await a.signup();
    const p = (await a.post(u, {}, [{ name: "v.mp4", data: F("v3.mp4") }])).json.post;
    const url: string = p.media[0].url;
    assert.equal((await a.call("GET", url.split("?")[0]!)).status, 403);
    assert.equal((await a.call("GET", url.replace(/\.[0-9a-f]{32}/, ".00000000000000000000000000000000"))).status, 403);
    const full = await a.call("GET", url);
    assert.equal(full.status, 200); assert.equal(full.res.headers.get("accept-ranges"), "bytes");
    const part = await a.call("GET", url, { headers: { range: "bytes=0-99" } });
    assert.equal(part.status, 206); assert.equal(part.res.headers.get("content-range")?.startsWith("bytes 0-99/"), true);
    assert.equal((await part.res.arrayBuffer()).byteLength, 100);
    const tail = await a.call("GET", url, { headers: { range: "bytes=-50" } });
    assert.equal(tail.status, 206); assert.equal((await tail.res.arrayBuffer()).byteLength, 50);
    assert.equal((await a.call("GET", url, { headers: { range: "bytes=999999999-" } })).status, 416);
  });
  it("URL media tidak diberikan untuk post yang tak boleh dilihat", async () => {
    const a = makeApp(); const u = await a.signup(); const o = await a.signup();
    const p = (await a.post(u, { visibility: "followers" }, [{ name: "p.jpg", data: F("p.jpg") }])).json.post;
    assert.equal((await a.call("GET", `/api/posts/${p.id}`, { token: o.token })).status, 404);
    assert.equal((await a.call("GET", `/api/posts/${p.id}`)).status, 404);
  });
});

describe("privasi: publik / pengikut / hubungan", () => {
  it("tiga tingkat terhadap tamu, pengikut, dan hubungan", async () => {
    const a = makeApp();
    const owner = await a.signup("pemilik"); const fol = await a.signup("pengikut"); const rel = await a.signup("sahabat"); const x = await a.signup("asing");
    const mk = async (vis: string) => (await a.post(owner, { body: vis, visibility: vis })).json.post.id as string;
    const pub = await mk("public"), onlyFol = await mk("followers"), onlyRel = await mk("relationship");
    const canSee = async (tok: string | undefined, id: string) => (await a.call("GET", `/api/posts/${id}`, { token: tok })).status === 200;

    assert.deepEqual([await canSee(undefined, pub), await canSee(undefined, onlyFol), await canSee(undefined, onlyRel)], [true, false, false]);
    assert.deepEqual([await canSee(owner.token, pub), await canSee(owner.token, onlyFol), await canSee(owner.token, onlyRel)], [true, true, true]);

    await a.call("POST", "/api/users/pemilik/follow", { token: fol.token });
    assert.deepEqual([await canSee(fol.token, pub), await canSee(fol.token, onlyFol), await canSee(fol.token, onlyRel)], [true, true, false]);

    // Hubungan: diminta saja BELUM cukup; harus disetujui pihak yang diminta.
    assert.equal((await a.call("POST", "/api/relations", { token: rel.token, body: { username: "pemilik", kind: "bestfriend" } })).status, 201);
    assert.equal(await canSee(rel.token, onlyRel), false);
    assert.equal((await a.call("POST", "/api/relations/sahabat/accept", { token: rel.token })).status, 404); // peminta tak bisa menyetujui sendiri
    assert.equal(await canSee(rel.token, onlyRel), false);
    assert.equal((await a.call("POST", "/api/relations/sahabat/accept", { token: owner.token })).status, 200);
    assert.deepEqual([await canSee(rel.token, onlyRel), await canSee(rel.token, onlyFol)], [true, false]);
    assert.equal(await canSee(x.token, onlyRel), false);

    // Putus hubungan oleh salah satu pihak → akses hilang.
    await a.call("DELETE", "/api/relations/pemilik", { token: rel.token });
    assert.equal(await canSee(rel.token, onlyRel), false);
  });

  it("komentar, rating, simpan, media ikut aturan visibilitas", async () => {
    const a = makeApp(); const o = await a.signup(); const x = await a.signup();
    const p = (await a.post(o, { visibility: "relationship", body: "rahasia" })).json.post.id;
    for (const [m, path, body] of [["POST", `/api/posts/${p}/comments`, { body: "hai" }], ["PUT", `/api/posts/${p}/rating`, { stars: 5 }], ["PUT", `/api/posts/${p}/save`, undefined], ["GET", `/api/posts/${p}/comments`, undefined]] as const) {
      assert.equal((await a.call(m, path, { token: x.token, body })).status, 404, `${m} ${path}`);
    }
  });
});

describe("hubungan butuh izin dua pihak", () => {
  it("permintaan, tolak, batal, terima, jenis hubungan, tidak bisa diri sendiri", async () => {
    const a = makeApp(); const p = await a.signup("ani"); const q = await a.signup("budi");
    assert.equal((await a.call("POST", "/api/relations", { token: p.token, body: { username: "ani", kind: "friend" } })).status, 400);
    assert.equal((await a.call("POST", "/api/relations", { token: p.token, body: { username: "budi", kind: "musuh" } })).status, 400);
    for (const kind of ["friend", "bestfriend", "partner", "family"]) {
      const r = await a.call("POST", "/api/relations", { token: p.token, body: { username: "budi", kind } });
      assert.equal(r.status, 201, kind); // permintaan ulang mengganti jenis
    }
    const list = await a.call("GET", "/api/relations", { token: q.token });
    assert.equal(list.json.incoming.length, 1); assert.equal(list.json.incoming[0].kind, "family"); assert.equal(list.json.accepted.length, 0);
    const prof = await a.call("GET", "/api/users/ani", { token: q.token });
    assert.deepEqual(prof.json.profile.relation, { kind: "family", status: "pending", direction: "incoming" });
    assert.equal(prof.json.profile.relationCount, 0);
    assert.equal((await a.call("POST", "/api/relations", { token: q.token, body: { username: "ani", kind: "friend" } })).status, 409);
    await a.call("DELETE", "/api/relations/ani", { token: q.token }); // tolak
    assert.equal((await a.call("GET", "/api/relations", { token: q.token })).json.incoming.length, 0);
    await a.call("POST", "/api/relations", { token: p.token, body: { username: "budi", kind: "partner" } });
    await a.call("POST", "/api/relations/ani/accept", { token: q.token });
    const after = await a.call("GET", "/api/users/budi", { token: p.token });
    assert.deepEqual(after.json.profile.relation, { kind: "partner", status: "accepted", direction: "mutual" });
    assert.equal(after.json.profile.relationCount, 1);
    assert.equal((await a.call("POST", "/api/relations", { token: p.token, body: { username: "budi", kind: "friend" } })).status, 409);
    const notifs = await a.call("GET", "/api/notifications", { token: p.token });
    assert.ok(notifs.json.items.some((n: any) => n.type === "relation_accepted" && n.kind === "partner"));
  });
});

describe("mengikuti & feed & acak", () => {
  it("follow langsung aktif, hitungan, daftar", async () => {
    const a = makeApp(); const p = await a.signup("ani"); const q = await a.signup("budi");
    await a.call("POST", "/api/users/budi/follow", { token: p.token });
    const pr = (await a.call("GET", "/api/users/budi", { token: p.token })).json.profile;
    assert.equal(pr.followerCount, 1); assert.equal(pr.following, true);
    assert.equal((await a.call("GET", "/api/users/ani", { token: q.token })).json.profile.followingCount, 1);
    assert.equal((await a.call("GET", "/api/users/budi/followers")).json.items[0].username, "ani");
    assert.equal((await a.call("POST", "/api/users/ani/follow", { token: p.token })).status, 400);
  });
  it("feed terbaru→terlama, cursor, scope following", async () => {
    const a = makeApp(); const p = await a.signup("ani"); const q = await a.signup("budi"); const z = await a.signup("zed");
    for (let i = 0; i < 25; i++) await a.post(q, { body: `b${i}` });
    await a.post(z, { body: "dari zed" });
    const f1 = await a.call("GET", "/api/feed");
    assert.equal(f1.json.items.length, 20); assert.equal(f1.json.items[0].body, "dari zed");
    const f2 = await a.call("GET", `/api/feed?cursor=${f1.json.nextCursor}`);
    assert.equal(f2.json.items.length, 6); assert.equal(f2.json.nextCursor, null);
    await a.call("POST", "/api/users/budi/follow", { token: p.token });
    const fol = await a.call("GET", "/api/feed?scope=following", { token: p.token });
    assert.ok(fol.json.items.every((x: any) => x.author.username === "budi"));
    assert.equal((await a.call("GET", "/api/feed?scope=following")).status, 401);
  });
  it("acak: teks tidak ikut, privat tidak bocor, bisa dikecualikan, distribusi seragam", async () => {
    const a = makeApp(); const o = await a.signup(); const viewers = [await a.signup(), await a.signup(), await a.signup(), await a.signup()];     assert.equal((await a.call("POST", "/api/random")).json.error.code, "no_media");
    await a.post(o, { body: "hanya teks" });
    assert.equal((await a.call("POST", "/api/random")).status, 404);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await a.post(o, { body: `m${i}` }, [{ name: "p.jpg", data: F("p.jpg") }])).json.post.id);
    await a.post(o, { body: "privat", visibility: "relationship" }, [{ name: "p.jpg", data: F("p.jpg") }]);
    const skip = (await a.post(o, { body: "tak ikut", inRandom: "0" }, [{ name: "p.jpg", data: F("p.jpg") }])).json.post.id;
    const hits = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const r = await a.call("POST", "/api/random", { token: viewers[i % 4]!.token, ip: `10.7.${Math.floor(i / 250)}.${i % 250}` });
      assert.equal(r.status, 200); assert.ok(r.json.post.media.length > 0);
      hits.set(r.json.post.id, (hits.get(r.json.post.id) ?? 0) + 1);
    }
    assert.equal(hits.has(skip), false); assert.equal(hits.size, 3);
    for (const id of ids) assert.ok((hits.get(id) ?? 0) > 60, `${id}: ${hits.get(id)}`);
  });
});

describe("rating, komentar, simpan, pencarian, penayangan, avatar, hapus akun", () => {
  it("alur lengkap", async () => {
    const a = makeApp(); const o = await a.signup("owner"); const x = await a.signup("xavier");
    const p = (await a.post(o, { body: "kata kunci unik" }, [{ name: "p.jpg", data: F("p.jpg") }])).json.post.id;
    assert.equal((await a.call("PUT", `/api/posts/${p}/rating`, { token: x.token, body: { stars: 6 } })).status, 400);
    const rated = await a.call("PUT", `/api/posts/${p}/rating`, { token: x.token, body: { stars: 4 } });
    assert.deepEqual(rated.json.post.rating, { avg: 4, count: 1, mine: 4 });
    const c1 = await a.call("POST", `/api/posts/${p}/comments`, { token: x.token, body: { body: "mantap" } });
    assert.equal((await a.call("POST", `/api/posts/${p}/comments`, { token: x.token, body: { body: "😀😀" } })).status, 400);
    await a.call("POST", `/api/posts/${p}/comments`, { token: o.token, body: { body: "makasih", parentId: c1.json.comment.id } });
    assert.equal((await a.call("GET", `/api/posts/${p}/comments`)).json.items.length, 2);
    assert.equal((await a.call("PUT", `/api/posts/${p}/save`, { token: x.token })).status, 200);
    assert.equal((await a.call("GET", "/api/me/saved", { token: x.token })).json.items.length, 1);
    assert.equal((await a.call("GET", "/api/search?q=unik")).json.posts.length, 1);
    assert.equal((await a.call("GET", "/api/search?q=xav")).json.users[0].username, "xavier");
    assert.equal((await a.call("POST", `/api/posts/${p}/view`, { token: x.token })).json.counted, true);
    assert.equal((await a.call("POST", `/api/posts/${p}/view`, { token: x.token })).json.counted, false);
    assert.equal((await a.call("POST", `/api/posts/${p}/view`, { token: o.token })).json.counted, false);
    const av = await a.call("PUT", "/api/me/avatar", { token: x.token, raw: F("p.jpg") });
    assert.equal(av.status, 200);
    assert.equal((await a.call("PUT", "/api/me/avatar", { token: x.token, raw: new TextEncoder().encode("<svg onload=alert(1)>......") })).status, 415);
    assert.equal((await a.call("GET", av.json.avatarUrl)).res.headers.get("content-type"), "image/jpeg");
    assert.equal((await a.call("DELETE", "/api/me", { token: o.token, body: { password: "salah-salah" } })).status, 403);
    assert.equal((await a.call("DELETE", "/api/me", { token: o.token, body: { password: "passw0rd-ok" } })).status, 200);
    assert.equal(a.store.has(`avatars/${o.id}`), false);
    assert.equal((await a.call("GET", `/api/posts/${p}`)).status, 404);
    assert.equal([...a.store.keys()].filter((k) => k.startsWith("media/")).length, 0);
  });
});

describe("keamanan", () => {
  it("CORS hanya untuk asal aplikasi; header keamanan; CSRF cookie", async () => {
    const a = makeApp();
    const ok = await a.call("GET", "/api/config", { headers: { origin: "capacitor://localhost" } });
    assert.equal(ok.res.headers.get("access-control-allow-origin"), "capacitor://localhost");
    const evil = await a.call("GET", "/api/config", { headers: { origin: "https://evil.example" } });
    assert.equal(evil.res.headers.get("access-control-allow-origin"), null);
    assert.equal(ok.res.headers.get("x-frame-options"), "DENY");
    const pre = await a.call("OPTIONS", "/api/posts", { headers: { origin: "https://localhost" } });
    assert.equal(pre.status, 204);
    const u = await a.signup();
    const login = await a.call("POST", "/api/auth/login", { body: { username: u.name, password: "passw0rd-ok" } });
    const cookie = login.res.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = await a.call("POST", "/api/posts", { headers: { cookie, origin: "https://evil.example" }, form: a.form({ body: "x" }) });
    assert.equal(csrf.status, 403);
  });
  it("tanpa MEDIA_SECRET server menolak menandatangani", async () => {
    const a = makeApp(); const u = await a.signup();
    const p = await a.post(u, { body: "x" }, [{ name: "p.jpg", data: F("p.jpg") }]);
    assert.equal(p.status, 201);
    (a.env as any).MEDIA_SECRET = undefined;
    assert.equal((await a.call("GET", "/api/feed")).status, 500);
  });
});

// ------------------------------------------------------------------ regresi hasil audit keamanan
describe("regresi audit", () => {
  it("header Origin rusak (\"null\") ditolak 403, bukan galat 500", async () => {
    const a = makeApp(); const u = await a.signup();
    const login = await a.call("POST", "/api/auth/login", { body: { username: u.name, password: "passw0rd-ok" } });
    const cookie = login.res.headers.get("set-cookie")!.split(";")[0]!;
    const r = await a.call("POST", "/api/posts", { headers: { cookie, origin: "null" }, form: a.form({ body: "x" }) });
    assert.equal(r.status, 403);
  });

  it("edit post penuh (multipart): teks, media dipertahankan/dibuang/ditambah, urutan, R2 bersih, hanya pemilik", async () => {
    const a = makeApp(); const u = await a.signup(); const other = await a.signup();
    const created = await a.post(u, { body: "awal", visibility: "public" }, [{ name: "p.jpg", data: F("p.jpg") }]);
    assert.equal(created.status, 201);
    const pid = created.json.post.id as string, photoId = created.json.post.media[0].id as string;
    const patch = (who: { token: string }, f: FormData) => a.call("PATCH", `/api/posts/${pid}`, { token: who.token, form: f });

    // pertahankan foto, ubah teks & privasi, tambah audio → urutan foto lalu audio
    const f1 = a.form({ body: "diedit", visibility: "followers", keep: photoId, durations: "2000" }, [{ name: "t.m4a", data: F("tone2.m4a") }]);
    const r1 = await patch(u, f1);
    assert.equal(r1.status, 200, JSON.stringify(r1.json));
    assert.equal(r1.json.post.body, "diedit");
    assert.equal(r1.json.post.visibility, "followers");
    assert.deepEqual(r1.json.post.media.map((m: any) => m.kind), ["photo", "audio"]);
    assert.equal(r1.json.post.media[0].id, photoId);
    const keysBefore = [...a.store.keys()].filter((k) => k.startsWith(`media/${pid}/`));
    assert.equal(keysBefore.length, 2);

    // buang foto (tidak ada di keep): objek R2-nya ikut terhapus
    const r2 = await patch(u, a.form({ body: "diedit", keep: r1.json.post.media[1].id }));
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.json.post.media.map((m: any) => m.kind), ["audio"]);
    assert.equal([...a.store.keys()].filter((k) => k.startsWith(`media/${pid}/`)).length, 1);

    // kosong total ditolak; batas jenis berlaku (audio kedua saat audio lama dipertahankan)
    assert.equal((await patch(u, a.form({ body: "", keep: "" }))).status, 400);
    const dup = await patch(u, a.form({ body: "x", keep: r2.json.post.media[0].id, durations: "2000" }, [{ name: "t2.m4a", data: F("tone2.m4a") }]));
    assert.equal(dup.status, 400);
    assert.equal(dup.json.error.code, "too_many_audio");

    // bukan pemilik → 404, dan tidak ada perubahan
    assert.equal((await patch(other, a.form({ body: "bajak" }))).status, 404);
    assert.equal((await a.call("GET", `/api/posts/${pid}`, { token: u.token })).json.post.body, "diedit");
  });

  it("pembatas laju atomik: permintaan paralel tidak bisa melewati batas", async () => {
    const a = makeApp();
    const rs = await Promise.all(Array.from({ length: 100 }, () => a.call("GET", "/api/username-available?u=abc", { ip: "10.77.0.1" })));
    assert.equal(rs.filter((r) => r.status === 200).length, 60); // batas 60/menit per IP
    assert.equal(rs.filter((r) => r.status === 429).length, 40);
  });

  it("penguncian login per pengguna+IP: penyerang tak bisa mengunci pemilik akun dari IP lain", async () => {
    const a = makeApp(); const u = await a.signup();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await a.call("POST", "/api/auth/login", { ip: "10.88.0.1", body: { username: u.name, password: "salah-" + i } })).status;
    assert.equal(last, 429); // penyerang dikunci
    const ok = await a.call("POST", "/api/auth/login", { ip: "10.88.0.2", body: { username: u.name, password: "passw0rd-ok" } });
    assert.equal(ok.status, 200); // pemilik dari IP lain tetap bisa masuk
  });
});
