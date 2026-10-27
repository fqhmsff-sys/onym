import 'package:flutter/foundation.dart';

/// Alamat API = Worker Cloudflare yang menayangkan web. Tidak ada kunci/rahasia di aplikasi.
class Cfg {
  /// Web: kosong = satu domain dengan halaman. Android: WAJIB diisi saat build (--dart-define=API_BASE=https://...).
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: '');
  static const buildNumber = int.fromEnvironment('BUILD_NUMBER', defaultValue: 1);
  static const kdfIterations = 600000;

  static String api(String path) {
    if (apiBase.isNotEmpty) return '$apiBase$path';
    if (kIsWeb) return '${Uri.base.origin}$path';
    return 'https://INVALID.onym$path'; // Android tanpa API_BASE → gagal jelas, bukan diam-diam
  }
  static String get webOrigin => apiBase.isNotEmpty ? apiBase : (kIsWeb ? Uri.base.origin : '');
}
