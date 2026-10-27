// Gateway MongoDB (Atlas M0) untuk Worker Cloudflare — HANYA komputasi tanpa penyimpanan di Supabase.
// Dipanggil Worker dengan header x-internal-secret (rahasia bersama). Tugas MongoDB: linimasa, notifikasi, foto posting (GridFS).
import { GridFSBucket, MongoClient, ObjectId } from "npm:mongodb@6";

let client: Promise<MongoClient> | null = null;
const DB = () => Deno.env.get("MONGODB_DB") ?? "onym";
async function db() {
  client ??= (async () => {
    const c = new MongoClient(Deno.env.get("MONGODB_URI")!, { maxPoolSize: 4, serverSelectionTimeoutMS: 5000 }); await c.connect();
    const d = c.db(DB());
    await d.collection("timelines").createIndex({ userId: 1, createdAt: -1 });
    await d.collection("timelines").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
    await d.collection("notifications").createIndex({ userId: 1, createdAt: -1 });
    await d.collection("notifications").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
    return c;
  })();
  return (await client).db(DB());
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
function same(a: string, b: string) { const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); let r = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) r |= (x[i] ?? 0) ^ (y[i] ?? 0); return r === 0; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, OID = /^[0-9a-f]{24}$/, ISO = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;

Deno.serve(async (req) => {
  const secret = Deno.env.get("INTERNAL_SECRET") ?? "";
  if (!secret || !same(req.headers.get("x-internal-secret") ?? "", secret)) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url); const op = url.searchParams.get("op") ?? ""; const q = (k: string) => url.searchParams.get(k) ?? "";
  const d = await db();
  const lim = Math.min(Math.max(parseInt(q("limit") || "20", 10) || 20, 1), 50);
  const before = q("before"); if (before && !ISO.test(before)) return json({ error: "cursor" }, 400);
  const user = q("user"); if (user && !UUID.test(user)) return json({ error: "user" }, 400);

  switch (op) {
    case "timeline": {
      const f: Record<string, unknown> = { userId: user }; if (before) f.createdAt = { $lt: new Date(before) };
      const rows = await d.collection("timelines").find(f).sort({ createdAt: -1 }).limit(lim).toArray();
      return json({ ids: rows.map((r) => r.postId), next: rows.length === lim ? rows[rows.length - 1].createdAt : null });
    }
    case "fanout": {
      const b = await req.json(); if (!UUID.test(b.postId) || !UUID.test(b.authorId) || !Array.isArray(b.userIds)) return json({ error: "bad" }, 400);
      const at = new Date(b.createdAt); const ids = (b.userIds as string[]).filter((x) => UUID.test(x)).slice(0, 5001);
      const ops = ids.map((u) => ({ updateOne: { filter: { _id: `${u}:${b.postId}` as never }, update: { $setOnInsert: { userId: u, postId: b.postId, createdAt: at } }, upsert: true } }));
      for (let i = 0; i < ops.length; i += 1000) await d.collection("timelines").bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      return json({ ok: true, n: ids.length });
    }
    case "notify": {
      const b = await req.json(); if (!UUID.test(b.userId) || !UUID.test(b.actorId) || typeof b.type !== "string" || b.type.length > 30) return json({ error: "bad" }, 400);
      const id = `${b.type}:${b.actorId}:${b.postId ?? ""}:${b.userId}`;
      await d.collection("notifications").updateOne({ _id: id as never }, { $setOnInsert: { userId: b.userId, type: b.type, actorId: b.actorId, postId: UUID.test(b.postId ?? "") ? b.postId : null, read: false, createdAt: new Date() } }, { upsert: true });
      return json({ ok: true });
    }
    case "notifications": {
      const f: Record<string, unknown> = { userId: user }; if (before) f.createdAt = { $lt: new Date(before) };
      const items = await d.collection("notifications").find(f).sort({ createdAt: -1 }).limit(lim).project({ userId: 0 }).toArray();
      return json({ items, next: items.length === lim ? items[items.length - 1].createdAt : null });
    }
    case "unread": return json({ count: await d.collection("notifications").countDocuments({ userId: user, read: false }, { limit: 100 }) });
    case "read": await d.collection("notifications").updateMany({ userId: user, read: false }, { $set: { read: true } }); return json({ ok: true });
    case "user-delete":
      await Promise.all([d.collection("timelines").deleteMany({ userId: user }), d.collection("notifications").deleteMany({ $or: [{ userId: user }, { actorId: user }] })]);
      return json({ ok: true });
    case "photo-put": {
      const owner = q("owner"); if (!UUID.test(owner)) return json({ error: "owner" }, 400);
      const buf = new Uint8Array(await req.arrayBuffer()); if (buf.length < 16 || buf.length > 920 * 1024) return json({ error: "size" }, 413);
      const bucket = new GridFSBucket(d, { bucketName: "photos" }); const up = bucket.openUploadStream("p", { metadata: { owner }, contentType: req.headers.get("content-type") ?? "image/jpeg" });
      await new Promise<void>((res, rej) => { up.on("error", rej); up.on("finish", () => res()); up.end(buf); });
      return json({ id: String(up.id) }, 201);
    }
    case "photo-get": {
      const id = q("id"); if (!OID.test(id)) return json({ error: "id" }, 400);
      const bucket = new GridFSBucket(d, { bucketName: "photos" }); const chunks: Uint8Array[] = [];
      try { for await (const ch of bucket.openDownloadStream(new ObjectId(id))) chunks.push(ch as Uint8Array); } catch { return new Response("Not Found", { status: 404 }); }
      let n = 0; for (const c of chunks) n += c.length; const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
      return new Response(out, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
    }
    case "photo-del": {
      const id = q("id"); if (!OID.test(id)) return json({ error: "id" }, 400);
      try { await new GridFSBucket(d, { bucketName: "photos" }).delete(new ObjectId(id)); } catch { /* sudah hilang */ }
      return json({ ok: true });
    }
  }
  return json({ error: "op" }, 400);
});
