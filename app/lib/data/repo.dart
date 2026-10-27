import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../core/config.dart';
import '../core/util.dart';
import 'cache.dart';
import 'models.dart';

/// Dinaikkan setelah posting baru → beranda memuat ulang.
final ValueNotifier<int> feedRefresh = ValueNotifier<int>(0);

class ApiException implements Exception {
  final String code; final int status;
  ApiException(this.code, [this.status = 0]);
  @override
  String toString() => code;
}

class _Signed { final String url; final DateTime until; _Signed(this.url, this.until); }

/// Pintu data aplikasi — SEMUA lewat Worker /api (akun & sesi di D1, isi sosial di Neon, linimasa/notifikasi/foto di MongoDB, video/audio di Supabase).
/// Kata sandi TIDAK PERNAH dikirim: diolah di perangkat dengan PBKDF2-SHA256 (600.000 putaran); server hanya menerima kunci-turunannya.
class Repo extends ChangeNotifier {
  Repo._();
  static final Repo i = Repo._();
  final _store = const FlutterSecureStorage();

  Me? me; String? _access, _refresh; DateTime _exp = DateTime.fromMillisecondsSinceEpoch(0);
  /// Kode pemulihan yang baru dibuat — harus ditampilkan SEKALI kepada pengguna.
  List<String>? pendingCodes;
  bool get signedIn => _refresh != null && me != null;
  String get uid => me!.id;
  Completer<void>? _refreshing;

  Future<void> init() async {
    _refresh = await _store.read(key: 'rt');
    if (_refresh != null) {
      try { await _refreshTokens(); await _loadMe(); }
      on ApiException catch (e) { if (e.status == 401 || e.status == 403) await _clear(); }
      catch (_) { final c = LocalCache.get('me'); if (c is Map) me = Me('${c['id']}', '${c['username']}', '${c['display_name']}'); } // offline: tetap masuk dengan salinan lokal
    }
  }

  // ------------------------------------------------------------ jaringan
  Future<dynamic> _raw(String method, String path, {Object? body, Map<String, String>? headers, String? token, Duration timeout = const Duration(seconds: 20)}) async {
    final h = <String, String>{if (body is Map || body == null && method != 'GET') 'content-type': 'application/json', if (token != null) 'authorization': 'Bearer $token', ...?headers};
    final uri = Uri.parse(Cfg.api(path));
    final Object? b = body is Map ? jsonEncode(body) : (body ?? (method == 'GET' ? null : '{}'));
    final Future<http.Response> f = switch (method) {
      'GET' => http.get(uri, headers: h),
      'POST' => http.post(uri, headers: h, body: b),
      'PUT' => http.put(uri, headers: h, body: b),
      'PATCH' => http.patch(uri, headers: h, body: b),
      'DELETE' => http.delete(uri, headers: h, body: b),
      _ => throw ApiException('method'),
    };
    final r = await f.timeout(timeout);
    if (r.statusCode >= 200 && r.statusCode < 300) return r.body.isEmpty ? null : jsonDecode(utf8.decode(r.bodyBytes));
    String code = 'http_${r.statusCode}';
    try { code = (jsonDecode(r.body) as Map)['error'] as String? ?? code; } catch (_) {}
    throw ApiException(code, r.statusCode);
  }

  Future<void> _refreshTokens() async {
    if (_refreshing != null) return _refreshing!.future;
    final c = _refreshing = Completer<void>();
    try {
      final j = await _raw('POST', '/api/auth/refresh', body: {'refresh': _refresh}) as Map;
      await _setTokens(j['tokens'] as Map); c.complete();
    } catch (e) { c.completeError(e); rethrow; } finally { _refreshing = null; }
  }
  Future<void> _setTokens(Map t) async {
    _access = t['access'] as String; _refresh = t['refresh'] as String; _exp = DateTime.now().add(Duration(seconds: (t['expiresIn'] as num).toInt() - 30));
    await _store.write(key: 'rt', value: _refresh);
  }
  Future<void> _clear() async { _access = null; _refresh = null; me = null; await _store.delete(key: 'rt'); await LocalCache.clear(); notifyListeners(); }

  Future<dynamic> _api(String method, String path, {Object? body, bool auth = true}) async {
    if (!auth) return _raw(method, path, body: body);
    if (_refresh == null) throw ApiException('unauthorized', 401);
    if (_access == null || DateTime.now().isAfter(_exp)) await _refreshTokens();
    try { return await _raw(method, path, body: body, token: _access); }
    on ApiException catch (e) {
      if (e.status != 401) rethrow;
      try { await _refreshTokens(); } on ApiException catch (r) { if (r.status == 401 || r.status == 403) await _clear(); throw ApiException('unauthorized', 401); }
      return _raw(method, path, body: body, token: _access);
    }
  }
  Future<dynamic> _get(String path, {bool auth = true}) => _api('GET', path, auth: auth);
  String _q(String? cursor) => cursor == null ? '' : '?cursor=${Uri.encodeQueryComponent(cursor)}';

  Future<Map<String, String>> config() async {
    try { final j = await _api('GET', '/api/config', auth: false) as Map; final m = {for (final e in j.entries) '${e.key}': '${e.value}'}; await LocalCache.put('config', m); return m; }
    catch (_) { final c = LocalCache.get('config'); return c is Map ? {for (final e in c.entries) '${e.key}': '${e.value}'} : {}; }
  }

  // ------------------------------------------------------------ akun (kata sandi diolah DI PERANGKAT)
  Future<Uint8List> _kdf(String password, List<int> salt, int iterations) async {
    final algo = Pbkdf2(macAlgorithm: Hmac.sha256(), iterations: iterations, bits: 256);
    final k = await algo.deriveKeyFromPassword(password: password, nonce: salt);
    return Uint8List.fromList(await k.extractBytes());
  }
  Uint8List _rand(int n) { final r = Random.secure(); return Uint8List.fromList(List<int>.generate(n, (_) => r.nextInt(256))); }

  Future<void> _afterAuth(Map j) async {
    await _setTokens(j['tokens'] as Map);
    final u = j['user'] as Map?; if (u != null) me = Me('${u['id']}', '${u['username']}', '${u['display_name']}'); else await _loadMe();
    await LocalCache.put('me', {'id': me!.id, 'username': me!.username, 'display_name': me!.displayName});
    notifyListeners();
  }
  Future<void> _loadMe() async { final j = await _api('GET', '/api/me') as Map; me = Me('${j['id']}', '${j['username']}', '${j['display_name']}'); await LocalCache.put('me', {'id': me!.id, 'username': me!.username, 'display_name': me!.displayName}); }

  Future<void> register(String username, String displayName, String password, DateTime birthDate) async {
    final salt = _rand(16); final key = await _kdf(password, salt, Cfg.kdfIterations);
    final j = await _api('POST', '/api/auth/register', auth: false, body: {'username': username, 'displayName': displayName, 'birthDate': '${birthDate.year.toString().padLeft(4, '0')}-${birthDate.month.toString().padLeft(2, '0')}-${birthDate.day.toString().padLeft(2, '0')}', 'salt': base64.encode(salt), 'key': base64.encode(key)}) as Map;
    pendingCodes = [for (final c in (j['recovery_codes'] as List)) '$c'];
    await _afterAuth(j);
  }
  Future<void> login(String username, String password) async {
    final s = await _api('POST', '/api/auth/salt', auth: false, body: {'username': username}) as Map;
    final key = await _kdf(password, base64.decode(s['salt'] as String), (s['iterations'] as num?)?.toInt() ?? Cfg.kdfIterations);
    await _afterAuth(await _api('POST', '/api/auth/login', auth: false, body: {'username': username, 'key': base64.encode(key)}) as Map);
  }
  Future<void> recover(String username, String code, String newPassword) async {
    final salt = _rand(16); final key = await _kdf(newPassword, salt, Cfg.kdfIterations);
    final j = await _api('POST', '/api/auth/recover', auth: false, body: {'username': username, 'code': code, 'salt': base64.encode(salt), 'key': base64.encode(key)}) as Map;
    pendingCodes = [for (final c in (j['recovery_codes'] as List)) '$c'];
    await _afterAuth(j);
  }
  Future<void> changePassword(String oldPassword, String newPassword) async {
    final s = await _api('POST', '/api/auth/salt', auth: false, body: {'username': me!.username}) as Map;
    final oldKey = await _kdf(oldPassword, base64.decode(s['salt'] as String), (s['iterations'] as num?)?.toInt() ?? Cfg.kdfIterations);
    final salt = _rand(16); final key = await _kdf(newPassword, salt, Cfg.kdfIterations);
    await _api('POST', '/api/auth/password', body: {'oldKey': base64.encode(oldKey), 'salt': base64.encode(salt), 'key': base64.encode(key)});
  }
  void codesShown() { pendingCodes = null; notifyListeners(); }
  Future<void> logout() async { final r = _refresh; try { if (r != null) await _raw('POST', '/api/auth/logout', body: {'refresh': r}); } catch (_) {} await _clear(); }
  Future<void> logoutAll() async { try { await _api('POST', '/api/auth/logout-all'); } catch (_) {} await _clear(); }
  Future<void> deleteAccount() async { await _api('DELETE', '/api/me'); await _clear(); }

  // ------------------------------------------------------------ media (foto: MongoDB · video/audio: Supabase · semua lewat URL bertanda tangan)
  final Map<String, _Signed> _urls = {};
  String? urlFor(String? key) { if (key == null) return null; final s = _urls[key]; return (s != null && s.until.isAfter(DateTime.now())) ? s.url : null; }
  Future<void> sign(Iterable<String?> keys) async {
    final need = keys.whereType<String>().where((k) => k.contains('/') && urlFor(k) == null).toSet().toList();
    for (var i = 0; i < need.length; i += 24) {
      try {
        final j = await _api('POST', '/api/media/sign', body: {'keys': need.sublist(i, min(i + 24, need.length))}) as Map;
        final until = DateTime.now().add(Duration(seconds: ((j['ttl'] as num?)?.toInt() ?? 3300)));
        (j['urls'] as Map).forEach((k, v) { final u = '$v'; _urls['$k'] = _Signed(u.startsWith('/') ? Cfg.api(u) : u, until); });
      } catch (_) {}
    }
  }
  Future<void> signPosts(Iterable<Post> ps) => sign([for (final p in ps) ...p.media.map((m) => m.key)]);
  String? avatarUrl(String? key) => key == null ? null : Cfg.api('/api/avatar/$key');

  Future<MediaItem> uploadPhoto(Uint8List bytes, {int w = 0, int h = 0}) async {
    if (_access == null || DateTime.now().isAfter(_exp)) await _refreshTokens();
    final r = await http.post(Uri.parse(Cfg.api('/api/media/photo')), headers: {'authorization': 'Bearer $_access', 'content-type': 'image/jpeg'}, body: bytes).timeout(const Duration(seconds: 60));
    if (r.statusCode != 201) throw ApiException(_errCode(r), r.statusCode);
    return MediaItem(kind: 'photo', key: (jsonDecode(r.body) as Map)['key'] as String, w: w, h: h);
  }
  Future<String> uploadAvatar(Uint8List bytes) async {
    if (_access == null || DateTime.now().isAfter(_exp)) await _refreshTokens();
    final r = await http.post(Uri.parse(Cfg.api('/api/avatar')), headers: {'authorization': 'Bearer $_access', 'content-type': 'image/jpeg'}, body: bytes).timeout(const Duration(seconds: 30));
    if (r.statusCode != 201) throw ApiException(_errCode(r), r.statusCode);
    clearMe(); return (jsonDecode(r.body) as Map)["key"] as String;
  }
  /// Video / audio: minta URL bertanda tangan → unggah LANGSUNG ke Supabase Storage → konfirmasi (Worker memeriksa ukuran & isi berkas).
  Future<MediaItem> uploadFile(Uint8List bytes, String ext, String kind, {int w = 0, int h = 0, int d = 0}) async {
    final j = await _api('POST', '/api/media/upload-url', body: {'ext': ext, 'size': bytes.length}) as Map;
    final headers = {for (final e in (j['headers'] as Map).entries) '${e.key}': '${e.value}'};
    final r = await http.put(Uri.parse(j['url'] as String), headers: headers, body: bytes).timeout(const Duration(minutes: 5));
    if (r.statusCode < 200 || r.statusCode >= 300) throw ApiException('upload_failed', r.statusCode);
    await _api('POST', '/api/media/commit', body: {'key': j['key']});
    return MediaItem(kind: kind, key: j['key'] as String, w: w, h: h, d: d);
  }
  String _errCode(http.Response r) { try { return (jsonDecode(r.body) as Map)['error'] as String? ?? 'http_${r.statusCode}'; } catch (_) { return 'http_${r.statusCode}'; } }

  // ------------------------------------------------------------ umpan
  Future<Pg<Post>> _pg(Map j, {String? next}) async {
    final ps = [for (final r in (j['posts'] as List)) Post.fromRow(r as Map)]; await signPosts(ps);
    return Pg(ps, next ?? j['next'] as String?);
  }
  Future<Pg<Post>> feedLatest({String? cursor, int limit = 20}) async {
    try { final j = await _get('/api/feed/public?limit=$limit${cursor != null ? '&cursor=${Uri.encodeQueryComponent(cursor)}' : ''}', auth: false) as Map; if (cursor == null) await LocalCache.put('feed.latest', j['posts']); return _pg(j); }
    catch (e) { if (cursor == null) { final c = LocalCache.get('feed.latest'); if (c is List) return _pg({'posts': c, 'next': null}); } rethrow; }
  }
  Future<Pg<Post>> feedHome({String? cursor, int limit = 20}) async {
    try { final j = await _get('/api/feed/home?limit=$limit${cursor != null ? '&cursor=${Uri.encodeQueryComponent(cursor)}' : ''}') as Map; if (cursor == null) await LocalCache.put('feed.home', j['posts']); return _pg(j); }
    catch (e) { if (cursor == null) { final c = LocalCache.get('feed.home'); if (c is List) return _pg({'posts': c, 'next': null}); } rethrow; }
  }
  Future<Pg<Post>> random() async => _pg(await _get('/api/random?limit=10') as Map, next: 'more');
  Future<Pg<Post>> saved() async => _pg(await _get('/api/saves') as Map, next: null);
  Future<Pg<Post>> userPosts(String username, {String? cursor, int limit = 20}) async => _pg(await _get('/api/users/$username/posts?limit=$limit${cursor != null ? '&cursor=${Uri.encodeQueryComponent(cursor)}' : ''}') as Map);
  Future<Post?> post(String id) async {
    try { final j = await _get('/api/posts/$id') as Map; final p = Post.fromRow(j); await signPosts([p]); return p; }
    on ApiException catch (e) { if (e.status == 404) return null; rethrow; }
  }
  Future<List<Post>> searchPosts(String q) async => (await _pg(await _get('/api/search?type=posts&q=${Uri.encodeQueryComponent(q)}') as Map, next: null)).items;
  Future<List<UserLite>> searchUsers(String q) async { final j = await _get('/api/search?q=${Uri.encodeQueryComponent(q)}') as Map; return [for (final r in (j['users'] as List)) UserLite.fromRow(r as Map)]; }

  // ------------------------------------------------------------ posting
  Future<void> createPost({required String body, required List<MediaItem> media, required String visibility, required bool inRandom, String? id}) =>
    _api('POST', '/api/posts', body: {'id': id ?? uuidV4(), 'body': body, 'media': media.map((m) => m.toJson()).toList(), 'visibility': visibility, 'inRandom': inRandom});
  Future<void> editPost(String id, {String? body, String? visibility, bool? inRandom}) => _api('PATCH', '/api/posts/$id', body: {if (body != null) 'body': body, if (visibility != null) 'visibility': visibility, if (inRandom != null) 'inRandom': inRandom});
  Future<void> deletePost(Post p) => _api('DELETE', '/api/posts/${p.id}');
  Future<void> setStar(String id, bool on) => _api(on ? 'PUT' : 'DELETE', '/api/posts/$id/star');
  Future<void> setSave(String id, bool on) => _api(on ? 'PUT' : 'DELETE', '/api/posts/$id/save');
  Future<void> rate(String id, int? stars) => stars == null ? _api('DELETE', '/api/posts/$id/rating') : _api('PUT', '/api/posts/$id/rating', body: {'stars': stars});
  Future<void> view(String id) async { try { await _api('POST', '/api/posts/$id/view'); } catch (_) {} }
  Future<void> report(String postId, String reason, {String? note}) => _api('POST', '/api/posts/$postId/report', body: {'reason': reason, if (note != null && note.isNotEmpty) 'note': note});

  // ------------------------------------------------------------ komentar
  Future<List<Comment>> comments(String postId) async => [for (final r in ((await _get('/api/posts/$postId/comments') as Map)['items'] as List)) Comment.fromRow(r as Map)];
  Future<void> addComment(String postId, String body, {String? parentId}) => _api('POST', '/api/posts/$postId/comments', body: {'id': uuidV4(), 'body': body, if (parentId != null) 'parentId': parentId});
  Future<void> editComment(String id, String body) => _api('PATCH', '/api/comments/$id', body: {'body': body});
  Future<void> deleteComment(String id) => _api('DELETE', '/api/comments/$id');
  Future<void> likeComment(String id, bool on) => _api(on ? 'PUT' : 'DELETE', '/api/comments/$id/like');

  // ------------------------------------------------------------ profil & sosial
  Profile? _me;
  Future<Profile> myProfile({bool refresh = false}) async { if (_me != null && !refresh) return _me!; _me = (await profile(me!.username))!; return _me!; }
  void clearMe() => _me = null;
  Future<Profile?> profile(String username) async {
    try { return Profile.fromRow(await _get('/api/users/$username') as Map); } on ApiException catch (e) { if (e.status == 404) return null; rethrow; }
  }
  Future<Map<String, dynamic>> mySettings() async => Map<String, dynamic>.from(await _get('/api/me') as Map);
  Future<void> updateProfile(Map<String, dynamic> m) async {
    const map = {'display_name': 'displayName', 'bio': 'bio', 'birth_date': 'birthDate', 'birth_date_visibility': 'birthDateVisibility', 'default_visibility': 'defaultVisibility', 'relations_visibility': 'relationsVisibility', 'settings': 'settings'};
    await _api('PATCH', '/api/me', body: {for (final e in m.entries) if (map.containsKey(e.key)) map[e.key]!: e.value}); _me = null;
  }
  Future<void> follow(String username, bool on) => _api(on ? 'PUT' : 'DELETE', '/api/users/$username/follow');
  Future<void> block(String username, bool on) => _api(on ? 'PUT' : 'DELETE', '/api/users/$username/block');
  Future<Pg<UserLite>> followList(String username, String kind, {String? cursor}) async {
    final j = await _get('/api/users/$username/$kind${_q(cursor)}') as Map;
    return Pg([for (final r in (j['items'] as List)) UserLite.fromRow(r as Map)], j['next'] as String?);
  }
  Future<List<UserLite>> blockedUsers() async => [for (final r in ((await _get('/api/blocked') as Map)['items'] as List)) UserLite.fromRow(r as Map)];

  Future<void> requestRelation(String username, String kind) => _api('POST', '/api/relations', body: {'username': username, 'kind': kind});
  Future<List<Relation>> relations() async => [for (final r in ((await _get('/api/relations') as Map)['items'] as List)) Relation.fromRow(r as Map)];
  Future<void> approveRelation(String id) => _api('POST', '/api/relations/$id/approve');
  Future<void> removeRelation(String id) => _api('DELETE', '/api/relations/$id');

  // ------------------------------------------------------------ notifikasi
  Future<Pg<Notif>> notifications({String? cursor}) async {
    final j = await _get('/api/notifications${_q(cursor)}') as Map;
    return Pg([for (final e in (j['items'] as List)) Notif.fromJson(e as Map)], j['next'] as String?);
  }
  Future<int> unread() async { try { return ((await _get('/api/notifications/unread')) as Map)['count'] as int? ?? 0; } catch (_) { return 0; } }
  Future<void> markRead() async { try { await _api('POST', '/api/notifications/read'); } catch (_) {} }
}

String errText(Object e, String Function(String) t) {
  if (e is ApiException) {
    final k = 'err.${e.code}';
    final s = t(k); if (s != k) return s;
    if (e.status == 0 && e.code.isEmpty) return t('error');
  }
  if (e is TimeoutException) return t('err.timeout');
  if (kDebugMode) return '$e';
  return t('error');
}
