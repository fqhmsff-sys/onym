#!/usr/bin/env bash
# Membuat folder android/ (dan web/ yang belum ada) lalu menerapkan pengaturan Onym. Aman dijalankan berulang.
set -euo pipefail
flutter create --platforms=android,web --project-name onym --org id.onym . > /dev/null
python3 tool/patch_android.py
flutter pub get
dart run flutter_launcher_icons
