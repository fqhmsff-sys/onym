import { launch } from "./lib.mjs";
import { B, signup, post } from "./helpers.mjs";
const A = await launch(); const C = await launch();
await signup(A.page, "ani", "Ani Wijaya");
await post(A.page, { text: "Post publik Ani" });
await post(A.page, { text: "Hanya pengikut", vis: "Pengikut" });
await post(A.page, { text: "Hanya hubungan", vis: "Hubungan" });
await signup(C.page, "budi", "Budi Santoso");
// Budi melihat profil Ani sebagai orang asing
await C.page.goto(`${B}/#/u/ani`); await C.page.waitForSelector(".profile-head"); await C.page.waitForTimeout(1200);
const seen = async () => (await C.page.locator(".tab-body .post-body").allTextContents());
console.log("asing melihat:", await seen());
// ikuti
await C.page.click(".btn.follow"); await C.page.waitForTimeout(500);
await C.page.reload(); await C.page.waitForSelector(".profile-head"); await C.page.waitForTimeout(1500);
console.log("pengikut melihat:", await seen());
// minta hubungan Sahabat
await C.page.click(".profile-actions .btn.ghost"); await C.page.waitForSelector(".rel-pick"); await C.page.waitForTimeout(500);
await C.page.screenshot({ path: "/tmp/onym-e2e-40-rel-pick.png" });
await C.page.click('.vis-card:has-text("Sahabat")'); await C.page.waitForTimeout(800);
await C.page.reload(); await C.page.waitForSelector(".profile-head"); await C.page.waitForTimeout(1500);
console.log("setelah diminta (belum diterima):", await seen());
// Ani melihat notifikasi & menerima
await A.page.goto(`${B}/#/notifications`); await A.page.waitForSelector(".notif"); await A.page.waitForTimeout(1000);
await A.page.screenshot({ path: "/tmp/onym-e2e-41-notif.png" });
const texts = await A.page.locator(".notif-t").allTextContents(); console.log("notif Ani:", texts);
await A.page.click(".notif .btn.primary"); await A.page.waitForTimeout(900);
await C.page.reload(); await C.page.waitForSelector(".profile-head"); await C.page.waitForTimeout(1500);
console.log("setelah diterima:", await seen());
await C.page.screenshot({ path: "/tmp/onym-e2e-42-budi-view-ani.png" });
await C.page.goto(`${B}/#/relations`); await C.page.waitForTimeout(1200); await C.page.screenshot({ path: "/tmp/onym-e2e-43-relations.png" });
// feed "Mengikuti" Budi
await C.page.goto(`${B}/#/`); await C.page.waitForSelector(".composer"); await C.page.click('.tabs .tab:has-text("Mengikuti")'); await C.page.waitForTimeout(1400);
console.log("feed mengikuti Budi:", await C.page.locator(".feed-list .post-body").allTextContents());
// pencarian
await C.page.goto(`${B}/#/search`); await C.page.waitForSelector(".search-input"); await C.page.fill(".search-input", "ani"); await C.page.waitForTimeout(1400); await C.page.screenshot({ path: "/tmp/onym-e2e-44-search.png" });
// putuskan hubungan
await A.page.goto(`${B}/#/relations`); await A.page.waitForTimeout(1200);
await A.page.click(".user-row .icon-btn"); await A.page.waitForTimeout(400); await A.page.click('.menu-item:has-text("Putuskan")'); await A.page.waitForTimeout(400); await A.page.click(".dialog .btn.danger"); await A.page.waitForTimeout(900);
await C.page.goto(`${B}/#/u/ani`); await C.page.waitForSelector(".profile-head"); await C.page.waitForTimeout(1500);
console.log("setelah diputus:", await seen());
const errs = [...A.errors, ...C.errors].filter((e) => !e.includes("ERR_ABORTED"));
console.log("ERRORS:", errs.join("\n") || "none");
await A.browser.close(); await C.browser.close();
