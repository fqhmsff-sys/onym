"""Dijalankan setelah `flutter create`: izin, keamanan jaringan, minSdk 23 (diperlukan plugin rekam suara)."""
import re, pathlib
m = pathlib.Path('android/app/src/main/AndroidManifest.xml'); s = m.read_text(encoding='utf8')
perms = ['INTERNET', 'CAMERA', 'RECORD_AUDIO']
add = ''.join(f'    <uses-permission android:name="android.permission.{p}"/>\n' for p in perms if f'android.permission.{p}"' not in s)
add += '    <uses-feature android:name="android.hardware.camera" android:required="false"/>\n    <uses-feature android:name="android.hardware.camera.front" android:required="false"/>\n'
s = s.replace('<application', add + '    <application', 1)
s = re.sub(r'android:label="[^"]*"', 'android:label="Onym"', s, count=1)
s = s.replace('<application', '<application android:usesCleartextTraffic="false" android:allowBackup="false"', 1)
if '<queries>' in s:
    s = s.replace('<queries>', '<queries>\n        <intent><action android:name="android.media.action.IMAGE_CAPTURE"/></intent>\n        <intent><action android:name="android.media.action.VIDEO_CAPTURE"/></intent>', 1)
m.write_text(s, encoding='utf8')
for f in ['android/app/build.gradle.kts', 'android/app/build.gradle']:
    p = pathlib.Path(f)
    if p.exists():
        t = p.read_text(encoding='utf8')
        t2 = re.sub(r'minSdk(?:Version)?(\s*=\s*|\s+)flutter\.minSdkVersion', 'minSdk = 23', t)
        p.write_text(t2, encoding='utf8'); print('minSdk patched' if t2 != t else 'minSdk unchanged', f)
