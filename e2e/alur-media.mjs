import { launch } from "./lib.mjs";
import { B, signup, post } from "./helpers.mjs";
import { execSync } from "node:child_process";
execSync("ffmpeg -v error -y -f lavfi -i color=c=0x87958D:s=800x600 -frames:v 1 /tmp/onym-e2e-foto.jpg");
execSync("ffmpeg -v error -y -f lavfi -i color=c=0xB6A58A:s=400x300 -frames:v 1 /tmp/onym-e2e-foto2.png");
execSync("ffmpeg -v error -y -f lavfi -i sine=frequency=330:duration=3 -c:a libmp3lame /tmp/onym-e2e-nada.mp3");
execSync("ffmpeg -v error -y -f lavfi -i testsrc=s=320x240:r=15:d=4 -f lavfi -i sine=d=4 -c:v libvpx -c:a libopus -shortest /tmp/onym-e2e-pendek.webm");
const { browser, ctx, page, errors } = await launch();
const sh = async (n, w = 500) => { await page.waitForTimeout(w); await page.screenshot({ path: `/tmp/onym-e2e-${n}.png` }); };
await signup(page, "faqih", "Faqih Musyaffa");
await post(page, { text: "Halo Onym! Ini post teks pertama.\nSeperti di X atau Threads." });
await post(page, { text: "Dua foto", files: [["image/*", ["/tmp/onym-e2e-foto.jpg", "/tmp/onym-e2e-foto2.png"]]] });
await post(page, { text: "Video + audio + foto campur", files: [["video/*", "/tmp/onym-e2e-pendek.webm"], ["audio/*", "/tmp/onym-e2e-nada.mp3"], ["image/*", "/tmp/onym-e2e-foto.jpg"]] });
await post(page, { text: "Rahasia hubungan", vis: "Hubungan" });
await page.evaluate(() => window.scrollTo(0, 0));
await sh("20-feed", 1200);

// Putar audio di kartu
const ap = page.locator(".feed-list .audio-player .ap-btn").first();
await ap.scrollIntoViewIfNeeded();
await ap.click(); await page.waitForTimeout(1200);
console.log("audio state:", await page.locator(".feed-list .audio-player").first().getAttribute("data-state"));
await ap.click(); await page.waitForTimeout(300);
console.log("audio after pause:", await page.locator(".feed-list .audio-player").first().getAttribute("data-state"));
// putar video
const vp = page.locator(".feed-list .video-player").first();
await vp.scrollIntoViewIfNeeded(); await vp.click(); await page.waitForTimeout(1500);
console.log("video playing class:", await vp.evaluate((e) => e.classList.contains("playing")), "| audio state now:", await page.locator(".feed-list .audio-player").first().getAttribute("data-state"));
await sh("21-video-playing", 200);
await vp.click();
// rating bintang
const star = page.locator(".feed-list .post").first().locator(".star").nth(3);
await star.scrollIntoViewIfNeeded(); await star.click(); await page.waitForTimeout(150); await sh("22-star-burst", 0); await page.waitForTimeout(700);
console.log("rating text:", await page.locator(".feed-list .post").first().locator(".rating-text").textContent());
// simpan
await page.locator(".feed-list .post").first().locator(".act.save").click(); await page.waitForTimeout(400);
// komentar
await page.locator(".feed-list .post").first().locator('.act[aria-label="Komentar"]').click();
await page.waitForSelector(".c-input"); await page.fill(".c-input", "Komentar pertama!"); await page.click(".comment-bar .send");
await page.waitForSelector(".comment"); await sh("23-comments", 900);
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
// foto lightbox
const cell = page.locator(".photo-cell").first(); await cell.scrollIntoViewIfNeeded(); await cell.click(); await sh("24-lightbox", 700);
await page.keyboard.press("Escape"); await page.waitForTimeout(500);

// Acak
await page.click('.tab-link[href="#/random"]'); await page.waitForTimeout(900); await sh("25-random-idle", 200);
await page.click(".rand-btn"); await page.waitForTimeout(300); await sh("26-random-drawing", 0);
await page.waitForSelector(".random .post", { timeout: 6000 }); await sh("27-random-result", 900);
console.log("random has media:", await page.locator(".random .post .post-media").count());
for (let i = 0; i < 6; i++) { await page.click(".rand-btn"); await page.waitForSelector(".random .post.flip-in"); const hasMedia = await page.locator(".random .post .post-media").count(); if (!hasMedia) console.log("RANDOM TEXT BUG"); await page.waitForTimeout(600); }
// Profil
await page.click('.tab-link[href="#/me"]'); await page.waitForSelector(".profile-head"); await sh("28-profile", 1200);
await page.click('.tabs .tab:has-text("Tersimpan")'); await sh("29-saved", 900);
// Pengaturan
await page.goto(`${B}/#/settings`); await sh("30-settings", 1000);
await page.goto(`${B}/#/settings/privacy`); await sh("31-privacy", 900);
await page.goto(`${B}/#/settings/theme`); await page.waitForTimeout(500); await page.click(".theme-card >> nth=1"); await page.waitForTimeout(900);
await page.goto(`${B}/#/`); await page.waitForTimeout(1500); await sh("32-dark-feed", 500);
await page.goto(`${B}/#/about`); await sh("33-about-dark", 900);
console.log("ERRORS:", errors.filter((e) => !e.includes("ERR_ABORTED")).join("\n") || "none");
await browser.close();
