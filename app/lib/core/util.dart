import 'dart:math';

String uuidV4() {
  final r = Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
  return '${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}';
}

final usernameRe = RegExp(r'^[a-z0-9_]{3,20}$');
final emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

String normTs(String s) => s.replaceFirst('+00:00', 'Z');

String ago(String iso, String Function(String) t) {
  final d = DateTime.tryParse(iso);
  if (d == null) return '';
  final s = DateTime.now().toUtc().difference(d.toUtc()).inSeconds;
  if (s < 60) return t('time.now');
  if (s < 3600) return '${s ~/ 60}${t('time.m')}';
  if (s < 86400) return '${s ~/ 3600}${t('time.h')}';
  if (s < 86400 * 30) return '${s ~/ 86400}${t('time.d')}';
  final l = d.toLocal();
  return '${l.day}/${l.month}/${l.year}';
}

String fmtDur(int ms) {
  final s = (ms / 1000).round();
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}
