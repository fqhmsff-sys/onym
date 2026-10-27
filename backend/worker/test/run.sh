#!/usr/bin/env bash
# Uji lokal (Node 22+): D1 = SQLite sungguhan; Neon/Supabase/Mongo ditiru. Tanpa internet.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; tmp="$(mktemp -d)"
mkdir -p "$tmp/worker/src" "$tmp/worker/test" "$tmp/d1"
cp "$here"/../src/*.ts "$tmp/worker/src/"; cp "$here/smoke.ts" "$tmp/worker/test/"; cp "$here"/../../d1/0001_edge.sql "$tmp/d1/"; cp -r "$here/stub/node_modules" "$tmp/worker/node_modules"
echo '{"type":"module"}' > "$tmp/worker/package.json"
sed -i 's#from "\./\(http\|crypto\|auth\|media\|neon\|index\)"#from "./\1.ts"#' "$tmp"/worker/src/*.ts
cd "$tmp/worker/test" && node --experimental-strip-types --experimental-sqlite --no-warnings smoke.ts
