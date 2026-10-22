export const B = "http://localhost:8787";
export async function signup(page, name, display = name) {
  await page.goto(`${B}/#/register`);
  await page.waitForSelector("#f-displayName");
  await page.fill("#f-displayName", display); await page.fill("#f-username", name); await page.fill("#f-password", "kata-sandi-kuat");
  await page.click(".input-btn"); await page.waitForTimeout(500); await page.click(".dp .btn.primary");
  await page.click(".auth-form button[type=submit]");
  await page.waitForSelector(".codes code"); await page.check("#rc-ok"); await page.click(".btn.primary.block");
  await page.waitForSelector(".composer");
}
export async function post(page, { text, files = [], vis }) {
  const n = await page.locator(".feed-list .post").count();
  await page.click(".composer"); await page.waitForSelector(".compose-text");
  if (text) await page.fill(".compose-text", text);
  for (const [sel, f] of files) await page.setInputFiles(`.compose input[type=file][accept="${sel}"]`, f);
  if (vis) { await page.click(".vis-chip"); await page.waitForTimeout(450); await page.click(`.vis-card:has-text("${vis}")`); await page.waitForTimeout(600); }
  await page.waitForTimeout(400);
  await page.click(".post-btn");
  await page.waitForFunction((n) => document.querySelectorAll(".feed-list .post").length > n, n, { timeout: 15000 });
  await page.waitForTimeout(900);
}
