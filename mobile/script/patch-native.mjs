// Dijalankan sekali setelah `cap add android|ios`: menambah izin kamera/mikrofon dan mengeraskan keamanan.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

if (target === "android") {
  const p = join(root, "android/app/src/main/AndroidManifest.xml");
  let x = readFileSync(p, "utf8");
  const perms = ["android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS", "android.permission.INTERNET"];
  for (const perm of perms) if (!x.includes(perm)) x = x.replace("<application", `<uses-permission android:name="${perm}" />\n    <application`);
  if (!x.includes("android.hardware.camera")) x = x.replace("<application", '<uses-feature android:name="android.hardware.camera" android:required="false" />\n    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n    <application');
  x = x.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
  if (!x.includes("usesCleartextTraffic")) x = x.replace("<application", '<application android:usesCleartextTraffic="false"');
  writeFileSync(p, x);
  console.log("Android: izin kamera/mikrofon ditambahkan, allowBackup dimatikan, cleartext dilarang.");
} else if (target === "ios") {
  const p = join(root, "ios/App/App/Info.plist");
  let x = readFileSync(p, "utf8");
  const add = {
    NSCameraUsageDescription: "Onym memakai kamera untuk mengambil foto dan merekam video singkat untuk postinganmu.",
    NSMicrophoneUsageDescription: "Onym memakai mikrofon untuk merekam suara dan audio video postinganmu.",
    NSPhotoLibraryUsageDescription: "Onym membuka galeri agar kamu bisa memilih foto dan video untuk diposting.",
  };
  for (const [k, v] of Object.entries(add)) if (!x.includes(k)) x = x.replace("</dict>\n</plist>", `\t<key>${k}</key>\n\t<string>${v}</string>\n</dict>\n</plist>`);
  writeFileSync(p, x);
  console.log("iOS: deskripsi izin kamera/mikrofon/galeri ditambahkan.");
} else { console.error("Pakai: node scripts/patch-native.mjs android|ios"); process.exit(1); }
void existsSync;
