import { chromium } from "playwright";
export async function launch(opts = {}) {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, permissions: ["camera", "microphone"], locale: "id-ID", ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
  return { browser, ctx, page, errors };
}
