import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../core/i18n.dart';
import '../data/models.dart';
import '../data/repo.dart';

void toast(BuildContext c, String msg) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 3)));

Future<bool> confirm(BuildContext c, String msg, {String? ok}) async =>
    await showDialog<bool>(context: c, builder: (_) => AlertDialog(content: Text(msg), actions: [
      TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('cancel'))),
      TextButton(onPressed: () => Navigator.pop(c, true), child: Text(ok ?? tr('ok'))),
    ])) ?? false;

class Avatar extends StatelessWidget {
  final String? keyPath; final String name; final double size;
  const Avatar({super.key, this.keyPath, required this.name, this.size = 40});
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final url = Repo.i.avatarUrl(keyPath);
    return Container(width: size, height: size, decoration: BoxDecoration(shape: BoxShape.circle, color: cs.surfaceContainerHighest),
      clipBehavior: Clip.antiAlias, alignment: Alignment.center,
      child: url != null ? CachedNetworkImage(imageUrl: url, cacheKey: keyPath, fit: BoxFit.cover, width: size, height: size, errorWidget: (_, __, ___) => _ini(cs))
          : _ini(cs));
  }
  Widget _ini(ColorScheme cs) => Text(name.isEmpty ? '?' : String.fromCharCode(name.runes.first).toUpperCase(), style: TextStyle(fontWeight: FontWeight.w800, fontSize: size * .42, color: cs.onSurface));
}

class Empty extends StatelessWidget {
  final String text; final VoidCallback? onRetry;
  const Empty(this.text, {super.key, this.onRetry});
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(32), child: Column(mainAxisSize: MainAxisSize.min, children: [
    Text(text, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.onSurface.withValues(alpha: .55))),
    if (onRetry != null) ...[const SizedBox(height: 12), OutlinedButton(onPressed: onRetry, child: Text(tr('retry')))],
  ])));
}

class PagedController<T> {
  _PagedListState<T>? _s;
  void refresh() => _s?._reload();
  void removeWhere(bool Function(T) f) => _s?._removeWhere(f);
  void insertFirst(T v) => _s?._insertFirst(v);
  void replace(bool Function(T) f, T v) => _s?._replace(f, v);
}

class PagedList<T> extends StatefulWidget {
  final Future<Pg<T>> Function(String? cursor) load;
  final Widget Function(BuildContext, T) item;
  final String empty; final PagedController<T>? controller; final String Function(T)? idOf; final Widget? header; final EdgeInsets padding; final bool separators; final bool Function(T)? filter;
  const PagedList({super.key, required this.load, required this.item, required this.empty, this.controller, this.idOf, this.header, this.padding = EdgeInsets.zero, this.separators = true, this.filter});
  @override
  State<PagedList<T>> createState() => _PagedListState<T>();
}

class _PagedListState<T> extends State<PagedList<T>> {
  final List<T> _items = []; String? _next; bool _loading = false, _done = false, _first = true; Object? _err; final _sc = ScrollController();
  @override
  void initState() { super.initState(); widget.controller?._s = this; _sc.addListener(() { if (_sc.position.pixels > _sc.position.maxScrollExtent - 600) _more(); }); _reload(); }
  @override
  void dispose() { _sc.dispose(); super.dispose(); }
  Future<void> _reload() async { _items.clear(); _next = null; _done = false; _err = null; _first = true; if (mounted) setState(() {}); await _more(); }
  Future<void> _more() async {
    if (_loading || _done) return;
    _loading = true; if (mounted) setState(() {});
    try {
      final pg = await widget.load(_next);
      final seen = widget.idOf == null ? <String>{} : _items.map(widget.idOf!).toSet();
      for (final x in pg.items) { if (widget.idOf == null || seen.add(widget.idOf!(x))) _items.add(x); }
      _next = pg.next; if (pg.next == null) _done = true;
      _err = null;
    } catch (e) { _err = e; _done = true; }
    _loading = false; _first = false; if (mounted) setState(() {});
  }
  void _removeWhere(bool Function(T) f) { setState(() => _items.removeWhere(f)); }
  void _insertFirst(T v) { setState(() => _items.insert(0, v)); }
  void _replace(bool Function(T) f, T v) { final i = _items.indexWhere(f); if (i >= 0) setState(() => _items[i] = v); }
  @override
  Widget build(BuildContext context) {
    if (_first && _loading) return const Center(child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.5)));
    final shown = widget.filter == null ? _items : _items.where(widget.filter!).toList();
    if (shown.isEmpty) {
      return RefreshIndicator(onRefresh: _reload, child: ListView(controller: _sc, physics: const AlwaysScrollableScrollPhysics(), padding: widget.padding, children: [
        if (widget.header != null) widget.header!,
        SizedBox(height: 320, child: _err != null ? Empty(tr('error'), onRetry: _reload) : Empty(widget.empty)),
      ]));
    }
    final h = widget.header != null ? 1 : 0;
    return RefreshIndicator(onRefresh: _reload, child: ListView.separated(
      controller: _sc, physics: const AlwaysScrollableScrollPhysics(), padding: widget.padding, itemCount: shown.length + h + 1,
      separatorBuilder: (_, i) => widget.separators ? const Divider(height: 1) : const SizedBox.shrink(),
      itemBuilder: (c, i) {
        if (h == 1 && i == 0) return widget.header!;
        final k = i - h;
        if (k == shown.length) return _loading ? const Padding(padding: EdgeInsets.all(20), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))) : const SizedBox(height: 24);
        return widget.item(c, shown[k]);
      }));
  }
}
