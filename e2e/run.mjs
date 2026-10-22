// Menjalankan server uji lokal lalu alur UI sungguhan lewat Playwright (butuh: npm i -D playwright && npx playwright install chromium).
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
const srv = spawn("npx", ["tsx", "test/serve.ts", "8787"], { cwd: "apps/api", stdio: "inherit", shell: true });
await wait(4000);
let code = 0;
for (const f of ["alur-media.mjs", "alur-hubungan.mjs"]) {
  const r = spawn("node", [`e2e/${f}`], { stdio: "inherit" });
  code ||= await new Promise((res) => r.on("exit", res));
}
srv.kill(); process.exit(code);
