import 'dart:convert';
import 'package:hive_ce_flutter/hive_flutter.dart';

/// Salinan lokal di perangkat (HP & browser): dibuka dulu dari sini, jaringan hanya menyegarkan.
class LocalCache {
  static late Box<String> _box;
  static Future<void> init() async { await Hive.initFlutter(); _box = await Hive.openBox<String>('onym'); }
  static dynamic get(String k) { final s = _box.get(k); if (s == null) return null; try { return jsonDecode(s); } catch (_) { return null; } }
  static Future<void> put(String k, Object? v) => _box.put(k, jsonEncode(v));
  static Future<void> remove(String k) => _box.delete(k);
  static Future<void> clear() => _box.clear();
}
