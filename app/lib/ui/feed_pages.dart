import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/brand.dart';
import '../core/i18n.dart';
import '../data/models.dart';
import '../data/repo.dart';
import 'post_tile.dart';
import 'profile_page.dart';
import 'widgets.dart';

class _MenuIcon extends StatelessWidget {
  const _MenuIcon();
  @override
  Widget build(BuildContext context) { final c = Theme.of(context).colorScheme.onSurface; return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
    Container(width: 22, height: 2.6, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(2))), const SizedBox(height: 6),
    Container(width: 13, height: 2.6, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(2)))]); }
}

class HomeTab extends StatefulWidget {
  const HomeTab({super.key});
  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> {
  int _feed = 0; final _a = PagedController<Post>(), _b = PagedController<Post>();
  void _bump() { (_feed == 0 ? _a : _b).refresh(); }
  @override
  void initState() { super.initState(); feedRefresh.addListener(_bump); }
  @override
  void dispose() { feedRefresh.removeListener(_bump); super.dispose(); }
  Future<void> _menu() async {
    final v = await showModalBottomSheet<int>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Padding(padding: const EdgeInsets.all(8), child: Text(tr('feed.menu'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
      for (final e in [(0, tr('feed.foryou')), (1, tr('feed.latest'))]) ListTile(title: Text(e.$2), trailing: _feed == e.$1 ? const Icon(Icons.check) : null, onTap: () => Navigator.pop(c, e.$1)),
    ])));
    if (v != null && v != _feed) setState(() => _feed = v);
  }
  @override
  Widget build(BuildContext context) {
    final mute = Theme.of(context).colorScheme.onSurface.withValues(alpha: .45);
    return Column(children: [
      SizedBox(height: 52, child: Row(children: [
        IconButton(onPressed: _menu, tooltip: tr('feed.menu'), padding: const EdgeInsets.all(14), icon: const _MenuIcon()), const Spacer(),
        const OnymMark(height: 27), const Spacer(),
        IconButton(onPressed: () => context.push('/search'), tooltip: tr('feed.search'), icon: Icon(Icons.search, size: 27, color: mute)),
      ])),
      Expanded(child: _feed == 0
        ? PagedList<Post>(key: const ValueKey('f0'), controller: _a, load: (c) => Repo.i.feedHome(cursor: c), idOf: (p) => p.id, empty: tr('feed.empty'), item: (c, p) => PostTile(p, onDeleted: (x) => _a.removeWhere((e) => e.id == x.id)))
        : PagedList<Post>(key: const ValueKey('f1'), controller: _b, load: (c) => Repo.i.feedLatest(cursor: c), idOf: (p) => p.id, empty: tr('feed.empty'), item: (c, p) => PostTile(p, onDeleted: (x) => _b.removeWhere((e) => e.id == x.id)))),
    ]);
  }
}

// ===================================================================== Acak: kisi dua kolom, ringan & rapi
class RandomTab extends StatefulWidget {
  const RandomTab({super.key});
  @override
  State<RandomTab> createState() => _RandomState();
}

class _RandomState extends State<RandomTab> {
  final List<Post> _items = []; final _ids = <String>{}; final _sc = ScrollController(); bool _loading = false, _done = false; int _empty = 0; Object? _err;
  @override
  void initState() { super.initState(); _sc.addListener(() { if (_sc.position.pixels > _sc.position.maxScrollExtent - 700) _more(); }); _more(); }
  @override
  void dispose() { _sc.dispose(); super.dispose(); }
  Future<void> _reload() async { _items.clear(); _ids.clear(); _done = false; _empty = 0; _err = null; setState(() {}); await _more(); }
  Future<void> _more() async {
    if (_loading || _done) return; setState(() => _loading = true);
    try {
      final pg = await Repo.i.random(); var added = 0;
      for (final p in pg.items) { if (_ids.add(p.id)) { _items.add(p); added++; } }
      _empty = added == 0 ? _empty + 1 : 0; if (_empty >= 2) _done = true; _err = null;
    } catch (e) { _err = e; _done = true; }
    if (mounted) setState(() => _loading = false);
  }
  double _aspect(Post p) { final m = p.media.first; if (m.isPhoto && m.h > 0) return (m.w / m.h).clamp(0.72, 1.3).toDouble(); return m.isVideo ? 0.8 : 1.0; }
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Column(children: [
      Padding(padding: const EdgeInsets.fromLTRB(16, 10, 8, 6), child: Row(children: [
        Text(tr('rand.title'), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)), const Spacer(),
        IconButton(onPressed: _loading ? null : _reload, icon: const Icon(Icons.refresh_rounded, size: 26))])),
      Expanded(child: RefreshIndicator(onRefresh: _reload, child: _items.isEmpty
        ? ListView(physics: const AlwaysScrollableScrollPhysics(), children: [SizedBox(height: 360, child: _loading ? const Center(child: CircularProgressIndicator(strokeWidth: 2.5)) : _err != null ? Empty(tr('error'), onRetry: _reload) : Empty(tr('rand.empty')))])
        : LayoutBuilder(builder: (c, cons) {
            const gap = 8.0, pad = 12.0; final colW = (cons.maxWidth - pad * 2 - gap) / 2; final cols = [<Widget>[], <Widget>[]]; final hs = [0.0, 0.0];
            for (final p in _items) { final i = hs[0] <= hs[1] ? 0 : 1; final h = colW / _aspect(p); hs[i] += h + gap; cols[i].add(Padding(padding: const EdgeInsets.only(bottom: gap), child: _Tile(p, colW, h))); }
            return SingleChildScrollView(controller: _sc, physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(pad, 4, pad, 24), child: Column(children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: Column(children: cols[0])), const SizedBox(width: gap), Expanded(child: Column(children: cols[1]))]),
              if (_loading) Padding(padding: const EdgeInsets.all(16), child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: cs.onSurface))),
            ]));
          }))),
    ]);
  }
}

class _Tile extends StatelessWidget {
  final Post p; final double w, h;
  const _Tile(this.p, this.w, this.h);
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final m = p.media.first; final url = Repo.i.urlFor(m.key);
    return GestureDetector(onTap: () => context.push('/p/${p.id}', extra: p), child: ClipRRect(borderRadius: BorderRadius.circular(14), child: SizedBox(width: w, height: h, child: Stack(fit: StackFit.expand, children: [
      if (m.isPhoto) (url == null ? Container(color: cs.surfaceContainerHighest) : CachedNetworkImage(imageUrl: url, cacheKey: m.key, fit: BoxFit.cover, alignment: Alignment.topCenter, placeholder: (_, __) => Container(color: cs.surfaceContainerHighest), errorWidget: (_, __, ___) => Container(color: cs.surfaceContainerHighest)))
      else Container(color: m.isVideo ? const Color(0xFF161616) : cs.surfaceContainerHighest, child: Center(child: Icon(m.isVideo ? Icons.play_circle_fill : Icons.graphic_eq, size: 46, color: m.isVideo ? Colors.white : cs.onSurface.withValues(alpha: .6)))),
      Positioned(left: 0, right: 0, bottom: 0, child: Container(padding: const EdgeInsets.fromLTRB(10, 22, 10, 9), decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Color(0x99000000)])),
        child: Row(children: [Expanded(child: Text('@${p.authorHandle}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12.5))),
          if (p.media.length > 1) const Icon(Icons.collections_outlined, size: 15, color: Colors.white), const SizedBox(width: 6), const Icon(Icons.favorite, size: 13, color: Colors.white), const SizedBox(width: 3), Text('${p.stars}', style: const TextStyle(color: Colors.white, fontSize: 12))]))),
    ]))));
  }
}

class SavedPage extends StatelessWidget {
  const SavedPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(tr('set.saved'))),
    body: PagedList<Post>(load: (_) => Repo.i.saved(), idOf: (p) => p.id, empty: tr('feed.empty'), item: (c, p) => PostTile(p)));
}

class SearchPage extends StatefulWidget {
  const SearchPage({super.key});
  @override
  State<SearchPage> createState() => _SearchState();
}

class _SearchState extends State<SearchPage> with SingleTickerProviderStateMixin {
  final _q = TextEditingController(); late final TabController _tc = TabController(length: 2, vsync: this); Timer? _d;
  String _term = ''; List<UserLite> _users = []; List<Post> _posts = []; bool _busy = false; String? _err;
  @override
  void dispose() { _d?.cancel(); _tc.dispose(); _q.dispose(); super.dispose(); }
  void _changed(String v) { _d?.cancel(); _d = Timer(const Duration(milliseconds: 380), () => _run(v.trim())); }
  Future<void> _run(String q) async {
    if (q.length < 2) { setState(() { _term = q; _users = []; _posts = []; _err = null; }); return; }
    setState(() { _busy = true; _term = q; _err = null; });
    try {
      final r = await Future.wait([Repo.i.searchUsers(q), Repo.i.searchPosts(q)]);
      if (!mounted || _term != q) return;
      setState(() { _users = r[0] as List<UserLite>; _posts = r[1] as List<Post>; });
    } catch (e) { if (mounted) setState(() => _err = errText(e, tr)); }
    if (mounted) setState(() => _busy = false);
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(titleSpacing: 0, title: Padding(padding: const EdgeInsets.only(right: 14), child: TextField(controller: _q, autofocus: true, onChanged: _changed, textInputAction: TextInputAction.search,
        decoration: InputDecoration(hintText: tr('s.hint'), prefixIcon: const Icon(Icons.search), contentPadding: const EdgeInsets.symmetric(vertical: 10)))), bottom: TabBar(controller: _tc, tabs: [Tab(text: tr('s.people')), Tab(text: tr('s.posts'))])),
    body: _term.length < 2 ? Empty(tr('s.min')) : _err != null ? Empty(_err!) : TabBarView(controller: _tc, children: [
      _users.isEmpty ? Empty(_busy ? tr('loading') : tr('s.none')) : ListView(children: [for (final u in _users) UserRow(u)]),
      _posts.isEmpty ? Empty(_busy ? tr('loading') : tr('s.none')) : ListView.separated(itemCount: _posts.length, separatorBuilder: (_, __) => const Divider(height: 1), itemBuilder: (c, i) => PostTile(_posts[i])),
    ]));
}
