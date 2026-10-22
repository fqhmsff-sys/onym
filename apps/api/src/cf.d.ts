// Tipe minimal untuk binding Cloudflare. Cukup agar proyek bisa di-typecheck tanpa
// @cloudflare/workers-types; boleh diganti paket resmi tersebut kapan saja.
export {};
declare global {
  interface D1Meta { changes: number; last_row_id: number; rows_read?: number; rows_written?: number }
  interface D1Result<T = unknown> { results: T[]; success: boolean; meta: D1Meta }
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<D1Result<T>>;
    run(): Promise<D1Result>;
  }
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<unknown>;
  }
  interface R2ObjectBody {
    body: ReadableStream;
    size: number;
    httpEtag: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  }
  interface R2Bucket {
    put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
    get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectBody | null>;
    head(key: string): Promise<{ size: number; httpEtag: string } | null>;
    delete(keys: string | string[]): Promise<void>;
  }
  interface ExecutionContext { waitUntil(p: Promise<unknown>): void }
}
