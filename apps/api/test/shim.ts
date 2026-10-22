// Pengganti lokal untuk D1 dan R2 agar API bisa dijalankan apa adanya di Node (SQLite sungguhan).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../src/env";

type Param = string | number | null;

export function createDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dirname, "../migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));

  class Stmt implements D1PreparedStatement {
    constructor(private sql: string, private params: Param[] = []) {}
    bind(...v: unknown[]) {
      for (const x of v) if (x !== null && typeof x !== "string" && typeof x !== "number") throw new Error(`param tidak valid: ${typeof x}`);
      return new Stmt(this.sql, v as Param[]);
    }
    async first<T>() { return ((db.prepare(this.sql).get(...this.params) as T | undefined) ?? null) as T | null; }
    async all<T>() {
      const results = db.prepare(this.sql).all(...this.params) as T[];
      return { results, success: true, meta: { changes: 0, last_row_id: 0 } };
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.params);
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
  }
  const d1: D1Database = {
    prepare: (q) => new Stmt(q),
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await (s as Stmt).run());
        db.exec("COMMIT");
        return out as never;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    async exec(q) { db.exec(q); return {}; },
  };
  return { db, d1 };
}

export function createBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket: R2Bucket = {
    async put(key, value, opts) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer);
      store.set(key, { bytes: new Uint8Array(bytes), contentType: opts?.httpMetadata?.contentType });
    },
    async get(key, opts?: { range?: { offset: number; length: number } }) {
      const o = store.get(key);
      if (!o) return null;
      const part = opts?.range ? o.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length) : o.bytes;
      return {
        body: new Blob([part as BlobPart]).stream(),
        size: o.bytes.length,
        httpEtag: `"${key.length}-${o.bytes.length}"`,
        arrayBuffer: async () => o.bytes.slice().buffer as ArrayBuffer,
      };
    },
    async head(key) { const o = store.get(key); return o ? { size: o.bytes.length, httpEtag: `"${o.bytes.length}"` } : null; },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k); },
  };
  return { bucket, store };
}

export function createEnv(): { env: Env; db: DatabaseSync; store: Map<string, { bytes: Uint8Array }> } {
  const { db, d1 } = createDb();
  const { bucket, store } = createBucket();
  return { env: { DB: d1, MEDIA_BUCKET: bucket, MEDIA_SECRET: "test-secret-0123456789abcdef" }, db, store };
}
