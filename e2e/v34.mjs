// Uji v3.4: Beranda tetap ada setelah pindah halaman, Acak = 1 media saja, video bisa diposting.
import { launch } from "./lib.mjs";
import { B, signup } from "./helpers.mjs";
const T = "/home/claude/t/";
const { browser, page, errors } = await launch();
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
await signup(page, "tester" + Date.now() % 100000, "Tester");
await page.click(".composer"); await page.waitForSelector(".compose-text");
await page.fill(".compose-text", "hi");
await page.setInputFiles('.compose input[type=file][accept="image/*"]', T + "land.jpg"); await page.waitForTimeout(700);
await page.setInputFiles('.compose input[type=file][accept="video/*"]', T + "vland.webm"); await page.waitForTimeout(1200);
await page.click(".post-btn");
await page.waitForFunction(() => document.querySelectorAll(".feed-list .post").length >= 1, null, { timeout: 15000 });
await page.waitForTimeout(800);
ok(await page.locator(".car-slide").count() === 2, "post video+foto berhasil");
// pindah halaman lalu balik, berkali-kali
for (const dest of ["#/random", "#/", "#/search", "#/", "#/random", "#/"]) { await page.evaluate((d) => { location.hash = d; }, dest); await page.waitForTimeout(700); }
await page.waitForTimeout(500);
const vis = await page.evaluate(() => { const p = document.querySelector(".feed-list .post"); if (!p) return "none"; const pg = p.closest(".page"); return pg.className + " op=" + getComputedStyle(pg).opacity + " pos=" + getComputedStyle(pg).position; });
console.log(vis);
ok(vis.includes("op=1") && !vis.includes("page-out"), "Beranda tampil lagi setelah pindah");
// Acak
await page.evaluate(() => { location.hash = "#/random"; }); await page.waitForTimeout(600);
await page.click(".rand-btn"); await page.waitForSelector(".rand-card", { timeout: 8000 }); await page.waitForTimeout(800);
ok(await page.locator(".rand-card .car-slide").count() === 1, "Acak: tepat 1 media");
ok(await page.locator(".rand-card .post-body").count() === 0, "Acak: tanpa teks post");
await page.screenshot({ path: "/tmp/claude-0/sc/rand.png" });
console.log(errors.filter((e) => !/favicon/.test(e)).slice(0, 5));
await browser.close();
