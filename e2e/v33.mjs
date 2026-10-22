// Uji v3.3: Beranda tidak kosong, carousel geser, Acak per media (1 item), zoom, PP, autoplay.
import { launch } from "./lib.mjs";
import { B, signup } from "./helpers.mjs";
const T = "/home/claude/t/";
const { browser, page, errors } = await launch();
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
await signup(page, "tester" + Date.now() % 100000, "Tester");

// --- Posting 1: foto landscape + foto portrait + video landscape + video portrait + audio; hanya foto portrait & audio ikut Acak
await page.click(".composer"); await page.waitForSelector(".compose-text");
await page.fill(".compose-text", "banyak media");
const add = async (sel, f) => { await page.setInputFiles(`.compose input[type=file][accept="${sel}"]`, T + f); await page.waitForTimeout(700); };
await add("image/*", "land.jpg"); await add("image/*", "port.jpg");
await add("video/*", "vland.webm"); await add("video/*", "vport.webm");
await page.setInputFiles('.compose input[type=file][accept^="audio"]', T + "aud.ogg"); await page.waitForTimeout(900);
ok(await page.locator(".tray .thumb").count() === 5, "komposer: 5 media (4 foto/video + 1 suara)");
const rands = page.locator(".thumb-rand");
const nR = await rands.count();
// matikan semua dulu, lalu nyalakan foto ke-2 (portrait) dan audio
for (let i = 0; i < nR; i++) { if ((await rands.nth(i).getAttribute("aria-pressed")) === "true") await rands.nth(i).click(); }
await rands.nth(1).click(); await rands.nth(nR - 1).click();
// pindahkan item 2 ke posisi 1 (urutan)
await page.locator(".thumb-move button").nth(0).waitFor({ state: "attached" });
await page.click(".post-btn");
await page.waitForFunction(() => document.querySelectorAll(".feed-list .post").length >= 1, null, { timeout: 15000 });
await page.waitForTimeout(1200);
ok(await page.locator(".feed-list .post .carousel").count() === 1, "feed: 1 carousel");
ok(await page.locator(".feed-list .post .car-slide").count() === 4, "carousel: 4 slide (foto+video), bukan grid");
ok(await page.locator(".feed-list .post .photo-grid").count() === 0, "tidak ada grid foto");
ok((await page.locator(".car-count").first().innerText()).trim() === "1/4", "penghitung 1/4");
// geser
await page.evaluate(() => { const tr = document.querySelector(".car-track"); tr.scrollTo({ left: tr.clientWidth * 2, behavior: "instant" }); });
await page.waitForTimeout(500);
ok((await page.locator(".car-count").first().innerText()).trim() === "3/4", "geser → 3/4");
// video natural (tidak dipotong)
const fit = await page.evaluate(() => getComputedStyle(document.querySelector(".video-player video")).objectFit);
ok(fit === "contain", "video object-fit contain (tidak dipotong): " + fit);
// autoplay video di slide aktif
await page.waitForTimeout(800);
const playing = await page.evaluate(() => [...document.querySelectorAll(".carousel video")].some((v) => !v.paused));
ok(playing, "video slide aktif otomatis diputar");
// zoom foto
await page.evaluate(() => { const tr = document.querySelector(".car-track"); tr.scrollTo({ left: 0, behavior: "instant" }); });
await page.waitForTimeout(500);
await page.click(".car-photo");
await page.waitForSelector(".viewer.in");
await page.click(".vw-btn:has-text('+')"); await page.waitForTimeout(400);
const tf = await page.evaluate(() => document.querySelector(".vw-stage img").style.transform);
ok(/scale\(1\.[5-9]|scale\([2-9]/.test(tf), "viewer zoom + : " + tf);
await page.dblclick(".vw-stage", { position: { x: 100, y: 200 } }); await page.waitForTimeout(400);
await page.keyboard.press("Escape"); await page.waitForTimeout(500);

// --- Beranda tidak kosong setelah pindah halaman + refreshMe
await page.click(".tab-link:has-text('Acak')"); await page.waitForTimeout(700);
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // memicu refreshMe seperti saat kembali ke app
await page.waitForTimeout(500);
// Acak: 1 item saja, hanya yang dipilih (foto portrait atau suara)
const seen = new Set();
for (let i = 0; i < 12; i++) {
  await page.click(".rand-btn"); await page.waitForSelector(".rand-stage .post", { timeout: 8000 }); await page.waitForTimeout(1000);
  const info = await page.evaluate(() => { const c = document.querySelector(".rand-stage .post"); return { slides: c.querySelectorAll(".car-slide").length, audio: c.querySelectorAll(".audio-player").length, video: c.querySelectorAll("video").length, img: c.querySelectorAll(".car-photo img").length }; });
  seen.add(info.img ? "foto" : info.audio ? "audio" : info.video ? "video" : "?");
  if (info.slides + info.audio > 1 || info.video) { ok(false, "Acak muncul >1 media / video yg tidak dipilih: " + JSON.stringify(info)); break; }
}
ok([...seen].every((x) => x === "foto" || x === "audio"), "Acak hanya memunculkan media yang dipilih, 1 per kali: " + [...seen]);
ok(seen.size === 2, "Acak benar-benar acak (foto & audio keduanya pernah muncul)");
await page.click(".tab-link:has-text('Beranda')"); await page.waitForTimeout(800);
ok(await page.locator(".feed-list .post").count() === 1, "Beranda tetap berisi post setelah pindah halaman");

// --- PP: editor + hitam tetap hitam
await page.goto(`${B}/#/settings/account`); await page.waitForSelector(".avatar-edit");
await page.setInputFiles('input[type=file][accept="image/*"]', T + "pp_black.png");
await page.waitForSelector(".ae-stage"); await page.waitForTimeout(600);
ok(await page.locator(".ae-previews canvas").count() === 2, "editor PP: ada pratinjau");
await page.locator(".ae-range").evaluate((el) => { el.value = "300"; el.dispatchEvent(new Event("input")); });
const stage = await page.locator(".ae-stage").boundingBox();
await page.mouse.move(stage.x + 100, stage.y + 100); await page.mouse.down(); await page.mouse.move(stage.x + 140, stage.y + 130, { steps: 5 }); await page.mouse.up();
await page.click(".ae .btn.primary"); await page.waitForTimeout(1200);
const px = await page.evaluate(async () => {
  const img = document.querySelector(".avatar-tap img"); if (!img) return null;
  await img.decode(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
  const d = x.getImageData(c.width / 2, c.height / 2, 1, 1).data; return [...d, img.naturalWidth];
});
ok(px && px[0] < 8 && px[1] < 8 && px[2] < 8 && px[3] === 255, "PP hitam tetap hitam: " + JSON.stringify(px));
await page.click(".avatar-tap"); await page.waitForSelector(".viewer.in"); ok(true, "PP bisa dipratinjau/zoom"); await page.keyboard.press("Escape");
ok(await page.locator(".av-actions button:has-text('Atur posisi')").count() === 1, "tombol Atur posisi tersedia");

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "tidak ada error konsol");
await browser.close();
