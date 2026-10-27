import 'package:flutter/material.dart';
import '../data/cache.dart';
import 'i18n.dart';

class AppSettings extends ChangeNotifier {
  ThemeMode theme = ThemeMode.system;
  String lang = 'id';
  bool motion = true;
  Map<String, String> remote = {}; // dari D1 lewat /api/config

  void load() {
    final s = LocalCache.get('settings');
    if (s is Map) {
      theme = {'light': ThemeMode.light, 'dark': ThemeMode.dark}[s['theme']] ?? ThemeMode.system;
      lang = s['lang'] == 'en' ? 'en' : 'id';
      motion = s['motion'] != false;
    }
    L10n.lang = lang;
  }
  Future<void> _save() => LocalCache.put('settings', {'theme': theme == ThemeMode.light ? 'light' : theme == ThemeMode.dark ? 'dark' : 'system', 'lang': lang, 'motion': motion});
  void setTheme(ThemeMode m) { theme = m; _save(); notifyListeners(); }
  void setLang(String l) { lang = l; L10n.lang = l; _save(); notifyListeners(); }
  void setMotion(bool v) { motion = v; _save(); notifyListeners(); }
  void setRemote(Map<String, String> r) { remote = r; notifyListeners(); }
  bool flag(String k) => (remote['flag_$k'] ?? '1') != '0';
}

final AppSettings appSettings = AppSettings();
