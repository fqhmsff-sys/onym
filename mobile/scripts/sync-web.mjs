import { cp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(here, "..");
const repoRoot = resolve(mobileDir, "..");
const source = resolve(repoRoot, "web");
const target = resolve(mobileDir, "www");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const apiUrl = (process.env.ONYM_API_URL || "").trim();
if (apiUrl) {
  const configPath = resolve(target, "config.js");
  let existing = "";
  try { existing = await readFile(configPath, "utf8"); } catch {}
  const injected = `window.ONYM_API_URL = ${JSON.stringify(apiUrl)};\n`;
  await writeFile(configPath, injected + existing, "utf8");
}

console.log(`Onym web disalin ke mobile/www${apiUrl ? " dengan API URL." : " dalam mode lokal."}`);
